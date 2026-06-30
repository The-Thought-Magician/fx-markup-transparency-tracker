import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  organizations,
  org_members,
  providers,
  provider_fee_schedules,
  corridors,
  rate_sources,
  benchmark_rates,
  payments,
  payment_markups,
  wire_fees,
  fee_reconciliations,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const SEED_ORG_NAME = 'Sample Treasury Org'

// ---------------------------------------------------------------------------
// Canonical markup math (mirrors docs/build-plan.md "Markup math")
// ---------------------------------------------------------------------------

interface MarkupInputs {
  notional_base: number
  applied_rate: number
  disclosed_fee_cents: number
  mid_rate: number
  wire_fee_cents: number
}

interface MarkupResult {
  mid_rate: number
  applied_rate: number
  markup_bps: number
  hidden_spread_cents: number
  disclosed_fee_cents: number
  wire_fee_cents: number
  total_cost_cents: number
  effective_cost_pct: number
}

function computeMarkup(i: MarkupInputs): MarkupResult {
  const markup_bps = i.mid_rate !== 0 ? ((i.mid_rate - i.applied_rate) / i.mid_rate) * 10000 : 0
  const quoteReceivedApplied = i.notional_base * i.applied_rate
  const quoteAtMid = i.notional_base * i.mid_rate
  const hiddenSpreadQuote = quoteAtMid - quoteReceivedApplied
  const hiddenSpreadBase = i.mid_rate !== 0 ? hiddenSpreadQuote / i.mid_rate : 0
  const hidden_spread_cents = Math.round(hiddenSpreadBase * 100)
  const total_cost_cents = i.disclosed_fee_cents + hidden_spread_cents + i.wire_fee_cents
  const denom = i.notional_base * 100
  const effective_cost_pct = denom !== 0 ? (total_cost_cents / denom) * 100 : 0
  return {
    mid_rate: i.mid_rate,
    applied_rate: i.applied_rate,
    markup_bps,
    hidden_spread_cents,
    disclosed_fee_cents: i.disclosed_fee_cents,
    wire_fee_cents: i.wire_fee_cents,
    total_cost_cents,
    effective_cost_pct,
  }
}

// ---------------------------------------------------------------------------
// Sample data definitions
// ---------------------------------------------------------------------------

const sampleProviders = [
  { name: 'First National Wire', tier: 'bank', home_currency: 'USD', swift_bic: 'FNWUUS33', wire_fee_cents: 4500, stated_fx_fee_pct: 0.5, lifting_charge_cents: 1500, lifting_policy: 'shared' },
  { name: 'GlobalRemit FX', tier: 'fintech', home_currency: 'USD', swift_bic: 'GLRMGB22', wire_fee_cents: 1500, stated_fx_fee_pct: 0.15, lifting_charge_cents: 0, lifting_policy: 'ours' },
  { name: 'Continental Bank', tier: 'bank', home_currency: 'EUR', swift_bic: 'CONTDEFF', wire_fee_cents: 3800, stated_fx_fee_pct: 0.65, lifting_charge_cents: 2000, lifting_policy: 'shared' },
]

const sampleCorridors = [
  { base_currency: 'USD', quote_currency: 'EUR', label: 'USD to EUR' },
  { base_currency: 'USD', quote_currency: 'GBP', label: 'USD to GBP' },
  { base_currency: 'EUR', quote_currency: 'GBP', label: 'EUR to GBP' },
]

// mid rates per pair used for both benchmarks and markup decomposition
const midRates: Record<string, number> = {
  'USD/EUR': 0.92,
  'USD/GBP': 0.79,
  'EUR/GBP': 0.86,
}

