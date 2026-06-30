import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { savings_scenarios, scenario_legs } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Savings math
// ---------------------------------------------------------------------------
//
// A scenario models re-routing flow from one provider/corridor to another with
// a lower markup. For each leg:
//   - current cost   = notional_cents * current_markup_bps / 10000
//   - modeled cost   = notional_cents * modeled_markup_bps / 10000
//   - leg_savings    = current cost - modeled cost  (positive = savings)
// Scenario totals are the sum across legs.

function computeLeg(
  notionalCents: number,
  currentBps: number,
  modeledBps: number,
): { currentLeakage: number; modeledLeakage: number; legSavings: number } {
  const currentLeakage = Math.round((notionalCents * currentBps) / 10000)
  const modeledLeakage = Math.round((notionalCents * modeledBps) / 10000)
  return {
    currentLeakage,
    modeledLeakage,
    legSavings: currentLeakage - modeledLeakage,
  }
}

async function recomputeScenarioTotals(scenarioId: string): Promise<void> {
  const legs = await db
    .select()
    .from(scenario_legs)
    .where(eq(scenario_legs.scenario_id, scenarioId))
  let currentLeakage = 0
  let modeledLeakage = 0
  let savings = 0
  for (const leg of legs) {
    const r = computeLeg(leg.notional_cents, leg.current_markup_bps, leg.modeled_markup_bps)
    currentLeakage += r.currentLeakage
    modeledLeakage += r.modeledLeakage
    savings += r.legSavings
  }
  await db
    .update(savings_scenarios)
    .set({
      current_leakage_cents: currentLeakage,
      modeled_leakage_cents: modeledLeakage,
      projected_savings_cents: savings,
    })
    .where(eq(savings_scenarios.id, scenarioId))
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const scenarioSchema = z.object({
  org_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  target_markup_bps: z.number().optional().default(0),
})

const legSchema = z.object({
  corridor_id: z.string().optional(),
  from_provider_id: z.string().optional(),
  to_provider_id: z.string().optional(),
  notional_cents: z.number().int(),
  current_markup_bps: z.number(),
  modeled_markup_bps: z.number(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — public — savings scenarios (?org_id)
router.get('/', async (c) => {
  const orgId = c.req.query('org_id')
  const rows = orgId
    ? await db
        .select()
        .from(savings_scenarios)
        .where(eq(savings_scenarios.org_id, orgId))
        .orderBy(desc(savings_scenarios.created_at))
    : await db.select().from(savings_scenarios).orderBy(desc(savings_scenarios.created_at))
  return c.json(rows)
})

// GET /:id — public — scenario + legs
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [scenario] = await db
    .select()
    .from(savings_scenarios)
    .where(eq(savings_scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  const legs = await db
    .select()
    .from(scenario_legs)
    .where(eq(scenario_legs.scenario_id, id))
    .orderBy(scenario_legs.created_at)
  return c.json({ ...scenario, legs })
})

// POST / — auth — create scenario
router.post('/', authMiddleware, zValidator('json', scenarioSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(savings_scenarios)
    .values({
      org_id: body.org_id,
      user_id: userId,
      name: body.name,
      description: body.description ?? null,
      target_markup_bps: body.target_markup_bps ?? 0,
      current_leakage_cents: 0,
      modeled_leakage_cents: 0,
      projected_savings_cents: 0,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — auth — update scenario (recompute totals)
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', scenarioSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(savings_scenarios)
      .where(eq(savings_scenarios.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.description !== undefined) patch.description = body.description
    if (body.target_markup_bps !== undefined) patch.target_markup_bps = body.target_markup_bps
    if (Object.keys(patch).length > 0) {
      await db.update(savings_scenarios).set(patch).where(eq(savings_scenarios.id, id))
    }
    // Recompute totals from legs to keep them authoritative.
    await recomputeScenarioTotals(id)
    const [updated] = await db
      .select()
      .from(savings_scenarios)
      .where(eq(savings_scenarios.id, id))
    return c.json(updated)
  },
)

// DELETE /:id — auth — delete scenario + legs
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(savings_scenarios)
    .where(eq(savings_scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(scenario_legs).where(eq(scenario_legs.scenario_id, id))
  await db.delete(savings_scenarios).where(eq(savings_scenarios.id, id))
  return c.json({ success: true })
})

// POST /:id/legs — auth — add leg (compute leg savings + scenario totals)
router.post('/:id/legs', authMiddleware, zValidator('json', legSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [scenario] = await db
    .select()
    .from(savings_scenarios)
    .where(eq(savings_scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  if (scenario.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const { legSavings } = computeLeg(
    body.notional_cents,
    body.current_markup_bps,
    body.modeled_markup_bps,
  )
  const [leg] = await db
    .insert(scenario_legs)
    .values({
      scenario_id: id,
      user_id: userId,
      corridor_id: body.corridor_id ?? null,
      from_provider_id: body.from_provider_id ?? null,
      to_provider_id: body.to_provider_id ?? null,
      notional_cents: body.notional_cents,
      current_markup_bps: body.current_markup_bps,
      modeled_markup_bps: body.modeled_markup_bps,
      leg_savings_cents: legSavings,
    })
    .returning()
  await recomputeScenarioTotals(id)
  return c.json(leg, 201)
})

// PUT /:id/legs/:legId — auth — update leg
router.put(
  '/:id/legs/:legId',
  authMiddleware,
  zValidator('json', legSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const legId = c.req.param('legId')
    const [scenario] = await db
      .select()
      .from(savings_scenarios)
      .where(eq(savings_scenarios.id, id))
    if (!scenario) return c.json({ error: 'Not found' }, 404)
    if (scenario.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    const [existing] = await db
      .select()
      .from(scenario_legs)
      .where(and(eq(scenario_legs.id, legId), eq(scenario_legs.scenario_id, id)))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const body = c.req.valid('json')
    const notional = body.notional_cents ?? existing.notional_cents
    const currentBps = body.current_markup_bps ?? existing.current_markup_bps
    const modeledBps = body.modeled_markup_bps ?? existing.modeled_markup_bps
    const { legSavings } = computeLeg(notional, currentBps, modeledBps)
    const patch: Record<string, unknown> = {
      notional_cents: notional,
      current_markup_bps: currentBps,
      modeled_markup_bps: modeledBps,
      leg_savings_cents: legSavings,
    }
    if (body.corridor_id !== undefined) patch.corridor_id = body.corridor_id
    if (body.from_provider_id !== undefined) patch.from_provider_id = body.from_provider_id
    if (body.to_provider_id !== undefined) patch.to_provider_id = body.to_provider_id
    const [updated] = await db
      .update(scenario_legs)
      .set(patch)
      .where(eq(scenario_legs.id, legId))
      .returning()
    await recomputeScenarioTotals(id)
    return c.json(updated)
  },
)

// DELETE /:id/legs/:legId — auth — delete leg
router.delete('/:id/legs/:legId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const legId = c.req.param('legId')
  const [scenario] = await db
    .select()
    .from(savings_scenarios)
    .where(eq(savings_scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  if (scenario.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [existing] = await db
    .select()
    .from(scenario_legs)
    .where(and(eq(scenario_legs.id, legId), eq(scenario_legs.scenario_id, id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(scenario_legs).where(eq(scenario_legs.id, legId))
  await recomputeScenarioTotals(id)
  return c.json({ success: true })
})

export default router
