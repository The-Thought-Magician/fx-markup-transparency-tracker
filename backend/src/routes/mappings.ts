import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { provider_mappings, providers } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const mappingSchema = z.object({
  org_id: z.string().min(1),
  provider_id: z.string().min(1).nullable().optional(),
  name: z.string().min(1),
  field_map: z.record(z.string(), z.string()).default({}),
})

// Public: list provider mappings (?org_id&provider_id)
router.get('/', async (c) => {
  const orgId = c.req.query('org_id')
  const providerId = c.req.query('provider_id')
  const conds = []
  if (orgId) conds.push(eq(provider_mappings.org_id, orgId))
  if (providerId) conds.push(eq(provider_mappings.provider_id, providerId))
  const rows = conds.length
    ? await db.select().from(provider_mappings).where(and(...conds))
    : await db.select().from(provider_mappings)
  return c.json(rows)
})

// Auth: create mapping
router.post('/', authMiddleware, zValidator('json', mappingSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (body.provider_id) {
    const [prov] = await db.select().from(providers).where(eq(providers.id, body.provider_id))
    if (!prov) return c.json({ error: 'Provider not found' }, 404)
    if (prov.org_id !== body.org_id) return c.json({ error: 'Provider not in org' }, 400)
  }

  const [created] = await db
    .insert(provider_mappings)
    .values({
      org_id: body.org_id,
      user_id: userId,
      provider_id: body.provider_id ?? null,
      name: body.name,
      field_map: body.field_map,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update mapping
router.put('/:id', authMiddleware, zValidator('json', mappingSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(provider_mappings).where(eq(provider_mappings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.field_map !== undefined) patch.field_map = body.field_map
  if (body.provider_id !== undefined) patch.provider_id = body.provider_id

  const [updated] = await db
    .update(provider_mappings)
    .set(patch)
    .where(eq(provider_mappings.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete mapping
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(provider_mappings).where(eq(provider_mappings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(provider_mappings).where(eq(provider_mappings.id, id))
  return c.json({ success: true })
})

export default router
