import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { audit_events, organizations } from '../db/schema.js'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const eventSchema = z.object({
  org_id: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1).optional().nullable(),
  action: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional().default({}),
})

// ---------------------------------------------------------------------------
// Audit / activity feed
// ---------------------------------------------------------------------------

// Auth: audit events feed (?org_id required&entity_type)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const entityType = c.req.query('entity_type')

  const conditions = [eq(audit_events.org_id, orgId)]
  if (entityType) conditions.push(eq(audit_events.entity_type, entityType))

  const rows = await db
    .select()
    .from(audit_events)
    .where(and(...conditions))
    .orderBy(desc(audit_events.created_at))

  return c.json(rows)
})

// Auth: record an audit event
router.post('/', authMiddleware, zValidator('json', eventSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [org] = await db.select().from(organizations).where(eq(organizations.id, body.org_id))
  if (!org) return c.json({ error: 'Organization not found' }, 404)

  const [created] = await db
    .insert(audit_events)
    .values({
      org_id: body.org_id,
      user_id: userId,
      entity_type: body.entity_type,
      entity_id: body.entity_id ?? null,
      action: body.action,
      detail: body.detail,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// SSE live feed — streams newly-recorded audit events for an org as they appear.
// Polls the table and emits any events created after the last seen timestamp.
// ---------------------------------------------------------------------------

router.get('/stream', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const entityType = c.req.query('entity_type')

  return streamSSE(c, async (stream) => {
    // Begin from "now" so the client only receives fresh events.
    let lastSeen = new Date()
    let aborted = false
    stream.onAbort(() => {
      aborted = true
    })

    // Send an initial hello so clients can confirm the connection is open.
    await stream.writeSSE({
      event: 'open',
      data: JSON.stringify({ org_id: orgId ?? null, since: lastSeen.toISOString() }),
    })

    // Poll up to a bounded number of iterations (keeps the handler from running
    // forever in serverless environments). The client reconnects via EventSource.
    const MAX_ITERATIONS = 600 // ~10 minutes at 1s cadence
    let id = 0
    for (let i = 0; i < MAX_ITERATIONS && !aborted; i++) {
      const conditions = [eq(audit_events.org_id, orgId)]
      if (entityType) conditions.push(eq(audit_events.entity_type, entityType))

      const rows = await db
        .select()
        .from(audit_events)
        .where(and(...conditions))
        .orderBy(desc(audit_events.created_at))

      // Filter to events strictly newer than lastSeen, oldest-first for delivery.
      const fresh = rows
        .filter((r) => r.created_at instanceof Date && r.created_at.getTime() > lastSeen.getTime())
        .sort((a, b) => (a.created_at as Date).getTime() - (b.created_at as Date).getTime())

      for (const ev of fresh) {
        await stream.writeSSE({
          event: 'activity',
          id: String(id++),
          data: JSON.stringify(ev),
        })
        if (ev.created_at instanceof Date && ev.created_at.getTime() > lastSeen.getTime()) {
          lastSeen = ev.created_at
        }
      }

      // Heartbeat to keep the connection alive through proxies.
      await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      await stream.sleep(1000)
    }
  })
})

export default router
