import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { providers, provider_fee_schedules, payments, payment_markups } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const providerSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  tier: z.string().min(1).optional().default('bank'),
  home_currency: z.string().min(3).max(3).optional().default('USD'),
  swift_bic: z.string().optional().nullable(),
  is_active: z.boolean().optional().default(true),
})

const feeScheduleSchema = z.object({
  wire_fee_cents: z.number().int().min(0).optional().default(0),
  stated_fx_fee_pct: z.number().min(0).optional().default(0),
  lifting_charge_cents: z.number().int().min(0).optional().default(0),
  lifting_policy: z.string().min(1).optional().default('shared'),
  effective_date: z.string().datetime().optional(),
})

// GET / — auth — list providers (?org_id required)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(providers)
    .where(eq(providers.org_id, orgId))
    .orderBy(desc(providers.created_at))
  return c.json(rows)
})

// GET /:id — auth — provider + its current fee schedule
router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [provider] = await db.select().from(providers).where(eq(providers.id, id))
  if (!provider) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), provider.org_id))) return c.json({ error: 'Not found' }, 404)
  const [current_fee_schedule] = await db
    .select()
    .from(provider_fee_schedules)
    .where(
      and(
        eq(provider_fee_schedules.provider_id, id),
        eq(provider_fee_schedules.is_current, true),
      ),
    )
    .orderBy(desc(provider_fee_schedules.effective_date))
  return c.json({ ...provider, current_fee_schedule: current_fee_schedule ?? null })
})

// POST / — auth — create provider
router.post('/', authMiddleware, zValidator('json', providerSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [provider] = await db
    .insert(providers)
    .values({
      org_id: body.org_id,
      user_id: userId,
      name: body.name,
      tier: body.tier ?? 'bank',
      home_currency: body.home_currency ?? 'USD',
      swift_bic: body.swift_bic ?? null,
      is_active: body.is_active ?? true,
    })
    .returning()
  return c.json(provider, 201)
})

// PUT /:id — auth — update provider
router.put('/:id', authMiddleware, zValidator('json', providerSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(providers).where(eq(providers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(providers)
    .set(body)
    .where(eq(providers.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete provider (+ its fee schedules)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(providers).where(eq(providers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(provider_fee_schedules).where(eq(provider_fee_schedules.provider_id, id))
  await db.delete(providers).where(eq(providers.id, id))
  return c.json({ success: true })
})

// GET /:id/fee-schedules — auth — fee schedule history (newest first)
router.get('/:id/fee-schedules', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [provider] = await db.select().from(providers).where(eq(providers.id, id))
  if (!provider) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), provider.org_id))) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(provider_fee_schedules)
    .where(eq(provider_fee_schedules.provider_id, id))
    .orderBy(desc(provider_fee_schedules.effective_date))
  return c.json(rows)
})

// POST /:id/fee-schedules — auth — add a fee schedule, marking all prior ones
// not current (new one becomes current).
router.post(
  '/:id/fee-schedules',
  authMiddleware,
  zValidator('json', feeScheduleSchema),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [provider] = await db.select().from(providers).where(eq(providers.id, id))
    if (!provider) return c.json({ error: 'Not found' }, 404)
    if (provider.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    // mark all prior schedules for this provider as not current
    await db
      .update(provider_fee_schedules)
      .set({ is_current: false })
      .where(eq(provider_fee_schedules.provider_id, id))
    const [schedule] = await db
      .insert(provider_fee_schedules)
      .values({
        provider_id: id,
        user_id: userId,
        wire_fee_cents: body.wire_fee_cents ?? 0,
        stated_fx_fee_pct: body.stated_fx_fee_pct ?? 0,
        lifting_charge_cents: body.lifting_charge_cents ?? 0,
        lifting_policy: body.lifting_policy ?? 'shared',
        effective_date: body.effective_date ? new Date(body.effective_date) : new Date(),
        is_current: true,
      })
      .returning()
    return c.json(schedule, 201)
  },
)

// GET /:id/stats — auth — aggregate markup/leakage across this provider's
// payments, joined to their markup decompositions.
router.get('/:id/stats', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [provider] = await db.select().from(providers).where(eq(providers.id, id))
  if (!provider) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), provider.org_id))) return c.json({ error: 'Not found' }, 404)

  const rows = await db
    .select({
      payment_id: payments.id,
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
    .where(eq(payments.provider_id, id))

  const payment_count = rows.length
  let total_notional_base = 0
  let total_leakage_cents = 0
  let total_hidden_spread_cents = 0
  let total_fees_cents = 0
  let total_cost_cents = 0
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
    // leakage = hidden spread + all fees (the avoidable + disclosed cost)
    total_leakage_cents += r.total_cost_cents ?? 0
  }

  return c.json({
    provider_id: id,
    payment_count,
    total_notional_base,
    avg_markup_bps: markup_bps_count > 0 ? markup_bps_sum / markup_bps_count : 0,
    avg_effective_cost_pct:
      effective_cost_pct_count > 0 ? effective_cost_pct_sum / effective_cost_pct_count : 0,
    total_hidden_spread_cents,
    total_fees_cents,
    total_cost_cents,
    total_leakage_cents,
  })
})

export default router
