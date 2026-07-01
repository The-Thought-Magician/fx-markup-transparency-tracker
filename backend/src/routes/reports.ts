import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reports,
  report_schedules,
  organizations,
  payments,
  payment_markups,
  providers,
  corridors,
  audit_events,
} from '../db/schema.js'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'
import {
  validateExpression,
  describeExpression,
  nextFirings,
  dstTraps,
  type ScheduleKind,
} from '../lib/cron.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1).optional().default('decomposition'),
  config: z.record(z.string(), z.unknown()).optional().default({}),
})

const scheduleSchema = z.object({
  cadence: z.string().min(1).optional().default('monthly'),
  recipient_email: z.string().email().optional().nullable(),
  is_enabled: z.boolean().optional().default(true),
  // optional cron-engine schedule descriptor for preview/timeline
  schedule_kind: z.enum(['cron', 'rate', 'oneoff']).optional(),
  schedule_expr: z.string().optional(),
  timezone: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Cadence -> cron-engine schedule descriptor
// ---------------------------------------------------------------------------

function cadenceToSchedule(cadence: string): { kind: ScheduleKind; expr: string } {
  switch (cadence) {
    case 'daily':
      return { kind: 'cron', expr: '0 8 * * *' }
    case 'weekly':
      return { kind: 'cron', expr: '0 8 * * 1' }
    case 'monthly':
      return { kind: 'cron', expr: '0 8 1 * *' }
    case 'quarterly':
      return { kind: 'cron', expr: '0 8 1 1,4,7,10 *' }
    default: {
      // allow a raw "every N ..." rate expression as the cadence
      if (/^\s*every\s+/i.test(cadence)) return { kind: 'rate', expr: cadence }
      return { kind: 'cron', expr: '0 8 1 * *' }
    }
  }
}

// ---------------------------------------------------------------------------
// Report generation — computes a real result payload over the DB
// ---------------------------------------------------------------------------

async function buildReportResult(
  orgId: string,
  kind: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Pull all payments + markups for the org.
  const orgPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.org_id, orgId))
    .orderBy(desc(payments.value_date))

  const markups = await db.select().from(payment_markups)
  const markupByPayment = new Map(markups.map((m) => [m.payment_id, m]))

  const orgProviders = await db.select().from(providers).where(eq(providers.org_id, orgId))
  const orgCorridors = await db.select().from(corridors).where(eq(corridors.org_id, orgId))
  const providerName = new Map(orgProviders.map((p) => [p.id, p.name]))
  const corridorLabel = new Map(orgCorridors.map((cr) => [cr.id, cr.label]))

  let totalNotionalCents = 0
  let totalMarkupCents = 0
  let totalHiddenSpreadCents = 0
  let totalDisclosedFeeCents = 0
  let totalWireFeeCents = 0
  let totalCostCents = 0
  let markupBpsSum = 0
  let markupBpsCount = 0

  const byProvider = new Map<string, { leakage_cents: number; payments: number; bps_sum: number }>()
  const byCorridor = new Map<string, { leakage_cents: number; payments: number; bps_sum: number }>()

  for (const p of orgPayments) {
    totalNotionalCents += Math.round(p.notional_base * 100)
    const m = markupByPayment.get(p.id)
    if (!m) continue
    totalHiddenSpreadCents += m.hidden_spread_cents
    totalDisclosedFeeCents += m.disclosed_fee_cents
    totalWireFeeCents += m.wire_fee_cents
    totalCostCents += m.total_cost_cents
    totalMarkupCents += m.hidden_spread_cents
    markupBpsSum += m.markup_bps
    markupBpsCount += 1

    if (p.provider_id) {
      const cur = byProvider.get(p.provider_id) ?? { leakage_cents: 0, payments: 0, bps_sum: 0 }
      cur.leakage_cents += m.total_cost_cents
      cur.payments += 1
      cur.bps_sum += m.markup_bps
      byProvider.set(p.provider_id, cur)
    }
    if (p.corridor_id) {
      const cur = byCorridor.get(p.corridor_id) ?? { leakage_cents: 0, payments: 0, bps_sum: 0 }
      cur.leakage_cents += m.total_cost_cents
      cur.payments += 1
      cur.bps_sum += m.markup_bps
      byCorridor.set(p.corridor_id, cur)
    }
  }

  const avgMarkupBps = markupBpsCount > 0 ? markupBpsSum / markupBpsCount : 0

  const providerBreakdown = [...byProvider.entries()]
    .map(([id, v]) => ({
      provider_id: id,
      provider_name: providerName.get(id) ?? 'Unknown',
      leakage_cents: v.leakage_cents,
      payments: v.payments,
      avg_markup_bps: v.payments > 0 ? v.bps_sum / v.payments : 0,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)

  const corridorBreakdown = [...byCorridor.entries()]
    .map(([id, v]) => ({
      corridor_id: id,
      corridor_label: corridorLabel.get(id) ?? 'Unknown',
      leakage_cents: v.leakage_cents,
      payments: v.payments,
      avg_markup_bps: v.payments > 0 ? v.bps_sum / v.payments : 0,
    }))
    .sort((a, b) => b.leakage_cents - a.leakage_cents)

  const summary = {
    payment_count: orgPayments.length,
    total_notional_cents: totalNotionalCents,
    total_markup_cents: totalMarkupCents,
    total_hidden_spread_cents: totalHiddenSpreadCents,
    total_disclosed_fee_cents: totalDisclosedFeeCents,
    total_wire_fee_cents: totalWireFeeCents,
    total_cost_cents: totalCostCents,
    avg_markup_bps: avgMarkupBps,
  }

  if (kind === 'leakage_by_provider') {
    return { kind, generated_at: new Date().toISOString(), summary, providers: providerBreakdown }
  }
  if (kind === 'leakage_by_corridor') {
    return { kind, generated_at: new Date().toISOString(), summary, corridors: corridorBreakdown }
  }
  // default 'decomposition' (and any custom kind) returns the full picture
  return {
    kind,
    generated_at: new Date().toISOString(),
    config,
    summary,
    providers: providerBreakdown,
    corridors: corridorBreakdown,
  }
}

async function recordAudit(
  orgId: string,
  userId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(audit_events).values({
      org_id: orgId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // audit is best-effort; never block the primary write
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

// Auth: list saved reports (?org_id required)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db.select().from(reports).where(eq(reports.org_id, orgId)).orderBy(desc(reports.created_at))
  return c.json(rows)
})

// Auth: one report
router.get('/:id', authMiddleware, async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), r.org_id))) return c.json({ error: 'Not found' }, 404)
  return c.json(r)
})

