import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { dashboards_widgets } from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const widgetSchema = z.object({
  org_id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  position: z.number().int().optional().default(0),
})

// Auth: list dashboard widgets (?org_id required) ordered by position
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(dashboards_widgets)
    .where(eq(dashboards_widgets.org_id, orgId))
    .orderBy(asc(dashboards_widgets.position), asc(dashboards_widgets.created_at))
  return c.json(rows)
})

// Auth: create a widget
router.post('/', authMiddleware, zValidator('json', widgetSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(dashboards_widgets)
    .values({
      org_id: body.org_id,
      user_id: userId,
      kind: body.kind,
      title: body.title,
      config: body.config as Record<string, unknown>,
      position: body.position,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update a widget (owner only)
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', widgetSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(dashboards_widgets)
      .where(eq(dashboards_widgets.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.kind !== undefined) patch.kind = body.kind
    if (body.title !== undefined) patch.title = body.title
    if (body.config !== undefined) patch.config = body.config
    if (body.position !== undefined) patch.position = body.position
    const [updated] = await db
      .update(dashboards_widgets)
      .set(patch)
      .where(eq(dashboards_widgets.id, id))
      .returning()
    return c.json(updated)
  },
)

// Auth: delete a widget (owner only)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(dashboards_widgets)
    .where(eq(dashboards_widgets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(dashboards_widgets).where(eq(dashboards_widgets.id, id))
  return c.json({ success: true })
})

export default router
