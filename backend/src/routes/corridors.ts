import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { corridors, payments, payment_markups } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const corridorSchema = z.object({
  org_id: z.string().min(1),
  base_currency: z.string().min(3).max(3),
  quote_currency: z.string().min(3).max(3),
  label: z.string().min(1),
  is_active: z.boolean().optional().default(true),
})

// Internal: compute aggregate stats for a corridor's payments.
async function corridorStats(corridorId: string) {
  const rows = await db
    .select({
      notional_base: payments.notional_base,
      markup_bps: payment_markups.markup_bps,
      hidden_spread_cents: payment_markups.hidden_spread_cents,
      disclosed_fee_cents: payment_markups.disclosed_fee_cents,
      wire_fee_cents: payment_markups.wire_fee_cents,
      total_cost_cents: payment_markups.total_cost_cents,
      effective_cost_pct: payment_markups.effective_cost_pct,
    })
    .from(payments)
    .leftJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
    .where(eq(payments.corridor_id, corridorId))

  const payment_count = rows.length
  let total_notional_base = 0
  let total_hidden_spread_cents = 0
  let total_fees_cents = 0
  let total_cost_cents = 0
  let total_leakage_cents = 0
  let markup_bps_sum = 0
  let markup_bps_count = 0
  let effective_cost_pct_sum = 0
  let effective_cost_pct_count = 0

  for (const r of rows) {
    total_notional_base += r.notional_base ?? 0
    if (r.markup_bps !== null && r.markup_bps !== undefined) {
      markup_bps_sum += r.markup_bps
      markup_bps_count += 1
    }
    if (r.effective_cost_pct !== null && r.effective_cost_pct !== undefined) {
      effective_cost_pct_sum += r.effective_cost_pct
      effective_cost_pct_count += 1
    }
    total_hidden_spread_cents += r.hidden_spread_cents ?? 0
    total_fees_cents += (r.disclosed_fee_cents ?? 0) + (r.wire_fee_cents ?? 0)
    total_cost_cents += r.total_cost_cents ?? 0
    total_leakage_cents += r.total_cost_cents ?? 0
  }

  return {
    corridor_id: corridorId,
    payment_count,
    total_notional_base,
    avg_markup_bps: markup_bps_count > 0 ? markup_bps_sum / markup_bps_count : 0,
    avg_effective_cost_pct:
      effective_cost_pct_count > 0 ? effective_cost_pct_sum / effective_cost_pct_count : 0,
    total_hidden_spread_cents,
    total_fees_cents,
    total_cost_cents,
    total_leakage_cents,
  }
}

// GET / — auth — list corridors (?org_id required)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(corridors)
    .where(eq(corridors.org_id, orgId))
    .orderBy(desc(corridors.created_at))
  return c.json(rows)
})

// GET /:id — auth — corridor + stats
router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [corridor] = await db.select().from(corridors).where(eq(corridors.id, id))
  if (!corridor) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), corridor.org_id))) return c.json({ error: 'Not found' }, 404)
  const stats = await corridorStats(id)
  return c.json({ ...corridor, stats })
})

// POST / — auth — create corridor
router.post('/', authMiddleware, zValidator('json', corridorSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  // enforce the (org_id, base, quote) uniqueness gracefully
  const existing = await db
    .select()
    .from(corridors)
    .where(
      and(
        eq(corridors.org_id, body.org_id),
        eq(corridors.base_currency, body.base_currency),
        eq(corridors.quote_currency, body.quote_currency),
      ),
    )
  if (existing.length > 0) {
    return c.json({ error: 'Corridor already exists for this currency pair' }, 409)
  }
  const [corridor] = await db
    .insert(corridors)
    .values({
      org_id: body.org_id,
      user_id: userId,
      base_currency: body.base_currency,
      quote_currency: body.quote_currency,
      label: body.label,
      is_active: body.is_active ?? true,
    })
    .returning()
  return c.json(corridor, 201)
})

// PUT /:id — auth — update corridor
router.put('/:id', authMiddleware, zValidator('json', corridorSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(corridors).where(eq(corridors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(corridors)
    .set(body)
    .where(eq(corridors.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete corridor
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(corridors).where(eq(corridors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(corridors).where(eq(corridors.id, id))
  return c.json({ success: true })
})

// GET /:id/stats — auth — volume/leakage/avg markup for a corridor
router.get('/:id/stats', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [corridor] = await db.select().from(corridors).where(eq(corridors.id, id))
  if (!corridor) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), corridor.org_id))) return c.json({ error: 'Not found' }, 404)
  const stats = await corridorStats(id)
  return c.json(stats)
})

export default router
