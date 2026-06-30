import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { benchmark_rates, payments } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  org_id: z.string().min(1),
  source_id: z.string().min(1).optional(),
  base_currency: z.string().min(1),
  quote_currency: z.string().min(1),
  mid_rate: z.number().positive(),
  captured_at: z.string().min(1).optional(),
})

const backfillSchema = z.object({
  org_id: z.string().min(1),
})

// Pick the benchmark rate for (base,quote) whose captured_at is closest to `at`.
function nearest<T extends { captured_at: Date | string }>(rows: T[], at: number): T | null {
  if (rows.length === 0) return null
  let best = rows[0]
  let bestDelta = Math.abs(new Date(rows[0].captured_at).getTime() - at)
  for (const r of rows) {
    const delta = Math.abs(new Date(r.captured_at).getTime() - at)
    if (delta < bestDelta) {
      best = r
      bestDelta = delta
    }
  }
  return best
}

// GET / — public — list benchmark rates (?base&quote&org_id)
router.get('/', async (c) => {
  const base = c.req.query('base')
  const quote = c.req.query('quote')
  const orgId = c.req.query('org_id')
  const conds = []
  if (base) conds.push(eq(benchmark_rates.base_currency, base))
  if (quote) conds.push(eq(benchmark_rates.quote_currency, quote))
  if (orgId) conds.push(eq(benchmark_rates.org_id, orgId))
  const rows = conds.length
    ? await db
        .select()
        .from(benchmark_rates)
        .where(and(...conds))
        .orderBy(desc(benchmark_rates.captured_at))
    : await db.select().from(benchmark_rates).orderBy(desc(benchmark_rates.captured_at))
  return c.json(rows)
})

// GET /lookup — public — nearest rate at time (?base&quote&at&org_id)
router.get('/lookup', async (c) => {
  const base = c.req.query('base')
  const quote = c.req.query('quote')
  const at = c.req.query('at')
  const orgId = c.req.query('org_id')
  if (!base || !quote) {
    return c.json({ error: 'base and quote are required' }, 400)
  }
  const atMs = at ? Date.parse(at) : Date.now()
  if (!Number.isFinite(atMs)) {
    return c.json({ error: 'at must be a valid ISO-8601 timestamp' }, 400)
  }
  const conds = [
    eq(benchmark_rates.base_currency, base),
    eq(benchmark_rates.quote_currency, quote),
  ]
  if (orgId) conds.push(eq(benchmark_rates.org_id, orgId))
  const rows = await db
    .select()
    .from(benchmark_rates)
    .where(and(...conds))
    .orderBy(desc(benchmark_rates.captured_at))
  const match = nearest(rows, atMs)
  if (!match) return c.json({ error: 'No benchmark rate found' }, 404)
  return c.json(match)
})

// POST / — auth — capture a benchmark rate
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(benchmark_rates)
    .values({
      org_id: body.org_id,
      user_id: userId,
      source_id: body.source_id ?? null,
      base_currency: body.base_currency,
      quote_currency: body.quote_currency,
      mid_rate: body.mid_rate,
      captured_at: body.captured_at ? new Date(body.captured_at) : new Date(),
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /:id — auth — delete rate
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(benchmark_rates).where(eq(benchmark_rates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(benchmark_rates).where(eq(benchmark_rates.id, id))
  return c.json({ success: true })
})

// POST /backfill — auth — attach nearest benchmark to payments lacking one
router.post('/backfill', authMiddleware, zValidator('json', backfillSchema), async (c) => {
  getUserId(c)
  const { org_id } = c.req.valid('json')

  const orgPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.org_id, org_id))

  const orgRates = await db
    .select()
    .from(benchmark_rates)
    .where(eq(benchmark_rates.org_id, org_id))

  let updated = 0
  for (const p of orgPayments) {
    if (p.benchmark_rate_id) continue
    const candidates = orgRates.filter(
      (r) => r.base_currency === p.base_currency && r.quote_currency === p.quote_currency,
    )
    const match = nearest(candidates, new Date(p.value_date).getTime())
    if (!match) continue
    await db
      .update(payments)
      .set({ benchmark_rate_id: match.id })
      .where(eq(payments.id, p.id))
    updated++
  }

  return c.json({ updated })
})

export default router
