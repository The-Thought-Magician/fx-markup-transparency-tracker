import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { wire_fees, payments, payment_markups, audit_events } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const wireFeeSchema = z.object({
  payment_id: z.string().min(1),
  kind: z.string().min(1).default('wire'),
  description: z.string().optional(),
  amount_cents: z.number().int().default(0),
  intermediary_bank: z.string().optional(),
})

// Recompute a payment's markup decomposition after wire-fee changes so the
// total cost reflects the summed wire/lifting charges.
async function recomputeMarkup(paymentId: string, userId: string) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId))
  if (!payment) return
  const [existing] = await db
    .select()
    .from(payment_markups)
    .where(eq(payment_markups.payment_id, paymentId))

  const fees = await db.select().from(wire_fees).where(eq(wire_fees.payment_id, paymentId))
  const wireFeeCents = fees.reduce((s, f) => s + (f.amount_cents ?? 0), 0)

  // Pull mid_rate from the existing decomposition if present, else recompute it
  // from the payment's applied rate (markup 0 baseline) so totals stay coherent.
  const midRate = existing ? existing.mid_rate : payment.applied_rate
  const appliedRate = payment.applied_rate
  const markupBps = midRate > 0 ? ((midRate - appliedRate) / midRate) * 10000 : 0
  const quoteAtMid = payment.notional_base * midRate
  const quoteReceived = payment.notional_base * appliedRate
  const hiddenSpreadBase = midRate > 0 ? (quoteAtMid - quoteReceived) / midRate : 0
  const hiddenSpreadCents = Math.round(hiddenSpreadBase * 100)
  const disclosedFeeCents = payment.disclosed_fee_cents
  const totalCostCents = disclosedFeeCents + hiddenSpreadCents + wireFeeCents
  const effectiveCostPct =
    payment.notional_base > 0 ? (totalCostCents / (payment.notional_base * 100)) * 100 : 0

  if (existing) {
    await db
      .update(payment_markups)
      .set({
        wire_fee_cents: wireFeeCents,
        total_cost_cents: totalCostCents,
        effective_cost_pct: effectiveCostPct,
      })
      .where(eq(payment_markups.payment_id, paymentId))
  } else {
    await db.insert(payment_markups).values({
      payment_id: paymentId,
      user_id: userId,
      mid_rate: midRate,
      applied_rate: appliedRate,
      markup_bps: markupBps,
      hidden_spread_cents: hiddenSpreadCents,
      disclosed_fee_cents: disclosedFeeCents,
      wire_fee_cents: wireFeeCents,
      total_cost_cents: totalCostCents,
      effective_cost_pct: effectiveCostPct,
    })
  }
}

async function recordAudit(
  orgId: string,
  userId: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(audit_events).values({
      org_id: orgId,
      user_id: userId,
      entity_type: 'wire_fee',
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // auditing is best-effort
  }
}

// Public: list wire fees (optionally filtered by ?payment_id)
router.get('/', async (c) => {
  const paymentId = c.req.query('payment_id')
  const rows = paymentId
    ? await db.select().from(wire_fees).where(eq(wire_fees.payment_id, paymentId))
    : await db.select().from(wire_fees)
  return c.json(rows)
})

// Auth: add a wire/lifting fee line, then recompute the payment markup
router.post('/', authMiddleware, zValidator('json', wireFeeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [payment] = await db.select().from(payments).where(eq(payments.id, body.payment_id))
  if (!payment) return c.json({ error: 'Payment not found' }, 404)

  const [fee] = await db
    .insert(wire_fees)
    .values({
      payment_id: body.payment_id,
      user_id: userId,
      kind: body.kind,
      description: body.description ?? null,
      amount_cents: body.amount_cents,
      intermediary_bank: body.intermediary_bank ?? null,
    })
    .returning()

  await recomputeMarkup(body.payment_id, userId)
  await recordAudit(payment.org_id, userId, fee.id, 'create', {
    payment_id: body.payment_id,
    amount_cents: body.amount_cents,
    kind: body.kind,
  })
  return c.json(fee, 201)
})

// Auth: update a fee line (ownership-checked), then recompute the payment markup
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', wireFeeSchema.partial().omit({ payment_id: true })),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(wire_fees).where(eq(wire_fees.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(wire_fees)
      .set({
        kind: body.kind ?? existing.kind,
        description: body.description ?? existing.description,
        amount_cents: body.amount_cents ?? existing.amount_cents,
        intermediary_bank: body.intermediary_bank ?? existing.intermediary_bank,
      })
      .where(eq(wire_fees.id, id))
      .returning()

    await recomputeMarkup(existing.payment_id, userId)
    const [payment] = await db.select().from(payments).where(eq(payments.id, existing.payment_id))
    if (payment) await recordAudit(payment.org_id, userId, id, 'update', { ...body })
    return c.json(updated)
  },
)

// Auth: delete a fee line (ownership-checked), then recompute the payment markup
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(wire_fees).where(eq(wire_fees.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(wire_fees).where(eq(wire_fees.id, id))
  await recomputeMarkup(existing.payment_id, userId)
  const [payment] = await db.select().from(payments).where(eq(payments.id, existing.payment_id))
  if (payment) await recordAudit(payment.org_id, userId, id, 'delete', { payment_id: existing.payment_id })
  return c.json({ success: true })
})

export default router