// payment templates: providerIdx, corridorIdx, notional_base, appliedRate (worse than mid),
// disclosed_fee_cents, daysAgo
const samplePayments = [
  { providerIdx: 0, corridorIdx: 0, notional_base: 250000, applied_rate: 0.9085, disclosed_fee_cents: 4500, daysAgo: 5 },
  { providerIdx: 1, corridorIdx: 0, notional_base: 180000, applied_rate: 0.9176, disclosed_fee_cents: 1500, daysAgo: 12 },
  { providerIdx: 0, corridorIdx: 1, notional_base: 320000, applied_rate: 0.7795, disclosed_fee_cents: 4500, daysAgo: 8 },
  { providerIdx: 2, corridorIdx: 2, notional_base: 140000, applied_rate: 0.8492, disclosed_fee_cents: 3800, daysAgo: 20 },
  { providerIdx: 1, corridorIdx: 1, notional_base: 95000, applied_rate: 0.7868, disclosed_fee_cents: 1500, daysAgo: 3 },
  { providerIdx: 2, corridorIdx: 0, notional_base: 210000, applied_rate: 0.9061, disclosed_fee_cents: 3800, daysAgo: 27 },
]

// wire-fee lines attached per payment index (lifting / intermediary)
const sampleWireFees: Record<number, Array<{ kind: string; description: string; amount_cents: number; intermediary_bank?: string }>> = {
  0: [{ kind: 'lifting', description: 'Lifting charge', amount_cents: 1500 }, { kind: 'intermediary', description: 'Correspondent bank fee', amount_cents: 2000, intermediary_bank: 'Citi NY' }],
  2: [{ kind: 'lifting', description: 'Lifting charge', amount_cents: 1500 }],
  3: [{ kind: 'lifting', description: 'Lifting charge', amount_cents: 2000 }, { kind: 'intermediary', description: 'Intermediary deduction', amount_cents: 1200, intermediary_bank: 'Deutsche Bank' }],
  5: [{ kind: 'lifting', description: 'Lifting charge', amount_cents: 2000 }],
}

function daysAgoDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Resolve (or create) the user's seed org. Returns org id.
// ---------------------------------------------------------------------------

async function findSeedOrg(userId: string): Promise<string | null> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.owner_id, userId), eq(organizations.name, SEED_ORG_NAME)))
  return existing ? existing.id : null
}

// ---------------------------------------------------------------------------
// POST / — seed sample data for the user
// ---------------------------------------------------------------------------

const seedSchema = z
  .object({ base_currency: z.string().min(3).max(3).optional() })
  .optional()
  .default({})

