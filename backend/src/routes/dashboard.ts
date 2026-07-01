import { Hono } from 'hono'
import { db } from '../db/index.js'
import { payments, payment_markups, corridors, providers } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

// A payment joined with its computed markup decomposition.
interface JoinedRow {
  payment: typeof payments.$inferSelect
  markup: typeof payment_markups.$inferSelect | null
}

async function loadJoined(orgId?: string): Promise<JoinedRow[]> {
  const base = db
    .select({ payment: payments, markup: payment_markups })
    .from(payments)
    .leftJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
  const rows = orgId
    ? await base.where(eq(payments.org_id, orgId))
    : await base
  return rows as JoinedRow[]
}

// total leakage (cents) = sum of hidden_spread + wire_fee + disclosed_fee across decomposed payments.
function leakageOf(m: typeof payment_markups.$inferSelect): number {
  return m.total_cost_cents
}

// ---------------------------------------------------------------------------
// GET /summary — headline KPIs
// ---------------------------------------------------------------------------
router.get('/summary', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id') || undefined
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await loadJoined(orgId)

  const paymentCount = rows.length
  const decomposed = rows.filter((r) => r.markup !== null)

  let totalLeakageCents = 0
  let totalNotionalCents = 0
  let markupBpsSum = 0
  let hiddenSpreadCents = 0
  let wireFeeCents = 0
  let disclosedFeeCents = 0
  let earliest: number | null = null
  let latest: number | null = null

  for (const r of decomposed) {
    const m = r.markup!
    totalLeakageCents += leakageOf(m)
    hiddenSpreadCents += m.hidden_spread_cents
    wireFeeCents += m.wire_fee_cents
    disclosedFeeCents += m.disclosed_fee_cents
    markupBpsSum += m.markup_bps
    totalNotionalCents += Math.round(r.payment.notional_base * 100)
    const vd = new Date(r.payment.value_date).getTime()
    if (earliest === null || vd < earliest) earliest = vd
    if (latest === null || vd > latest) latest = vd
  }

  const avgMarkupBps = decomposed.length ? markupBpsSum / decomposed.length : 0

  // Annualized projection: scale observed leakage by the fraction of a year the
  // observed value-date span covers. With <2 distinct dates, fall back to the
  // observed leakage (no extrapolation).
  let annualizedLeakageCents = totalLeakageCents
  if (earliest !== null && latest !== null && latest > earliest) {
    const spanDays = (latest - earliest) / (24 * 60 * 60 * 1000)
    if (spanDays >= 1) {
      annualizedLeakageCents = Math.round(totalLeakageCents * (365 / spanDays))
    }
  }

  return c.json({
    payment_count: paymentCount,
    decomposed_count: decomposed.length,
    total_leakage_cents: totalLeakageCents,
    total_notional_cents: totalNotionalCents,
    hidden_spread_cents: hiddenSpreadCents,
    wire_fee_cents: wireFeeCents,
    disclosed_fee_cents: disclosedFeeCents,
    avg_markup_bps: avgMarkupBps,
    annualized_leakage_cents: annualizedLeakageCents,
  })
})

// ---------------------------------------------------------------------------
// GET /trends — markup-over-time series (?org_id&period)
//   period: 'day' | 'week' | 'month' (default 'month')
// ---------------------------------------------------------------------------
function bucketKey(d: Date, period: string): string {
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  if (period === 'day') return `${y}-${mo}-${day}`
  if (period === 'week') {
    // ISO-ish week bucket: start-of-week (Monday) date as key.
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const dow = (tmp.getUTCDay() + 6) % 7 // 0 = Monday
    tmp.setUTCDate(tmp.getUTCDate() - dow)
    const wy = tmp.getUTCFullYear()
    const wmo = String(tmp.getUTCMonth() + 1).padStart(2, '0')
    const wday = String(tmp.getUTCDate()).padStart(2, '0')
    return `${wy}-${wmo}-${wday}`
  }
  // month
  return `${y}-${mo}`
}

router.get('/trends', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id') || undefined
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const period = (c.req.query('period') || 'month').toLowerCase()
  const rows = await loadJoined(orgId)

  const buckets = new Map<
    string,
    { markupBpsSum: number; count: number; leakageCents: number; notionalCents: number }
  >()

  for (const r of rows) {
    if (!r.markup) continue
    const key = bucketKey(new Date(r.payment.value_date), period)
    const b = buckets.get(key) ?? {
      markupBpsSum: 0,
      count: 0,
      leakageCents: 0,
      notionalCents: 0,
    }
    b.markupBpsSum += r.markup.markup_bps
    b.count += 1
    b.leakageCents += leakageOf(r.markup)
    b.notionalCents += Math.round(r.payment.notional_base * 100)
    buckets.set(key, b)
  }

  const series = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period_key, b]) => ({
      period: period_key,
      avg_markup_bps: b.count ? b.markupBpsSum / b.count : 0,
      leakage_cents: b.leakageCents,
      notional_cents: b.notionalCents,
      payment_count: b.count,
    }))

  return c.json(series)
})

// ---------------------------------------------------------------------------
// GET /top-offenders — top corridors/providers by leakage (?org_id)
// ---------------------------------------------------------------------------
router.get('/top-offenders', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id') || undefined
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await loadJoined(orgId)

  const corridorAgg = new Map<
    string,
    { leakageCents: number; markupBpsSum: number; count: number }
  >()
  const providerAgg = new Map<
    string,
    { leakageCents: number; markupBpsSum: number; count: number }
  >()

  for (const r of rows) {
    if (!r.markup) continue
    const leak = leakageOf(r.markup)
    const bps = r.markup.markup_bps

    if (r.payment.corridor_id) {
      const cId = r.payment.corridor_id
      const ca = corridorAgg.get(cId) ?? { leakageCents: 0, markupBpsSum: 0, count: 0 }
      ca.leakageCents += leak
      ca.markupBpsSum += bps
      ca.count += 1
      corridorAgg.set(cId, ca)
    }
    if (r.payment.provider_id) {
      const pId = r.payment.provider_id
      const pa = providerAgg.get(pId) ?? { leakageCents: 0, markupBpsSum: 0, count: 0 }
      pa.leakageCents += leak
      pa.markupBpsSum += bps
      pa.count += 1
      providerAgg.set(pId, pa)
    }
  }

  // Resolve labels/names.
  const corridorRows = orgId
    ? await db.select().from(corridors).where(eq(corridors.org_id, orgId))
    : await db.select().from(corridors)
  const providerRows = orgId
    ? await db.select().from(providers).where(eq(providers.org_id, orgId))
    : await db.select().from(providers)

  const corridorLabel = new Map(corridorRows.map((x) => [x.id, x.label]))
  const providerName = new Map(providerRows.map((x) => [x.id, x.name]))

  const topCorridors = [...corridorAgg.entries()]
    .map(([id, a]) => ({
      corridor_id: id,
      label: corridorLabel.get(id) ?? id,
      leakage_cents: a.leakageCents,
      avg_markup_bps: a.count ? a.markupBpsSum / a.count : 0,
      payment_count: a.count,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)
    .slice(0, 10)

  const topProviders = [...providerAgg.entries()]
    .map(([id, a]) => ({
      provider_id: id,
      name: providerName.get(id) ?? id,
      leakage_cents: a.leakageCents,
      avg_markup_bps: a.count ? a.markupBpsSum / a.count : 0,
      payment_count: a.count,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)
    .slice(0, 10)

  return c.json({ corridors: topCorridors, providers: topProviders })
})

export default router
