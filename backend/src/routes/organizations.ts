import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { organizations, org_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const orgSchema = z.object({
  name: z.string().min(1),
  base_currency: z.string().min(3).max(3).optional().default('USD'),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().min(1).optional().default('member'),
})

// GET / — public — orgs the header user belongs to (via membership), falling
// back to orgs they own. If no user header, returns all orgs.
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) {
    const all = await db.select().from(organizations).orderBy(desc(organizations.created_at))
    return c.json(all)
  }
  const memberships = await db
    .select()
    .from(org_members)
    .where(eq(org_members.user_id, userId))
  const ids = new Set(memberships.map((m) => m.org_id))
  const owned = await db
    .select()
    .from(organizations)
    .where(eq(organizations.owner_id, userId))
  for (const o of owned) ids.add(o.id)
  if (ids.size === 0) return c.json([])
  const all = await db.select().from(organizations).orderBy(desc(organizations.created_at))
  return c.json(all.filter((o) => ids.has(o.id)))
})

// GET /current — auth — the user's current (most recent) org. Creates a default
// org if the user has none yet so the dashboard always has context.
router.get('/current', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(org_members)
    .where(eq(org_members.user_id, userId))
  const ids = new Set(memberships.map((m) => m.org_id))
  const owned = await db
    .select()
    .from(organizations)
    .where(eq(organizations.owner_id, userId))
    .orderBy(desc(organizations.created_at))
  for (const o of owned) ids.add(o.id)

  if (ids.size > 0) {
    const all = await db.select().from(organizations).orderBy(desc(organizations.created_at))
    const mine = all.filter((o) => ids.has(o.id))
    if (mine.length > 0) return c.json(mine[0])
  }

  // none yet — provision a default org + owner membership
  const [org] = await db
    .insert(organizations)
    .values({ name: 'My Organization', base_currency: 'USD', owner_id: userId })
    .returning()
  await db
    .insert(org_members)
    .values({ org_id: org.id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()
  return c.json(org)
})

// GET /:id — public — a single org
router.get('/:id', async (c) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, c.req.param('id')))
  if (!org) return c.json({ error: 'Not found' }, 404)
  return c.json(org)
})

// POST / — auth — create org; creator becomes owner + member
router.post('/', authMiddleware, zValidator('json', orgSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [org] = await db
    .insert(organizations)
    .values({
      name: body.name,
      base_currency: body.base_currency ?? 'USD',
      owner_id: userId,
    })
    .returning()
  await db
    .insert(org_members)
    .values({ org_id: org.id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()
  return c.json(org, 201)
})

// PUT /:id — auth(owner) — update org
router.put('/:id', authMiddleware, zValidator('json', orgSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(organizations)
    .set(body)
    .where(eq(organizations.id, id))
    .returning()
  return c.json(updated)
})

// GET /:id/members — public — members of an org
router.get('/:id/members', async (c) => {
  const id = c.req.param('id')
  const members = await db
    .select()
    .from(org_members)
    .where(eq(org_members.org_id, id))
    .orderBy(desc(org_members.created_at))
  return c.json(members)
})

// POST /:id/members — auth(owner) — add a member
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return c.json({ error: 'Not found' }, 404)
  if (org.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const existing = await db
    .select()
    .from(org_members)
    .where(and(eq(org_members.org_id, id), eq(org_members.user_id, body.user_id)))
  if (existing.length > 0) return c.json(existing[0])
  const [member] = await db
    .insert(org_members)
    .values({ org_id: id, user_id: body.user_id, role: body.role ?? 'member' })
    .returning()
  return c.json(member, 201)
})

// DELETE /:id/members/:memberId — auth(owner) — remove a member
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return c.json({ error: 'Not found' }, 404)
  if (org.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [member] = await db.select().from(org_members).where(eq(org_members.id, memberId))
  if (!member || member.org_id !== id) return c.json({ error: 'Not found' }, 404)
  if (member.user_id === org.owner_id) return c.json({ error: 'Cannot remove owner' }, 400)
  await db.delete(org_members).where(eq(org_members.id, memberId))
  return c.json({ success: true })
})

export default router
