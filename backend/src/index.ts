import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
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
  plans,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import organizationRoutes from './routes/organizations.js'
import providerRoutes from './routes/providers.js'
import corridorRoutes from './routes/corridors.js'
import benchmarkRoutes from './routes/benchmarks.js'
import rateSourceRoutes from './routes/rate-sources.js'
import paymentRoutes from './routes/payments.js'
import wireFeeRoutes from './routes/wire-fees.js'
import reconciliationRoutes from './routes/reconciliation.js'
import importRoutes from './routes/imports.js'
import mappingRoutes from './routes/mappings.js'
import leaderboardRoutes from './routes/leaderboard.js'
import ledgerRoutes from './routes/ledger.js'
import scenarioRoutes from './routes/scenarios.js'
import targetRoutes from './routes/targets.js'
import alertRoutes from './routes/alerts.js'
import reportRoutes from './routes/reports.js'
import tagRoutes from './routes/tags.js'
import activityRoutes from './routes/activity.js'
import noteRoutes from './routes/notes.js'
import widgetRoutes from './routes/widgets.js'
import dashboardRoutes from './routes/dashboard.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason))
process.on('uncaughtException', (err) => console.error('uncaughtException:', err))

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://fx-markup-transparency-tracker.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const api = new Hono()
api.route('/organizations', organizationRoutes)
api.route('/providers', providerRoutes)
api.route('/corridors', corridorRoutes)
api.route('/benchmarks', benchmarkRoutes)
api.route('/rate-sources', rateSourceRoutes)
api.route('/payments', paymentRoutes)
api.route('/wire-fees', wireFeeRoutes)
api.route('/reconciliation', reconciliationRoutes)
api.route('/imports', importRoutes)
api.route('/mappings', mappingRoutes)
api.route('/leaderboard', leaderboardRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/scenarios', scenarioRoutes)
api.route('/targets', targetRoutes)
api.route('/alerts', alertRoutes)
api.route('/reports', reportRoutes)
api.route('/tags', tagRoutes)
api.route('/activity', activityRoutes)
api.route('/notes', noteRoutes)
api.route('/widgets', widgetRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Idempotent seed: plans 'free'/'pro' + a demo org with sample reference data.
// Count-then-insert so repeated boots never duplicate rows.
// ---------------------------------------------------------------------------

const DEMO_USER = 'demo-user'

async function seedIfEmpty() {
  // Plans (always ensure both exist).
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  // Demo org + reference data.
  const existingOrgs = await db.select().from(organizations).limit(1)
  if (existingOrgs.length > 0) return

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Demo Treasury', base_currency: 'USD', owner_id: DEMO_USER })
    .returning()

  await db
    .insert(org_members)
    .values({ org_id: org.id, user_id: DEMO_USER, role: 'owner' })

  const [provBank] = await db
    .insert(providers)
    .values({
      org_id: org.id,
      user_id: DEMO_USER,
      name: 'Global Bank',
      tier: 'bank',
      home_currency: 'USD',
      swift_bic: 'GLBKUS33',
    })
    .returning()

  const [provFintech] = await db
    .insert(providers)
    .values({
      org_id: org.id,
      user_id: DEMO_USER,
      name: 'SwiftFX',
      tier: 'fintech',
      home_currency: 'USD',
      swift_bic: 'SWFTUS44',
    })
    .returning()

  await db.insert(provider_fee_schedules).values([
    {
      provider_id: provBank.id,
      user_id: DEMO_USER,
      wire_fee_cents: 3500,
      stated_fx_fee_pct: 0.5,
      lifting_charge_cents: 1500,
      lifting_policy: 'shared',
      is_current: true,
    },
    {
      provider_id: provFintech.id,
      user_id: DEMO_USER,
      wire_fee_cents: 500,
      stated_fx_fee_pct: 0.2,
      lifting_charge_cents: 0,
      lifting_policy: 'ours',
      is_current: true,
    },
  ])

  const [corridor] = await db
    .insert(corridors)
    .values({
      org_id: org.id,
      user_id: DEMO_USER,
      base_currency: 'USD',
      quote_currency: 'EUR',
      label: 'USD → EUR',
    })
    .returning()

  const [source] = await db
    .insert(rate_sources)
    .values({ org_id: org.id, user_id: DEMO_USER, name: 'Interbank Mid', kind: 'manual', confidence: 1 })
    .returning()

  const capturedAt = new Date()
  const midRate = 0.92
  const [benchmark] = await db
    .insert(benchmark_rates)
    .values({
      org_id: org.id,
      user_id: DEMO_USER,
      source_id: source.id,
      base_currency: 'USD',
      quote_currency: 'EUR',
      mid_rate: midRate,
      captured_at: capturedAt,
    })
    .returning()

  // A demo payment with a clear hidden markup vs the mid.
  const notionalBase = 100000
  const appliedRate = 0.9085
  const disclosedFeeCents = 4000
  const [payment] = await db
    .insert(payments)
    .values({
      org_id: org.id,
      user_id: DEMO_USER,
      provider_id: provBank.id,
      corridor_id: corridor.id,
      reference: 'DEMO-0001',
      base_currency: 'USD',
      quote_currency: 'EUR',
      notional_base: notionalBase,
      applied_rate: appliedRate,
      disclosed_fee_cents: disclosedFeeCents,
      value_date: capturedAt,
      benchmark_rate_id: benchmark.id,
      status: 'recorded',
    })
    .returning()

  // Markup math (canonical, deterministic).
  const markupBps = ((midRate - appliedRate) / midRate) * 10000
  const quoteReceived = notionalBase * appliedRate
  const quoteAtMid = notionalBase * midRate
  const hiddenSpreadBase = (quoteAtMid - quoteReceived) / midRate
  const hiddenSpreadCents = Math.round(hiddenSpreadBase * 100)
  const wireFeeCents = 0
  const totalCostCents = disclosedFeeCents + hiddenSpreadCents + wireFeeCents
  const effectiveCostPct = (totalCostCents / (notionalBase * 100)) * 100

  await db.insert(payment_markups).values({
    payment_id: payment.id,
    user_id: DEMO_USER,
    mid_rate: midRate,
    applied_rate: appliedRate,
    markup_bps: markupBps,
    hidden_spread_cents: hiddenSpreadCents,
    disclosed_fee_cents: disclosedFeeCents,
    wire_fee_cents: wireFeeCents,
    total_cost_cents: totalCostCents,
    effective_cost_pct: effectiveCostPct,
  })

  console.log('Seeded demo org and sample data')
}

// ---------------------------------------------------------------------------
// Boot. CRITICAL: bind the port FIRST so the platform health check sees a live
// service immediately. Only AFTER serve() do we run migrate() and seedIfEmpty()
// (both idempotent), each in its own try/catch, so a slow/cold DB never blocks
// the port binding.
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? '3001')

serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
    console.log('Migrations applied')
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
