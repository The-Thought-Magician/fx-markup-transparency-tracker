import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rate_sources } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1).optional().default('manual'),
  confidence: z.number().min(0).max(1).optional().default(1),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

// GET / — public — list sources (?org_id)
router.get('/', async (c) => {
  const orgId = c.req.query('org_id')
  const rows = orgId
    ? await db
        .select()
        .from(rate_sources)
        .where(eq(rate_sources.org_id, orgId))
        .orderBy(desc(rate_sources.created_at))
    : await db.select().from(rate_sources).orderBy(desc(rate_sources.created_at))
  return c.json(rows)
})

// POST / — auth — create source
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(rate_sources)
    .values({
      org_id: body.org_id,
      user_id: userId,
      name: body.name,
      kind: body.kind,
      confidence: body.confidence,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — auth — update source
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rate_sources).where(eq(rate_sources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(rate_sources)
    .set(body)
    .where(eq(rate_sources.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete source
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rate_sources).where(eq(rate_sources.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(rate_sources).where(eq(rate_sources.id, id))
  return c.json({ success: true })
})

export default router
