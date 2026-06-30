import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  payments,
  payment_markups,
  corridors,
  providers,
  corridor_leaderboard_snapshots,
  provider_leaderboard_snapshots,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Live ranking computation
// ---------------------------------------------------------------------------

interface Agg {
  key: string
  label: string
  base_currency?: string
  quote_currency?: string
  tier?: string
  payment_count: number
  total_notional_base: number
  total_markup_bps: number // accumulated, divided by count for avg
  total_hidden_spread_cents: number
  total_cost_cents: number
}

// period filter: a payment's value_date falls within the named period.
// period is a free-form bucket like 'YYYY-MM' or 'all'. We match against the
// value_date's YYYY-MM prefix when a concrete month is supplied.
function inPeriod(valueDate: Date, period: string | undefined): boolean {
  if (!period || period === 'all') return true
  const ym = `${valueDate.getUTCFullYear()}-${String(valueDate.getUTCMonth() + 1).padStart(2, '0')}`
  if (/^\d{4}-\d{2}$/.test(period)) return ym === period
  if (/^\d{4}$/.test(period)) return String(valueDate.getUTCFullYear()) === period
  return true
}

async function loadJoined(orgId: string | undefined) {
  const rows = await db
    .select({
      payment: payments,
      markup: payment_markups,
    })
    .from(payments)
    .leftJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
    .where(orgId ? eq(payments.org_id, orgId) : undefined as any)
  return rows
}

function rankFromAgg(aggs: Map<string, Agg>) {
  const list = [...aggs.values()].map((a) => {
    const avg_markup_bps = a.payment_count > 0 ? a.total_markup_bps / a.payment_count : 0
    return {
      key: a.key,
      label: a.label,
      base_currency: a.base_currency,
      quote_currency: a.quote_currency,
      tier: a.tier,
      payment_count: a.payment_count,
      total_notional_base: a.total_notional_base,
      avg_markup_bps,
      total_hidden_spread_cents: a.total_hidden_spread_cents,
      total_cost_cents: a.total_cost_cents,
      leakage_cents: a.total_cost_cents, // total_cost_cents captures full leakage (spread + fees)
    }
  })
  // rank worst-first by total leakage (total_cost_cents captures the full leakage)
  list.sort((x, y) => y.total_cost_cents - x.total_cost_cents)
  return list.map((r, i) => ({ rank: i + 1, ...r }))
}

async function computeCorridorRanking(orgId: string | undefined, period: string | undefined) {
  const rows = await loadJoined(orgId)
  const corridorRows = orgId
    ? await db.select().from(corridors).where(eq(corridors.org_id, orgId))
    : await db.select().from(corridors)
  const corridorById = new Map(corridorRows.map((c) => [c.id, c]))

  const aggs = new Map<string, Agg>()
  for (const { payment, markup } of rows) {
    if (!payment.corridor_id) continue
    if (!inPeriod(payment.value_date as Date, period)) continue
    const cor = corridorById.get(payment.corridor_id)
    const key = payment.corridor_id
    let a = aggs.get(key)
    if (!a) {
      a = {
        key,
        label: cor?.label ?? `${payment.base_currency}/${payment.quote_currency}`,
        base_currency: cor?.base_currency ?? payment.base_currency,
        quote_currency: cor?.quote_currency ?? payment.quote_currency,
        payment_count: 0,
        total_notional_base: 0,
        total_markup_bps: 0,
        total_hidden_spread_cents: 0,
        total_cost_cents: 0,
      }
      aggs.set(key, a)
    }
    a.payment_count += 1
    a.total_notional_base += payment.notional_base
    if (markup) {
      a.total_markup_bps += markup.markup_bps
      a.total_hidden_spread_cents += markup.hidden_spread_cents
      a.total_cost_cents += markup.total_cost_cents
    }
  }
  return rankFromAgg(aggs)
}