// Auth: schedules for a report
router.get('/:id/schedules', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select().from(reports).where(eq(reports.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), r.org_id))) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(report_schedules)
    .where(eq(report_schedules.report_id, id))
    .orderBy(desc(report_schedules.created_at))
  // enrich each schedule with the next firings + a human description
  const enriched = rows.map((s) => {
    const { kind, expr } = cadenceToSchedule(s.cadence)
    return {
      ...s,
      schedule: {
        kind,
        expr,
        description: describeExpression(kind, expr),
        next_firings: nextFirings(kind, expr, 'UTC', new Date().toISOString(), 5),
      },
    }
  })
  return c.json(enriched)
})

// Auth: create + generate report
router.post('/', authMiddleware, zValidator('json', reportSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [org] = await db.select().from(organizations).where(eq(organizations.id, body.org_id))
  if (!org) return c.json({ error: 'Organization not found' }, 404)

  const result = await buildReportResult(body.org_id, body.kind, body.config)
  const [created] = await db
    .insert(reports)
    .values({
      org_id: body.org_id,
      user_id: userId,
      name: body.name,
      kind: body.kind,
      config: body.config,
      result,
    })
    .returning()
  await recordAudit(body.org_id, userId, 'report', created.id, 'create', { name: body.name, kind: body.kind })
  return c.json(created, 201)
})

// Auth: regenerate report result
router.post('/:id/generate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const result = await buildReportResult(
    existing.org_id,
    existing.kind,
    (existing.config as Record<string, unknown>) ?? {},
  )
  const [updated] = await db
    .update(reports)
    .set({ result })
    .where(eq(reports.id, id))
    .returning()
  await recordAudit(existing.org_id, userId, 'report', id, 'generate', { kind: existing.kind })
  return c.json(updated)
})

// Auth: delete report (cascade its schedules)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(report_schedules).where(eq(report_schedules.report_id, id))
  await db.delete(reports).where(eq(reports.id, id))
  await recordAudit(existing.org_id, userId, 'report', id, 'delete', {})
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Per-report schedule CRUD
// ---------------------------------------------------------------------------

// Auth: create schedule
router.post('/:id/schedules', authMiddleware, zValidator('json', scheduleSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [report] = await db.select().from(reports).where(eq(reports.id, id))
  if (!report) return c.json({ error: 'Report not found' }, 404)
  if (report.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // If a raw schedule expression was provided, validate it via the cron engine.
  if (body.schedule_kind && body.schedule_expr) {
    const v = validateExpression(body.schedule_kind, body.schedule_expr)
    if (!v.valid) return c.json({ error: `Invalid schedule: ${v.error}` }, 400)
  } else {
    // otherwise validate the derived cadence schedule
    const { kind, expr } = cadenceToSchedule(body.cadence)
    const v = validateExpression(kind, expr)
    if (!v.valid) return c.json({ error: `Invalid cadence: ${v.error}` }, 400)
  }

  const [created] = await db
    .insert(report_schedules)
    .values({
      report_id: id,
      user_id: userId,
      cadence: body.cadence,
      recipient_email: body.recipient_email ?? null,
      is_enabled: body.is_enabled,
    })
    .returning()

  const { kind, expr } =
    body.schedule_kind && body.schedule_expr
      ? { kind: body.schedule_kind as ScheduleKind, expr: body.schedule_expr }
      : cadenceToSchedule(body.cadence)
  const tz = body.timezone ?? 'UTC'

  await recordAudit(report.org_id, userId, 'report_schedule', created.id, 'create', {
    report_id: id,
    cadence: body.cadence,
  })

  return c.json(
    {
      ...created,
      schedule: {
        kind,
        expr,
        timezone: tz,
        description: describeExpression(kind, expr, tz),
        next_firings: nextFirings(kind, expr, tz, new Date().toISOString(), 5),
        dst_traps: dstTraps(kind, expr, tz),
      },
    },
    201,
  )
})

// Auth: delete schedule
router.delete('/:id/schedules/:scheduleId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const scheduleId = c.req.param('scheduleId')
  const [report] = await db.select().from(reports).where(eq(reports.id, id))
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const [existing] = await db
    .select()
    .from(report_schedules)
    .where(and(eq(report_schedules.id, scheduleId), eq(report_schedules.report_id, id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(report_schedules).where(eq(report_schedules.id, scheduleId))
  await recordAudit(report.org_id, userId, 'report_schedule', scheduleId, 'delete', { report_id: id })
  return c.json({ success: true })
})

export default router
