import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  tags,
  payment_tags,
  payments,
  payment_markups,
  organizations,
  audit_events,
} from '../db/schema.js'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1).optional().default('gray'),
})

const assignSchema = z.object({
  payment_id: z.string().min(1),
  tag_id: z.string().min(1),
})

const unassignSchema = z.object({
  payment_id: z.string().min(1),
  tag_id: z.string().min(1),
})

async function recordAudit(
  orgId: string,
  userId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(audit_events).values({
      org_id: orgId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Tag CRUD
// ---------------------------------------------------------------------------

// Auth: list tags (?org_id required)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db.select().from(tags).where(eq(tags.org_id, orgId)).orderBy(desc(tags.created_at))
  return c.json(rows)
})

// Auth: create tag
router.post('/', authMiddleware, zValidator('json', tagSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [org] = await db.select().from(organizations).where(eq(organizations.id, body.org_id))
  if (!org) return c.json({ error: 'Organization not found' }, 404)

  // enforce UNIQUE(org_id, name)
  const [dupe] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.org_id, body.org_id), eq(tags.name, body.name)))
  if (dupe) return c.json({ error: 'Tag with this name already exists' }, 409)

  const [created] = await db
    .insert(tags)
    .values({ org_id: body.org_id, user_id: userId, name: body.name, color: body.color })
    .returning()
  await recordAudit(body.org_id, userId, 'tag', created.id, 'create', { name: body.name })
  return c.json(created, 201)
})

// Auth: delete tag (and its payment assignments)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tags).where(eq(tags.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(payment_tags).where(eq(payment_tags.tag_id, id))
  await db.delete(tags).where(eq(tags.id, id))
  await recordAudit(existing.org_id, userId, 'tag', id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Assign / unassign tags to payments
// ---------------------------------------------------------------------------

// Auth: assign tag to payment
router.post('/assign', authMiddleware, zValidator('json', assignSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [tag] = await db.select().from(tags).where(eq(tags.id, body.tag_id))
  if (!tag) return c.json({ error: 'Tag not found' }, 404)
  const [payment] = await db.select().from(payments).where(eq(payments.id, body.payment_id))
  if (!payment) return c.json({ error: 'Payment not found' }, 404)
  // both must belong to the same org
  if (tag.org_id !== payment.org_id) {
    return c.json({ error: 'Tag and payment belong to different organizations' }, 400)
  }

  // honor UNIQUE(payment_id, tag_id) — return the existing link if present
  const [existing] = await db
    .select()
    .from(payment_tags)
    .where(and(eq(payment_tags.payment_id, body.payment_id), eq(payment_tags.tag_id, body.tag_id)))
  if (existing) return c.json(existing, 200)

  const [created] = await db
    .insert(payment_tags)
    .values({ payment_id: body.payment_id, tag_id: body.tag_id, user_id: userId })
    .returning()
  await recordAudit(tag.org_id, userId, 'payment_tag', created.id, 'assign', {
    payment_id: body.payment_id,
    tag_id: body.tag_id,
  })
  return c.json(created, 201)
})

// Auth: unassign tag from payment
router.post('/unassign', authMiddleware, zValidator('json', unassignSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [existing] = await db
    .select()
    .from(payment_tags)
    .where(and(eq(payment_tags.payment_id, body.payment_id), eq(payment_tags.tag_id, body.tag_id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) {
    // also allow the tag owner to remove the assignment
    const [tag] = await db.select().from(tags).where(eq(tags.id, body.tag_id))
    if (!tag || tag.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(payment_tags).where(eq(payment_tags.id, existing.id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Per-tag leakage rollups (?org_id)
// ---------------------------------------------------------------------------

router.get('/rollups', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)

  const tagRows = await db.select().from(tags).where(eq(tags.org_id, orgId))
  if (tagRows.length === 0) return c.json([])

  const links = await db.select().from(payment_tags)
  const markups = await db.select().from(payment_markups)
  const markupByPayment = new Map(markups.map((m) => [m.payment_id, m]))

  // tag_id -> set of payment_ids (within this org's tags)
  const tagIds = new Set(tagRows.map((t) => t.id))
  const paymentsByTag = new Map<string, string[]>()
  for (const link of links) {
    if (!tagIds.has(link.tag_id)) continue
    const arr = paymentsByTag.get(link.tag_id) ?? []
    arr.push(link.payment_id)
    paymentsByTag.set(link.tag_id, arr)
  }

  const rollups = tagRows
    .map((t) => {
      const paymentIds = paymentsByTag.get(t.id) ?? []
      let leakageCents = 0
      let hiddenSpreadCents = 0
      let bpsSum = 0
      let bpsCount = 0
      for (const pid of paymentIds) {
        const m = markupByPayment.get(pid)
        if (!m) continue
        leakageCents += m.total_cost_cents
        hiddenSpreadCents += m.hidden_spread_cents
        bpsSum += m.markup_bps
        bpsCount += 1
      }
      return {
        tag_id: t.id,
        name: t.name,
        color: t.color,
        payment_count: paymentIds.length,
        leakage_cents: leakageCents,
        hidden_spread_cents: hiddenSpreadCents,
        avg_markup_bps: bpsCount > 0 ? bpsSum / bpsCount : 0,
      }
    })
    .sort((a, b) => b.leakage_cents - a.leakage_cents)

  return c.json(rollups)
})

export default router
