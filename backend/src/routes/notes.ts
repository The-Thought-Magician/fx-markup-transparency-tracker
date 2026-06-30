import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { notes } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const noteSchema = z.object({
  org_id: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  body: z.string().min(1),
})

// Public: list notes for an entity (?entity_type&entity_id), optional ?org_id
router.get('/', async (c) => {
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const orgId = c.req.query('org_id')

  const conds = []
  if (entityType) conds.push(eq(notes.entity_type, entityType))
  if (entityId) conds.push(eq(notes.entity_id, entityId))
  if (orgId) conds.push(eq(notes.org_id, orgId))

  const rows = conds.length
    ? await db
        .select()
        .from(notes)
        .where(and(...conds))
        .orderBy(desc(notes.created_at))
    : await db.select().from(notes).orderBy(desc(notes.created_at))

  return c.json(rows)
})

// Auth: create a note
router.post('/', authMiddleware, zValidator('json', noteSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(notes)
    .values({
      org_id: body.org_id,
      user_id: userId,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      body: body.body,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: delete a note (owner only)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notes).where(eq(notes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(notes).where(eq(notes.id, id))
  return c.json({ success: true })
})

export default router