async function computeProviderRanking(orgId: string | undefined, period: string | undefined) {
  const rows = await loadJoined(orgId)
  const providerRows = orgId
    ? await db.select().from(providers).where(eq(providers.org_id, orgId))
    : await db.select().from(providers)
  const providerById = new Map(providerRows.map((p) => [p.id, p]))

  const aggs = new Map<string, Agg>()
  for (const { payment, markup } of rows) {
    if (!payment.provider_id) continue
    if (!inPeriod(payment.value_date as Date, period)) continue
    const prov = providerById.get(payment.provider_id)
    const key = payment.provider_id
    let a = aggs.get(key)
    if (!a) {
      a = {
        key,
        label: prov?.name ?? 'Unknown provider',
        tier: prov?.tier,
        payment_count: 0,
        total_notional_base: 0,
        total_markup_bps: 0,
        total_hidden_spread_cents: 0,
        total_cost_cents: 0,
      }
      aggs.set(key, a)
    }
    a.payment_count += 1
    a.total_notional_base += payment.notional_base
    if (markup) {
      a.total_markup_bps += markup.markup_bps
      a.total_hidden_spread_cents += markup.hidden_spread_cents
      a.total_cost_cents += markup.total_cost_cents
    }
  }
  return rankFromAgg(aggs)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Public: live corridor markup ranking (?org_id&period)
router.get('/corridors', async (c) => {
  const orgId = c.req.query('org_id')
  const period = c.req.query('period')
  const ranking = await computeCorridorRanking(orgId, period)
  return c.json(ranking)
})

// Public: live provider markup ranking (?org_id&period)
router.get('/providers', async (c) => {
  const orgId = c.req.query('org_id')
  const period = c.req.query('period')
  const ranking = await computeProviderRanking(orgId, period)
  return c.json(ranking)
})

const snapshotSchema = z.object({
  org_id: z.string().min(1),
  period: z.string().min(1).default('all'),
})

// Auth: persist a leaderboard snapshot (both corridor + provider)
router.post('/snapshots', authMiddleware, zValidator('json', snapshotSchema), async (c) => {
  const userId = getUserId(c)
  const { org_id, period } = c.req.valid('json')

  const corridorRanking = await computeCorridorRanking(org_id, period)
  const providerRanking = await computeProviderRanking(org_id, period)

  const [corridorSnap] = await db
    .insert(corridor_leaderboard_snapshots)
    .values({ org_id, user_id: userId, period, rankings: corridorRanking })
    .returning()
  const [providerSnap] = await db
    .insert(provider_leaderboard_snapshots)
    .values({ org_id, user_id: userId, period, rankings: providerRanking })
    .returning()

  return c.json({ corridor: corridorSnap, provider: providerSnap }, 201)
})

// Public: saved snapshots (?org_id&kind)
router.get('/snapshots', async (c) => {
  const orgId = c.req.query('org_id')
  const kind = c.req.query('kind') // 'corridor' | 'provider' | undefined (both)

  const out: { corridor?: unknown[]; provider?: unknown[] } = {}

  if (!kind || kind === 'corridor') {
    out.corridor = orgId
      ? await db
          .select()
          .from(corridor_leaderboard_snapshots)
          .where(eq(corridor_leaderboard_snapshots.org_id, orgId))
          .orderBy(desc(corridor_leaderboard_snapshots.created_at))
      : await db
          .select()
          .from(corridor_leaderboard_snapshots)
          .orderBy(desc(corridor_leaderboard_snapshots.created_at))
  }
  if (!kind || kind === 'provider') {
    out.provider = orgId
      ? await db
          .select()
          .from(provider_leaderboard_snapshots)
          .where(eq(provider_leaderboard_snapshots.org_id, orgId))
          .orderBy(desc(provider_leaderboard_snapshots.created_at))
      : await db
          .select()
          .from(provider_leaderboard_snapshots)
          .orderBy(desc(provider_leaderboard_snapshots.created_at))
  }

  return c.json(out)
})

// ---------------------------------------------------------------------------
// Movers: compare the latest two snapshots and surface best/worst movers
// ---------------------------------------------------------------------------

interface RankRow {
  key: string
  label: string
  rank: number
  avg_markup_bps: number
  total_cost_cents: number
  [k: string]: unknown
}

function diffSnapshots(latest: RankRow[], prior: RankRow[]) {
  const priorByKey = new Map(prior.map((r) => [r.key, r]))
  const movers = latest.map((cur) => {
    const prev = priorByKey.get(cur.key)
    const rank_delta = prev ? prev.rank - cur.rank : 0 // positive = improved (moved toward rank 1)
    const cost_delta_cents = prev ? cur.total_cost_cents - prev.total_cost_cents : 0
    const markup_delta_bps = prev ? cur.avg_markup_bps - prev.avg_markup_bps : 0
    return {
      key: cur.key,
      label: cur.label,
      current_rank: cur.rank,
      prior_rank: prev?.rank ?? null,
      rank_delta,
      cost_delta_cents,
      markup_delta_bps,
    }
  })
  // best movers = largest reduction in cost (most negative cost_delta); worst = largest increase
  const sortedByCost = [...movers].sort((a, b) => a.cost_delta_cents - b.cost_delta_cents)
  const best = sortedByCost.filter((m) => m.prior_rank !== null && m.cost_delta_cents < 0).slice(0, 5)
  const worst = [...sortedByCost]
    .reverse()
    .filter((m) => m.prior_rank !== null && m.cost_delta_cents > 0)
    .slice(0, 5)
  return { best, worst, all: movers }
}

// Public: best/worst movers between latest two snapshots (?org_id&kind)
router.get('/movers', async (c) => {
  const orgId = c.req.query('org_id')
  const kind = c.req.query('kind') === 'provider' ? 'provider' : 'corridor'

  const table =
    kind === 'provider' ? provider_leaderboard_snapshots : corridor_leaderboard_snapshots

  const snaps = orgId
    ? await db
        .select()
        .from(table)
        .where(eq(table.org_id, orgId))
        .orderBy(desc(table.created_at))
        .limit(2)
    : await db.select().from(table).orderBy(desc(table.created_at)).limit(2)

  if (snaps.length < 2) {
    return c.json({ kind, best: [], worst: [], all: [], message: 'Need at least two snapshots' })
  }

  const latest = (snaps[0].rankings ?? []) as unknown as RankRow[]
  const prior = (snaps[1].rankings ?? []) as unknown as RankRow[]
  const result = diffSnapshots(latest, prior)
  return c.json({ kind, ...result })
})

export default router
