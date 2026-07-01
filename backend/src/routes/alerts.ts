import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { alerts, alert_rules, payments, payment_markups } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Comparator evaluation
// ---------------------------------------------------------------------------

function compare(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
    case 'eq':
      return value === threshold
    case 'neq':
      return value !== threshold
    default:
      return false
  }
}

// Pull the metric value for a payment from its markup decomposition.
function metricValue(
  metric: string,
  m: {
    markup_bps: number
    hidden_spread_cents: number
    total_cost_cents: number
    effective_cost_pct: number
    wire_fee_cents: number
    disclosed_fee_cents: number
  },
): number {
  switch (metric) {
    case 'markup_bps':
      return m.markup_bps
    case 'hidden_spread_cents':
      return m.hidden_spread_cents
    case 'total_cost_cents':
      return m.total_cost_cents
    case 'effective_cost_pct':
      return m.effective_cost_pct
    case 'wire_fee_cents':
      return m.wire_fee_cents
    case 'disclosed_fee_cents':
      return m.disclosed_fee_cents
    default:
      return m.markup_bps
  }
}

function severityFor(comparator: string, value: number, threshold: number): string {
  // For "over" comparators, escalate severity the further over threshold.
  if ((comparator === 'gt' || comparator === 'gte') && threshold !== 0) {
    const ratio = value / threshold
    if (ratio >= 2) return 'critical'
    if (ratio >= 1.5) return 'warning'
    return 'info'
  }
  return 'warning'
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  metric: z.string().optional().default('markup_bps'),
  comparator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']).optional().default('gt'),
  threshold: z.number().optional().default(0),
  is_enabled: z.boolean().optional().default(true),
})

const evaluateSchema = z.object({
  org_id: z.string().min(1),
})

const alertUpdateSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
})

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

// GET / — auth — alerts (?org_id required&status)
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const status = c.req.query('status')
  const conds = [eq(alerts.org_id, orgId)]
  if (status) conds.push(eq(alerts.status, status))
  const rows = await db.select().from(alerts).where(and(...conds)).orderBy(desc(alerts.created_at))
  return c.json(rows)
})

// GET /rules — auth — alert rules (?org_id required)
router.get('/rules', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(alert_rules)
    .where(eq(alert_rules.org_id, orgId))
    .orderBy(desc(alert_rules.created_at))
  return c.json(rows)
})

// POST /evaluate — auth — evaluate enabled rules, generate alerts
router.post('/evaluate', authMiddleware, zValidator('json', evaluateSchema), async (c) => {
  const userId = getUserId(c)
  const { org_id } = c.req.valid('json')

  const rules = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.org_id, org_id), eq(alert_rules.is_enabled, true)))

  if (rules.length === 0) return c.json({ generated: 0, alerts: [] })

  // Payments + their markup decomposition for this org.
  const rows = await db
    .select({
      payment_id: payments.id,
      reference: payments.reference,
      markup_bps: payment_markups.markup_bps,
      hidden_spread_cents: payment_markups.hidden_spread_cents,
      total_cost_cents: payment_markups.total_cost_cents,
      effective_cost_pct: payment_markups.effective_cost_pct,
      wire_fee_cents: payment_markups.wire_fee_cents,
      disclosed_fee_cents: payment_markups.disclosed_fee_cents,
    })
    .from(payments)
    .innerJoin(payment_markups, eq(payment_markups.payment_id, payments.id))
    .where(eq(payments.org_id, org_id))

  // Existing open/acknowledged alerts to avoid duplicates per (rule, payment).
  const existing = await db
    .select()
    .from(alerts)
    .where(eq(alerts.org_id, org_id))
  const seen = new Set<string>()
  for (const a of existing) {
    if (a.status !== 'resolved' && a.rule_id && a.payment_id) {
      seen.add(`${a.rule_id}:${a.payment_id}`)
    }
  }

  const toInsert: Array<typeof alerts.$inferInsert> = []
  for (const rule of rules) {
    for (const r of rows) {
      const value = metricValue(rule.metric, r)
      if (!compare(value, rule.comparator, rule.threshold)) continue
      const key = `${rule.id}:${r.payment_id}`
      if (seen.has(key)) continue
      seen.add(key)
      const sev = severityFor(rule.comparator, value, rule.threshold)
      toInsert.push({
        org_id,
        user_id: userId,
        rule_id: rule.id,
        payment_id: r.payment_id,
        message: `Rule "${rule.name}" triggered on payment ${
          r.reference ?? r.payment_id
        }: ${rule.metric}=${value} ${rule.comparator} ${rule.threshold}`,
        severity: sev,
        status: 'open',
      })
    }
  }

  let generated: Array<typeof alerts.$inferSelect> = []
  if (toInsert.length > 0) {
    generated = await db.insert(alerts).values(toInsert).returning()
  }
  return c.json({ generated: generated.length, alerts: generated })
})

// PUT /:id — auth — acknowledge/resolve alert
router.put('/:id', authMiddleware, zValidator('json', alertUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const { status } = c.req.valid('json')
  const [updated] = await db
    .update(alerts)
    .set({ status })
    .where(eq(alerts.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete alert
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(alerts).where(eq(alerts.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

// POST /rules — auth — create rule
router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(alert_rules)
    .values({
      org_id: body.org_id,
      user_id: userId,
      name: body.name,
      metric: body.metric ?? 'markup_bps',
      comparator: body.comparator ?? 'gt',
      threshold: body.threshold ?? 0,
      is_enabled: body.is_enabled ?? true,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /rules/:id — auth — update rule (toggle enable)
router.put(
  '/rules/:id',
  authMiddleware,
  zValidator('json', ruleSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.metric !== undefined) patch.metric = body.metric
    if (body.comparator !== undefined) patch.comparator = body.comparator
    if (body.threshold !== undefined) patch.threshold = body.threshold
    if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled
    if (Object.keys(patch).length === 0) return c.json(existing)
    const [updated] = await db
      .update(alert_rules)
      .set(patch)
      .where(eq(alert_rules.id, id))
      .returning()
    return c.json(updated)
  },
)

// DELETE /rules/:id — auth — delete rule
router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(alert_rules).where(eq(alert_rules.id, id))
  return c.json({ success: true })
})

export default router