router.post('/', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json') ?? {}
  const baseCurrency = body.base_currency ?? 'USD'

  // Idempotency: if a seed org already exists for this user, return it.
  const existingOrgId = await findSeedOrg(userId)
  if (existingOrgId) {
    return c.json({ seeded: false, already: true, org_id: existingOrgId }, 200)
  }

  // --- organization + membership ---
  const [org] = await db
    .insert(organizations)
    .values({ name: SEED_ORG_NAME, base_currency: baseCurrency, owner_id: userId })
    .returning()

  await db.insert(org_members).values({ org_id: org.id, user_id: userId, role: 'owner' })

  // --- providers + current fee schedules ---
  const providerIds: string[] = []
  for (const p of sampleProviders) {
    const [prov] = await db
      .insert(providers)
      .values({
        org_id: org.id,
        user_id: userId,
        name: p.name,
        tier: p.tier,
        home_currency: p.home_currency,
        swift_bic: p.swift_bic,
        is_active: true,
      })
      .returning()
    providerIds.push(prov.id)
    await db.insert(provider_fee_schedules).values({
      provider_id: prov.id,
      user_id: userId,
      wire_fee_cents: p.wire_fee_cents,
      stated_fx_fee_pct: p.stated_fx_fee_pct,
      lifting_charge_cents: p.lifting_charge_cents,
      lifting_policy: p.lifting_policy,
      is_current: true,
    })
  }

  // --- corridors ---
  const corridorIds: string[] = []
  for (const cor of sampleCorridors) {
    const [created] = await db
      .insert(corridors)
      .values({
        org_id: org.id,
        user_id: userId,
        base_currency: cor.base_currency,
        quote_currency: cor.quote_currency,
        label: cor.label,
        is_active: true,
      })
      .returning()
    corridorIds.push(created.id)
  }

  // --- rate source ---
  const [source] = await db
    .insert(rate_sources)
    .values({ org_id: org.id, user_id: userId, name: 'ECB Reference', kind: 'reference', confidence: 0.98 })
    .returning()

  // --- benchmark rates (one per corridor pair) ---
  const benchmarkByPair: Record<string, string> = {}
  for (const cor of sampleCorridors) {
    const pair = `${cor.base_currency}/${cor.quote_currency}`
    const mid = midRates[pair] ?? 1
    const [bench] = await db
      .insert(benchmark_rates)
      .values({
        org_id: org.id,
        user_id: userId,
        source_id: source.id,
        base_currency: cor.base_currency,
        quote_currency: cor.quote_currency,
        mid_rate: mid,
        captured_at: daysAgoDate(0),
      })
      .returning()
    benchmarkByPair[pair] = bench.id
  }

  // --- payments + markups + wire fees + reconciliations ---
  let paymentCount = 0
  for (let idx = 0; idx < samplePayments.length; idx++) {
    const sp = samplePayments[idx]
    const cor = sampleCorridors[sp.corridorIdx]
    const pair = `${cor.base_currency}/${cor.quote_currency}`
    const mid = midRates[pair] ?? 1
    const provider = sampleProviders[sp.providerIdx]

    const [pay] = await db
      .insert(payments)
      .values({
        org_id: org.id,
        user_id: userId,
        provider_id: providerIds[sp.providerIdx],
        corridor_id: corridorIds[sp.corridorIdx],
        reference: `PMT-${1000 + idx}`,
        base_currency: cor.base_currency,
        quote_currency: cor.quote_currency,
        notional_base: sp.notional_base,
        applied_rate: sp.applied_rate,
        disclosed_fee_cents: sp.disclosed_fee_cents,
        value_date: daysAgoDate(sp.daysAgo),
        benchmark_rate_id: benchmarkByPair[pair],
        status: 'recorded',
      })
      .returning()
    paymentCount++

    // wire-fee lines
    const feeLines = sampleWireFees[idx] ?? []
    let wireFeeTotal = 0
    for (const fl of feeLines) {
      await db.insert(wire_fees).values({
        payment_id: pay.id,
        user_id: userId,
        kind: fl.kind,
        description: fl.description,
        amount_cents: fl.amount_cents,
        intermediary_bank: fl.intermediary_bank ?? null,
      })
      wireFeeTotal += fl.amount_cents
    }

    // markup decomposition
    const mk = computeMarkup({
      notional_base: sp.notional_base,
      applied_rate: sp.applied_rate,
      disclosed_fee_cents: sp.disclosed_fee_cents,
      mid_rate: mid,
      wire_fee_cents: wireFeeTotal,
    })
    await db.insert(payment_markups).values({
      payment_id: pay.id,
      user_id: userId,
      mid_rate: mk.mid_rate,
      applied_rate: mk.applied_rate,
      markup_bps: mk.markup_bps,
      hidden_spread_cents: mk.hidden_spread_cents,
      disclosed_fee_cents: mk.disclosed_fee_cents,
      wire_fee_cents: mk.wire_fee_cents,
      total_cost_cents: mk.total_cost_cents,
      effective_cost_pct: mk.effective_cost_pct,
    })

    // reconciliation: expected from provider current fee schedule vs observed
    const expectedFee = Math.round(
      provider.wire_fee_cents +
        provider.lifting_charge_cents +
        (provider.stated_fx_fee_pct / 100) * (sp.notional_base * 100),
    )
    const observedFee = sp.disclosed_fee_cents + wireFeeTotal
    const variance = observedFee - expectedFee
    await db.insert(fee_reconciliations).values({
      payment_id: pay.id,
      user_id: userId,
      expected_fee_cents: expectedFee,
      observed_fee_cents: observedFee,
      variance_cents: variance,
      status: variance > 0 ? 'flagged' : 'open',
      notes: null,
    })
  }

  return c.json(
    {
      seeded: true,
      org_id: org.id,
      counts: {
        organizations: 1,
        providers: providerIds.length,
        corridors: corridorIds.length,
        rate_sources: 1,
        benchmark_rates: Object.keys(benchmarkByPair).length,
        payments: paymentCount,
      },
    },
    201,
  )
})

