import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  cost_ledgers,
  payments,
  payment_markups,
  providers,
  corridors,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function inPeriod(valueDate: Date, period: string | undefined): boolean {
  if (!period || period === 'all') return true
  const ym = `${valueDate.getUTCFullYear()}-${String(valueDate.getUTCMonth() + 1).padStart(2, '0')}`
  if (/^\d{4}-\d{2}$/.test(period)) return ym === period
  if (/^\d{4}$/.test(period)) return String(valueDate.getUTCFullYear()) === period
  return true
}

// Annualization factor: a single month -> *12, a full year or 'all' -> *1.
function annualizationFactor(period: string | undefined): number {
  if (!period || period === 'all') return 1
  if (/^\d{4}-\d{2}$/.test(period)) return 12
  if (/^\d{4}$/.test(period)) return 1
  return 1
}

interface LedgerComputation {
  period: string
  payment_count: number
  total_notional_cents: number
  total_markup_cents: number
  total_fees_cents: number
  observed_leakage_cents: number
  annualized_leakage_cents: number
  breakdown: {
    by_provider: Array<{ provider_id: string; label: string; leakage_cents: number; payment_count: number }>
    by_corridor: Array<{ corridor_id: string; label: string; leakage_cents: number; payment_count: number }>
    annualization_factor: number
  }
}

async function computeLedger(orgId: string, period: string | undefined): Promise<LedgerComputation> {
  const rows = await db
    .select({ payment: payments, markup: payment_markups })
    .from(payments)
    .leftJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
    .where(eq(payments.org_id, orgId))

  const providerRows = await db.select().from(providers).where(eq(providers.org_id, orgId))
  const corridorRows = await db.select().from(corridors).where(eq(corridors.org_id, orgId))
  const providerById = new Map(providerRows.map((p) => [p.id, p]))
  const corridorById = new Map(corridorRows.map((co) => [co.id, co]))

  let payment_count = 0
  let total_notional_cents = 0
  let total_markup_cents = 0 // hidden spread (the FX markup component)
  let total_fees_cents = 0 // disclosed + wire fees
  let observed_leakage_cents = 0 // total cost across payments

  const byProvider = new Map<string, { leakage_cents: number; payment_count: number }>()
  const byCorridor = new Map<string, { leakage_cents: number; payment_count: number }>()

  for (const { payment, markup } of rows) {
    if (!inPeriod(payment.value_date as Date, period)) continue
    payment_count += 1
    total_notional_cents += Math.round(payment.notional_base * 100)
    if (markup) {
      total_markup_cents += markup.hidden_spread_cents
      total_fees_cents += markup.disclosed_fee_cents + markup.wire_fee_cents
      observed_leakage_cents += markup.total_cost_cents

      if (payment.provider_id) {
        const cur = byProvider.get(payment.provider_id) ?? { leakage_cents: 0, payment_count: 0 }
        cur.leakage_cents += markup.total_cost_cents
        cur.payment_count += 1
        byProvider.set(payment.provider_id, cur)
      }
      if (payment.corridor_id) {
        const cur = byCorridor.get(payment.corridor_id) ?? { leakage_cents: 0, payment_count: 0 }
        cur.leakage_cents += markup.total_cost_cents
        cur.payment_count += 1
        byCorridor.set(payment.corridor_id, cur)
      }
    }
  }

  const factor = annualizationFactor(period)
  const annualized_leakage_cents = Math.round(observed_leakage_cents * factor)

  const by_provider = [...byProvider.entries()]
    .map(([provider_id, v]) => ({
      provider_id,
      label: providerById.get(provider_id)?.name ?? 'Unknown provider',
      leakage_cents: v.leakage_cents,
      payment_count: v.payment_count,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)

  const by_corridor = [...byCorridor.entries()]
    .map(([corridor_id, v]) => ({
      corridor_id,
      label: corridorById.get(corridor_id)?.label ?? 'Unknown corridor',
      leakage_cents: v.leakage_cents,
      payment_count: v.payment_count,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)

  return {
    period: period ?? 'all',
    payment_count,
    total_notional_cents,
    total_markup_cents,
    total_fees_cents,
    observed_leakage_cents,
    annualized_leakage_cents,
    breakdown: { by_provider, by_corridor, annualization_factor: factor },
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Public: saved cost-ledger entries (?org_id)
router.get('/', async (c) => {
  const orgId = c.req.query('org_id')
  const rows = orgId
    ? await db
        .select()
        .from(cost_ledgers)
        .where(eq(cost_ledgers.org_id, orgId))
        .orderBy(desc(cost_ledgers.created_at))
    : await db.select().from(cost_ledgers).orderBy(desc(cost_ledgers.created_at))
  return c.json(rows)
})

// Public: live annualized projection (?org_id&period)
router.get('/summary', async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  const period = c.req.query('period')
  const summary = await computeLedger(orgId, period)
  return c.json(summary)
})

const createSchema = z.object({
  org_id: z.string().min(1),
  period: z.string().min(1).default('all'),
})

// Auth: compute + persist a ledger entry for a period
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { org_id, period } = c.req.valid('json')
  const computed = await computeLedger(org_id, period)

  const [created] = await db
    .insert(cost_ledgers)
    .values({
      org_id,
      user_id: userId,
      period: computed.period,
      total_notional_cents: computed.total_notional_cents,
      total_markup_cents: computed.total_markup_cents,
      total_fees_cents: computed.total_fees_cents,
      annualized_leakage_cents: computed.annualized_leakage_cents,
      breakdown: {
        ...computed.breakdown,
        observed_leakage_cents: computed.observed_leakage_cents,
        payment_count: computed.payment_count,
      },
    })
    .returning()
  return c.json(created, 201)
})

// Auth: delete ledger entry
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(cost_ledgers).where(eq(cost_ledgers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(cost_ledgers).where(eq(cost_ledgers.id, id))
  return c.json({ success: true })
})

export default router
