import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  payments,
  payment_markups,
  benchmark_rates,
  wire_fees,
  fee_reconciliations,
} from '../db/schema.js'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const paymentBody = z.object({
  org_id: z.string().min(1),
  provider_id: z.string().min(1).optional(),
  corridor_id: z.string().min(1).optional(),
  reference: z.string().optional(),
  base_currency: z.string().min(1),
  quote_currency: z.string().min(1),
  notional_base: z.number().positive(),
  applied_rate: z.number().positive(),
  disclosed_fee_cents: z.number().int().min(0).optional().default(0),
  value_date: z.string().min(1).optional(),
  benchmark_rate_id: z.string().min(1).optional(),
  status: z.string().min(1).optional().default('recorded'),
})

const updateBody = paymentBody.partial().omit({ org_id: true })

const bulkBody = z.object({
  payments: z.array(paymentBody).min(1),
})

// ---------------------------------------------------------------------------
// Benchmark resolution + markup decomposition (canonical math, see build-plan)
// ---------------------------------------------------------------------------

function nearestRate<T extends { captured_at: Date | string }>(rows: T[], at: number): T | null {
  if (rows.length === 0) return null
  let best = rows[0]
  let bestDelta = Math.abs(new Date(rows[0].captured_at).getTime() - at)
  for (const r of rows) {
    const delta = Math.abs(new Date(r.captured_at).getTime() - at)
    if (delta < bestDelta) {
      best = r
      bestDelta = delta
    }
  }
  return best
}

// Find the benchmark rate id to attach to a payment if none was supplied:
// nearest captured_at within the org for the same currency pair.
async function resolveBenchmarkId(payment: {
  org_id: string
  base_currency: string
  quote_currency: string
  value_date: Date
}): Promise<string | null> {
  const candidates = await db
    .select()
    .from(benchmark_rates)
    .where(
      and(
        eq(benchmark_rates.org_id, payment.org_id),
        eq(benchmark_rates.base_currency, payment.base_currency),
        eq(benchmark_rates.quote_currency, payment.quote_currency),
      ),
    )
  const match = nearestRate(candidates, payment.value_date.getTime())
  return match ? match.id : null
}

interface Decomposition {
  mid_rate: number
  applied_rate: number
  markup_bps: number
  hidden_spread_cents: number
  disclosed_fee_cents: number
  wire_fee_cents: number
  total_cost_cents: number
  effective_cost_pct: number
}

async function decomposePayment(paymentId: string): Promise<Decomposition | null> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId))
  if (!p) return null

  // mid_rate from attached benchmark (fallback to applied_rate => zero markup).
  let midRate = p.applied_rate
  if (p.benchmark_rate_id) {
    const [b] = await db
      .select()
      .from(benchmark_rates)
      .where(eq(benchmark_rates.id, p.benchmark_rate_id))
    if (b) midRate = b.mid_rate
  }

  const notionalBase = p.notional_base
  const appliedRate = p.applied_rate

  // markup_bps = ((mid - applied) / mid) * 10000
  const markupBps = midRate !== 0 ? ((midRate - appliedRate) / midRate) * 10000 : 0

  // hidden spread: quote_at_mid - quote_received_applied, converted to base, in cents
  const quoteReceivedApplied = notionalBase * appliedRate
  const quoteAtMid = notionalBase * midRate
  const hiddenSpreadQuote = quoteAtMid - quoteReceivedApplied
  const hiddenSpreadBase = midRate !== 0 ? hiddenSpreadQuote / midRate : 0
  const hiddenSpreadCents = Math.round(hiddenSpreadBase * 100)

  // sum of wire fee lines (incl. lifting charges)
  const fees = await db.select().from(wire_fees).where(eq(wire_fees.payment_id, paymentId))
  const wireFeeCents = fees.reduce((s, f) => s + (f.amount_cents ?? 0), 0)

  const disclosedFeeCents = p.disclosed_fee_cents ?? 0
  const totalCostCents = disclosedFeeCents + hiddenSpreadCents + wireFeeCents
  const effectiveCostPct =
    notionalBase !== 0 ? (totalCostCents / (notionalBase * 100)) * 100 : 0

  const values = {
    payment_id: paymentId,
    mid_rate: midRate,
    applied_rate: appliedRate,
    markup_bps: markupBps,
    hidden_spread_cents: hiddenSpreadCents,
    disclosed_fee_cents: disclosedFeeCents,
    wire_fee_cents: wireFeeCents,
    total_cost_cents: totalCostCents,
    effective_cost_pct: effectiveCostPct,
  }

  const [saved] = await db
    .insert(payment_markups)
    .values({ ...values, user_id: p.user_id })
    .onConflictDoUpdate({ target: payment_markups.payment_id, set: values })
    .returning()

  return saved as unknown as Decomposition
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — auth — list payments (?org_id&provider_id&corridor_id)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const providerId = c.req.query('provider_id')
  const corridorId = c.req.query('corridor_id')
  const conds = [eq(payments.org_id, orgId)]
  if (providerId) conds.push(eq(payments.provider_id, providerId))
  if (corridorId) conds.push(eq(payments.corridor_id, corridorId))
  const rows = await db
    .select()
    .from(payments)
    .where(and(...conds))
    .orderBy(desc(payments.value_date))
  return c.json(rows)
})

