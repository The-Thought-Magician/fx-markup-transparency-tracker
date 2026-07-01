import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { notes } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const noteSchema = z.object({
  org_id: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  body: z.string().min(1),
})

// Auth: list notes for an entity (?entity_type&entity_id), org_id required
router.get('/', authMiddleware, async (c) => {
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(notes.org_id, orgId)]
  if (entityType) conds.push(eq(notes.entity_type, entityType))
  if (entityId) conds.push(eq(notes.entity_id, entityId))

  const rows = await db
    .select()
    .from(notes)
    .where(and(...conds))
    .orderBy(desc(notes.created_at))

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
