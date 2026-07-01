import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  fee_reconciliations,
  payments,
  wire_fees,
  provider_fee_schedules,
  providers,
  audit_events,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const runSchema = z.object({
  org_id: z.string().optional(),
  payment_ids: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  status: z.enum(['open', 'matched', 'disputed', 'resolved']).optional(),
  notes: z.string().optional(),
})

// Compute expected vs observed fee for a single payment using the provider's
// current fee schedule. Expected = wire_fee + lifting + stated_fx_fee_pct*notional.
// Observed = disclosed fee + summed wire-fee lines (incl. lifting charges).
async function computeForPayment(paymentId: string) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId))
  if (!payment) return null

  const fees = await db.select().from(wire_fees).where(eq(wire_fees.payment_id, paymentId))
  const summedWireCents = fees.reduce((s, f) => s + (f.amount_cents ?? 0), 0)
  const observedFeeCents = payment.disclosed_fee_cents + summedWireCents

  let expectedFeeCents = 0
  if (payment.provider_id) {
    const [schedule] = await db
      .select()
      .from(provider_fee_schedules)
      .where(
        and(
          eq(provider_fee_schedules.provider_id, payment.provider_id),
          eq(provider_fee_schedules.is_current, true),
        ),
      )
      .orderBy(desc(provider_fee_schedules.effective_date))
    if (schedule) {
      const fxFeeCents = Math.round(
        payment.notional_base * (schedule.stated_fx_fee_pct / 100) * 100,
      )
      expectedFeeCents = schedule.wire_fee_cents + schedule.lifting_charge_cents + fxFeeCents
    }
  }

  const varianceCents = observedFeeCents - expectedFeeCents
  return { payment, expectedFeeCents, observedFeeCents, varianceCents }
}

// Auth: list reconciliations, filtered by required ?org_id and optional ?status.
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  const status = c.req.query('status')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)

  // fee_reconciliations is keyed by payment; org filtering requires the payment join.
  const rows = await db
    .select({
      recon: fee_reconciliations,
      org_id: payments.org_id,
      provider_id: payments.provider_id,
      reference: payments.reference,
    })
    .from(fee_reconciliations)
    .innerJoin(payments, eq(fee_reconciliations.payment_id, payments.id))

  let filtered = rows.filter((r) => r.org_id === orgId)
  if (status) filtered = filtered.filter((r) => r.recon.status === status)

  return c.json(
    filtered.map((r) => ({
      ...r.recon,
      org_id: r.org_id,
      provider_id: r.provider_id,
      reference: r.reference,
    })),
  )
})

// Auth: reconciliation for a single payment.
router.get('/:paymentId', authMiddleware, async (c) => {
  const paymentId = c.req.param('paymentId')
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId))
  if (!payment) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), payment.org_id))) return c.json({ error: 'Not found' }, 404)
  const [recon] = await db
    .select()
    .from(fee_reconciliations)
    .where(eq(fee_reconciliations.payment_id, paymentId))
  if (!recon) return c.json({ error: 'Not found' }, 404)
  return c.json(recon)
})

// Auth: run reconciliation for a set of payments (compare schedule vs observed),
// upserting one fee_reconciliations row per payment.
router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let targetPayments: { id: string; org_id: string }[]
  if (body.payment_ids && body.payment_ids.length > 0) {
    targetPayments = []
    for (const pid of body.payment_ids) {
      const [p] = await db.select().from(payments).where(eq(payments.id, pid))
      if (p) targetPayments.push({ id: p.id, org_id: p.org_id })
    }
  } else if (body.org_id) {
    const ps = await db.select().from(payments).where(eq(payments.org_id, body.org_id))
    targetPayments = ps.map((p) => ({ id: p.id, org_id: p.org_id }))
  } else {
    const ps = await db.select().from(payments)
    targetPayments = ps.map((p) => ({ id: p.id, org_id: p.org_id }))
  }

  let reconciled = 0
  for (const tp of targetPayments) {
    const result = await computeForPayment(tp.id)
    if (!result) continue
    const status = result.varianceCents === 0 ? 'matched' : 'disputed'
    const [existing] = await db
      .select()
      .from(fee_reconciliations)
      .where(eq(fee_reconciliations.payment_id, tp.id))
    if (existing) {
      await db
        .update(fee_reconciliations)
        .set({
          expected_fee_cents: result.expectedFeeCents,
          observed_fee_cents: result.observedFeeCents,
          variance_cents: result.varianceCents,
          status: existing.status === 'resolved' ? 'resolved' : status,
        })
        .where(eq(fee_reconciliations.payment_id, tp.id))
    } else {
      await db.insert(fee_reconciliations).values({
        payment_id: tp.id,
        user_id: userId,
        expected_fee_cents: result.expectedFeeCents,
        observed_fee_cents: result.observedFeeCents,
        variance_cents: result.varianceCents,
        status,
      })
    }
    reconciled++
    try {
      await db.insert(audit_events).values({
        org_id: tp.org_id,
        user_id: userId,
        entity_type: 'fee_reconciliation',
        entity_id: tp.id,
        action: 'run',
        detail: { variance_cents: result.varianceCents },
      })
    } catch {
      // best-effort
    }
  }

  return c.json({ reconciled })
})

// Auth: update reconciliation status/notes (ownership-checked).
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(fee_reconciliations).where(eq(fee_reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(fee_reconciliations)
    .set({
      status: body.status ?? existing.status,
      notes: body.notes ?? existing.notes,
    })
    .where(eq(fee_reconciliations.id, id))
    .returning()
  return c.json(updated)
})

// Auth: aggregate variance per provider (?org_id required).
router.get('/variance/by-provider', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select({
      recon: fee_reconciliations,
      provider_id: payments.provider_id,
      org_id: payments.org_id,
    })
    .from(fee_reconciliations)
    .innerJoin(payments, eq(fee_reconciliations.payment_id, payments.id))

  const scoped = rows.filter((r) => r.org_id === orgId)

  const byProvider = new Map<
    string,
    { provider_id: string; count: number; total_variance_cents: number; total_expected_cents: number; total_observed_cents: number }
  >()
  for (const r of scoped) {
    const pid = r.provider_id ?? 'unassigned'
    const agg =
      byProvider.get(pid) ??
      {
        provider_id: pid,
        count: 0,
        total_variance_cents: 0,
        total_expected_cents: 0,
        total_observed_cents: 0,
      }
    agg.count++
    agg.total_variance_cents += r.recon.variance_cents
    agg.total_expected_cents += r.recon.expected_fee_cents
    agg.total_observed_cents += r.recon.observed_fee_cents
    byProvider.set(pid, agg)
  }

  // attach provider names where available
  const out = []
  for (const agg of byProvider.values()) {
    let name: string | null = null
    if (agg.provider_id !== 'unassigned') {
      const [p] = await db.select().from(providers).where(eq(providers.id, agg.provider_id))
      name = p ? p.name : null
    }
    out.push({
      ...agg,
      provider_name: name,
      avg_variance_cents: agg.count > 0 ? Math.round(agg.total_variance_cents / agg.count) : 0,
    })
  }
  out.sort((a, b) => Math.abs(b.total_variance_cents) - Math.abs(a.total_variance_cents))
  return c.json(out)
})

export default router