// GET /:id — auth — payment + markup + wire fees + reconciliation
router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [payment] = await db.select().from(payments).where(eq(payments.id, id))
  if (!payment) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), payment.org_id))) return c.json({ error: 'Not found' }, 404)
  const [markup] = await db
    .select()
    .from(payment_markups)
    .where(eq(payment_markups.payment_id, id))
  const fees = await db.select().from(wire_fees).where(eq(wire_fees.payment_id, id))
  const [reconciliation] = await db
    .select()
    .from(fee_reconciliations)
    .where(eq(fee_reconciliations.payment_id, id))
  return c.json({
    ...payment,
    markup: markup ?? null,
    wire_fees: fees,
    reconciliation: reconciliation ?? null,
  })
})

// GET /:id/markup — auth — decomposition for a payment
router.get('/:id/markup', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [payment] = await db.select().from(payments).where(eq(payments.id, id))
  if (!payment) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), payment.org_id))) return c.json({ error: 'Not found' }, 404)
  const [markup] = await db
    .select()
    .from(payment_markups)
    .where(eq(payment_markups.payment_id, id))
  if (!markup) return c.json({ error: 'No markup computed' }, 404)
  return c.json(markup)
})

// POST / — auth — create payment (auto-attach nearest benchmark, compute markup)
router.post('/', authMiddleware, zValidator('json', paymentBody), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const valueDate = body.value_date ? new Date(body.value_date) : new Date()

  let benchmarkRateId = body.benchmark_rate_id ?? null
  if (!benchmarkRateId) {
    benchmarkRateId = await resolveBenchmarkId({
      org_id: body.org_id,
      base_currency: body.base_currency,
      quote_currency: body.quote_currency,
      value_date: valueDate,
    })
  }

  const [created] = await db
    .insert(payments)
    .values({
      org_id: body.org_id,
      user_id: userId,
      provider_id: body.provider_id ?? null,
      corridor_id: body.corridor_id ?? null,
      reference: body.reference ?? null,
      base_currency: body.base_currency,
      quote_currency: body.quote_currency,
      notional_base: body.notional_base,
      applied_rate: body.applied_rate,
      disclosed_fee_cents: body.disclosed_fee_cents,
      value_date: valueDate,
      benchmark_rate_id: benchmarkRateId,
      status: body.status,
    })
    .returning()

  await decomposePayment(created.id)
  return c.json(created, 201)
})

// POST /bulk — auth — create many payments
router.post('/bulk', authMiddleware, zValidator('json', bulkBody), async (c) => {
  const userId = getUserId(c)
  const { payments: rows } = c.req.valid('json')
  const created: string[] = []
  for (const body of rows) {
    const valueDate = body.value_date ? new Date(body.value_date) : new Date()
    let benchmarkRateId = body.benchmark_rate_id ?? null
    if (!benchmarkRateId) {
      benchmarkRateId = await resolveBenchmarkId({
        org_id: body.org_id,
        base_currency: body.base_currency,
        quote_currency: body.quote_currency,
        value_date: valueDate,
      })
    }
    const [row] = await db
      .insert(payments)
      .values({
        org_id: body.org_id,
        user_id: userId,
        provider_id: body.provider_id ?? null,
        corridor_id: body.corridor_id ?? null,
        reference: body.reference ?? null,
        base_currency: body.base_currency,
        quote_currency: body.quote_currency,
        notional_base: body.notional_base,
        applied_rate: body.applied_rate,
        disclosed_fee_cents: body.disclosed_fee_cents ?? 0,
        value_date: valueDate,
        benchmark_rate_id: benchmarkRateId,
        status: body.status ?? 'recorded',
      })
      .returning()
    await decomposePayment(row.id)
    created.push(row.id)
  }
  return c.json({ created: created.length, ids: created }, 201)
})

// PUT /:id — auth — update payment (recompute markup)
router.put('/:id', authMiddleware, zValidator('json', updateBody), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(payments).where(eq(payments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const set: Record<string, unknown> = {}
  if (body.provider_id !== undefined) set.provider_id = body.provider_id
  if (body.corridor_id !== undefined) set.corridor_id = body.corridor_id
  if (body.reference !== undefined) set.reference = body.reference
  if (body.base_currency !== undefined) set.base_currency = body.base_currency
  if (body.quote_currency !== undefined) set.quote_currency = body.quote_currency
  if (body.notional_base !== undefined) set.notional_base = body.notional_base
  if (body.applied_rate !== undefined) set.applied_rate = body.applied_rate
  if (body.disclosed_fee_cents !== undefined) set.disclosed_fee_cents = body.disclosed_fee_cents
  if (body.value_date !== undefined) set.value_date = new Date(body.value_date)
  if (body.benchmark_rate_id !== undefined) set.benchmark_rate_id = body.benchmark_rate_id
  if (body.status !== undefined) set.status = body.status

  const [updated] = await db.update(payments).set(set).where(eq(payments.id, id)).returning()
  await decomposePayment(updated.id)
  return c.json(updated)
})

// DELETE /:id — auth — delete payment
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(payments).where(eq(payments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  // remove dependent rows first to satisfy FK constraints
  await db.delete(payment_markups).where(eq(payment_markups.payment_id, id))
  await db.delete(wire_fees).where(eq(wire_fees.payment_id, id))
  await db.delete(fee_reconciliations).where(eq(fee_reconciliations.payment_id, id))
  await db.delete(payments).where(eq(payments.id, id))
  return c.json({ success: true })
})

// POST /:id/decompose — auth — recompute markup decomposition
router.post('/:id/decompose', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(payments).where(eq(payments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const decomposition = await decomposePayment(id)
  if (!decomposition) return c.json({ error: 'Not found' }, 404)
  return c.json(decomposition)
})

export default router
