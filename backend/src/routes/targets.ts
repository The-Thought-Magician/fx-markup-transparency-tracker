import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  benchmarks_targets,
  corridors,
  payments,
  payment_markups,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const targetSchema = z.object({
  org_id: z.string().min(1),
  corridor_id: z.string().min(1),
  target_markup_bps: z.number(),
})

// GET / — public — markup targets (?org_id)
router.get('/', async (c) => {
  const orgId = c.req.query('org_id')
  const rows = orgId
    ? await db
        .select()
        .from(benchmarks_targets)
        .where(eq(benchmarks_targets.org_id, orgId))
        .orderBy(desc(benchmarks_targets.created_at))
    : await db
        .select()
        .from(benchmarks_targets)
        .orderBy(desc(benchmarks_targets.created_at))
  return c.json(rows)
})

// GET /variance — public — payments/corridors over target (?org_id)
//
// For each corridor that has a target, list the payments whose markup_bps
// exceeds the corridor target, plus a per-corridor rollup (avg markup, count
// over target, total over-target amount).
router.get('/variance', async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)

  const targets = await db
    .select()
    .from(benchmarks_targets)
    .where(eq(benchmarks_targets.org_id, orgId))

  const targetByCorridor = new Map<string, number>()
  for (const t of targets) {
    if (t.corridor_id) targetByCorridor.set(t.corridor_id, t.target_markup_bps)
  }

  const corridorRows = await db
    .select()
    .from(corridors)
    .where(eq(corridors.org_id, orgId))
  const corridorById = new Map(corridorRows.map((r) => [r.id, r]))

  // Join payments to their markup decomposition for this org.
  const rows = await db
    .select({
      payment_id: payments.id,
      reference: payments.reference,
      corridor_id: payments.corridor_id,
      provider_id: payments.provider_id,
      notional_base: payments.notional_base,
      value_date: payments.value_date,
      markup_bps: payment_markups.markup_bps,
      hidden_spread_cents: payment_markups.hidden_spread_cents,
      total_cost_cents: payment_markups.total_cost_cents,
    })
    .from(payments)
    .innerJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
    .where(eq(payments.org_id, orgId))

  interface OverPayment {
    payment_id: string
    reference: string | null
    corridor_id: string | null
    provider_id: string | null
    notional_base: number
    value_date: Date
    markup_bps: number
    target_markup_bps: number
    over_bps: number
    hidden_spread_cents: number
    total_cost_cents: number
  }

  const overPayments: OverPayment[] = []
  // corridor_id -> rollup accumulator
  const corridorAgg = new Map<
    string,
    {
      corridor_id: string
      label: string
      target_markup_bps: number
      payment_count: number
      over_count: number
      sum_markup_bps: number
      over_total_cost_cents: number
    }
  >()

  for (const r of rows) {
    if (!r.corridor_id) continue
    const target = targetByCorridor.get(r.corridor_id)
    if (target === undefined) continue

    const corridor = corridorById.get(r.corridor_id)
    let agg = corridorAgg.get(r.corridor_id)
    if (!agg) {
      agg = {
        corridor_id: r.corridor_id,
        label: corridor?.label ?? r.corridor_id,
        target_markup_bps: target,
        payment_count: 0,
        over_count: 0,
        sum_markup_bps: 0,
        over_total_cost_cents: 0,
      }
      corridorAgg.set(r.corridor_id, agg)
    }
    agg.payment_count += 1
    agg.sum_markup_bps += r.markup_bps

    if (r.markup_bps > target) {
      agg.over_count += 1
      agg.over_total_cost_cents += r.total_cost_cents
      overPayments.push({
        payment_id: r.payment_id,
        reference: r.reference,
        corridor_id: r.corridor_id,
        provider_id: r.provider_id,
        notional_base: r.notional_base,
        value_date: r.value_date,
        markup_bps: r.markup_bps,
        target_markup_bps: target,
        over_bps: r.markup_bps - target,
        hidden_spread_cents: r.hidden_spread_cents,
        total_cost_cents: r.total_cost_cents,
      })
    }
  }

  overPayments.sort((a, b) => b.over_bps - a.over_bps)

  const corridorVariance = [...corridorAgg.values()]
    .map((a) => ({
      corridor_id: a.corridor_id,
      label: a.label,
      target_markup_bps: a.target_markup_bps,
      payment_count: a.payment_count,
      over_count: a.over_count,
      avg_markup_bps: a.payment_count > 0 ? a.sum_markup_bps / a.payment_count : 0,
      avg_over_target_bps:
        a.payment_count > 0 ? a.sum_markup_bps / a.payment_count - a.target_markup_bps : 0,
      over_total_cost_cents: a.over_total_cost_cents,
    }))
    .sort((a, b) => b.avg_over_target_bps - a.avg_over_target_bps)

  return c.json({ payments: overPayments, corridors: corridorVariance })
})

// POST / — auth — set target for corridor
router.post('/', authMiddleware, zValidator('json', targetSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(benchmarks_targets)
    .values({
      org_id: body.org_id,
      user_id: userId,
      corridor_id: body.corridor_id,
      target_markup_bps: body.target_markup_bps,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — auth — update target
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', targetSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(benchmarks_targets)
      .where(eq(benchmarks_targets.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.corridor_id !== undefined) patch.corridor_id = body.corridor_id
    if (body.target_markup_bps !== undefined) patch.target_markup_bps = body.target_markup_bps
    if (Object.keys(patch).length === 0) return c.json(existing)
    const [updated] = await db
      .update(benchmarks_targets)
      .set(patch)
      .where(eq(benchmarks_targets.id, id))
      .returning()
    return c.json(updated)
  },
)

// DELETE /:id — auth — delete target
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(benchmarks_targets)
    .where(eq(benchmarks_targets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(benchmarks_targets).where(eq(benchmarks_targets.id, id))
  return c.json({ success: true })
})

export default router