// ---------------------------------------------------------------------------
// POST /reset — clear seeded data for the user's seed org
// ---------------------------------------------------------------------------

router.post('/reset', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const orgId = await findSeedOrg(userId)
  if (!orgId) {
    return c.json({ cleared: false, reason: 'No sample data found' }, 200)
  }

  // gather payment ids for the org so we can clean dependent rows first
  const orgPayments = await db.select({ id: payments.id }).from(payments).where(eq(payments.org_id, orgId))
  const paymentIds = orgPayments.map((p) => p.id)

  if (paymentIds.length > 0) {
    await db.delete(payment_markups).where(inArray(payment_markups.payment_id, paymentIds))
    await db.delete(wire_fees).where(inArray(wire_fees.payment_id, paymentIds))
    await db.delete(fee_reconciliations).where(inArray(fee_reconciliations.payment_id, paymentIds))
    await db.delete(payments).where(inArray(payments.id, paymentIds))
  }

  // gather provider ids to clear their fee schedules
  const orgProviders = await db.select({ id: providers.id }).from(providers).where(eq(providers.org_id, orgId))
  const providerIds = orgProviders.map((p) => p.id)
  if (providerIds.length > 0) {
    await db.delete(provider_fee_schedules).where(inArray(provider_fee_schedules.provider_id, providerIds))
  }

  await db.delete(benchmark_rates).where(eq(benchmark_rates.org_id, orgId))
  await db.delete(rate_sources).where(eq(rate_sources.org_id, orgId))
  await db.delete(corridors).where(eq(corridors.org_id, orgId))
  await db.delete(providers).where(eq(providers.org_id, orgId))
  await db.delete(org_members).where(eq(org_members.org_id, orgId))
  await db.delete(organizations).where(eq(organizations.id, orgId))

  return c.json({ cleared: true, org_id: orgId })
})

// ---------------------------------------------------------------------------
// GET /status — whether sample data exists (?org_id) + counts
// ---------------------------------------------------------------------------

router.get('/status', async (c) => {
  const orgId = c.req.query('org_id')

  // Resolve target org: explicit ?org_id, else the header user's seed org.
  let targetOrgId: string | null = orgId ?? null
  if (!targetOrgId) {
    const userId = getUserId(c)
    if (userId) targetOrgId = await findSeedOrg(userId)
  }

  if (!targetOrgId) {
    return c.json({
      seeded: false,
      counts: { organizations: 0, providers: 0, corridors: 0, rate_sources: 0, benchmark_rates: 0, payments: 0 },
    })
  }

  const [orgRow] = await db.select().from(organizations).where(eq(organizations.id, targetOrgId))
  const provRows = await db.select({ id: providers.id }).from(providers).where(eq(providers.org_id, targetOrgId))
  const corRows = await db.select({ id: corridors.id }).from(corridors).where(eq(corridors.org_id, targetOrgId))
  const srcRows = await db.select({ id: rate_sources.id }).from(rate_sources).where(eq(rate_sources.org_id, targetOrgId))
  const benchRows = await db.select({ id: benchmark_rates.id }).from(benchmark_rates).where(eq(benchmark_rates.org_id, targetOrgId))
  const payRows = await db.select({ id: payments.id }).from(payments).where(eq(payments.org_id, targetOrgId))

  const counts = {
    organizations: orgRow ? 1 : 0,
    providers: provRows.length,
    corridors: corRows.length,
    rate_sources: srcRows.length,
    benchmark_rates: benchRows.length,
    payments: payRows.length,
  }
  const seeded =
    counts.organizations > 0 &&
    (counts.providers > 0 || counts.corridors > 0 || counts.payments > 0)

  return c.json({ seeded, org_id: targetOrgId, counts })
})

export default router
