import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  import_batches,
  import_rows,
  payments,
  payment_markups,
  benchmark_rates,
  provider_mappings,
  audit_events,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, assertOrgMember } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  org_id: z.string().min(1),
  provider_id: z.string().optional(),
  filename: z.string().min(1),
  format: z.enum(['csv', 'json']).default('csv'),
  // raw text payload (CSV with header row, or JSON array of objects)
  content: z.string().min(1),
  // optional mapping id to apply known provider->canonical field names
  mapping_id: z.string().optional(),
})

const commitSchema = z.object({
  // optionally only commit a subset of rows; defaults to all valid rows
  row_ids: z.array(z.string()).optional(),
})

// Canonical payment fields the importer maps incoming rows onto.
const CANONICAL_FIELDS = [
  'reference',
  'base_currency',
  'quote_currency',
  'notional_base',
  'applied_rate',
  'disclosed_fee_cents',
  'value_date',
]

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const headers = splitCsvLine(lines[0]).map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim()
    })
    out.push(row)
  }
  return out
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// Normalize a raw row into canonical payment fields, applying an optional
// field map (incoming column name -> canonical name). Returns the normalized
// object plus any validation error string.
function normalizeRow(
  raw: Record<string, unknown>,
  fieldMap: Record<string, string>,
): { normalized: Record<string, unknown>; error: string | null } {
  const remapped: Record<string, unknown> = {}
  // apply explicit field map first
  for (const [from, to] of Object.entries(fieldMap)) {
    if (raw[from] !== undefined) remapped[to] = raw[from]
  }
  // then pass through any column already named canonically
  for (const f of CANONICAL_FIELDS) {
    if (remapped[f] === undefined && raw[f] !== undefined) remapped[f] = raw[f]
  }

  const normalized: Record<string, unknown> = {}
  normalized.reference = remapped.reference != null ? String(remapped.reference) : null
  normalized.base_currency = remapped.base_currency != null ? String(remapped.base_currency).toUpperCase() : ''
  normalized.quote_currency =
    remapped.quote_currency != null ? String(remapped.quote_currency).toUpperCase() : ''
  normalized.notional_base = remapped.notional_base != null ? Number(remapped.notional_base) : NaN
  normalized.applied_rate = remapped.applied_rate != null ? Number(remapped.applied_rate) : NaN
  normalized.disclosed_fee_cents =
    remapped.disclosed_fee_cents != null ? Math.round(Number(remapped.disclosed_fee_cents)) : 0
  const vd = remapped.value_date != null ? String(remapped.value_date) : ''
  normalized.value_date = vd

  let error: string | null = null
  if (!normalized.base_currency || !normalized.quote_currency) {
    error = 'Missing base/quote currency'
  } else if (!Number.isFinite(normalized.notional_base as number) || (normalized.notional_base as number) <= 0) {
    error = 'Invalid notional_base'
  } else if (!Number.isFinite(normalized.applied_rate as number) || (normalized.applied_rate as number) <= 0) {
    error = 'Invalid applied_rate'
  } else if (!vd || Number.isNaN(Date.parse(vd))) {
    error = 'Invalid value_date'
  }
  return { normalized, error }
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
      entity_type: 'import_batch',
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // best-effort
  }
}

// Auth: list import batches (?org_id required).
router.get('/', authMiddleware, async (c) => {
  const orgId = c.req.query('org_id')
  if (!orgId) return c.json({ error: 'org_id is required' }, 400)
  if (!(await assertOrgMember(getUserId(c), orgId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(import_batches)
    .where(eq(import_batches.org_id, orgId))
    .orderBy(desc(import_batches.created_at))
  return c.json(rows)
})

// Auth: batch + its rows.
router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.select().from(import_batches).where(eq(import_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), batch.org_id))) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(import_rows)
    .where(eq(import_rows.batch_id, id))
    .orderBy(import_rows.created_at)
  return c.json({ ...batch, rows })
})

// Auth: rows for a batch.
router.get('/:id/rows', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.select().from(import_batches).where(eq(import_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (!(await assertOrgMember(getUserId(c), batch.org_id))) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(import_rows)
    .where(eq(import_rows.batch_id, id))
    .orderBy(import_rows.created_at)
  return c.json(rows)
})

// Auth: create a batch and parse rows from the supplied payload.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // resolve an optional field map
  let fieldMap: Record<string, string> = {}
  if (body.mapping_id) {
    const [mapping] = await db
      .select()
      .from(provider_mappings)
      .where(eq(provider_mappings.id, body.mapping_id))
    if (mapping && mapping.field_map) fieldMap = mapping.field_map
  }

  // parse the payload into raw rows
  let rawRows: Record<string, unknown>[] = []
  let parseError: string | null = null
  try {
    if (body.format === 'json') {
      const parsed = JSON.parse(body.content)
      rawRows = Array.isArray(parsed) ? parsed : [parsed]
    } else {
      rawRows = parseCsv(body.content)
    }
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'Parse error'
  }

  const [batch] = await db
    .insert(import_batches)
    .values({
      org_id: body.org_id,
      user_id: userId,
      provider_id: body.provider_id ?? null,
      filename: body.filename,
      format: body.format,
      status: parseError ? 'failed' : 'parsed',
      row_count: rawRows.length,
      error_count: 0,
    })
    .returning()

  if (parseError) {
    await recordAudit(body.org_id, userId, batch.id, 'create', { error: parseError })
    return c.json({ ...batch, error: parseError }, 201)
  }

  let errorCount = 0
  for (const raw of rawRows) {
    const { normalized, error } = normalizeRow(raw, fieldMap)
    if (error) errorCount++
    await db.insert(import_rows).values({
      batch_id: batch.id,
      user_id: userId,
      raw,
      normalized,
      status: error ? 'error' : 'parsed',
      error,
    })
  }

  const [updated] = await db
    .update(import_batches)
    .set({ error_count: errorCount, status: errorCount === rawRows.length && rawRows.length > 0 ? 'failed' : 'parsed' })
    .where(eq(import_batches.id, batch.id))
    .returning()

  await recordAudit(body.org_id, userId, batch.id, 'create', {
    row_count: rawRows.length,
    error_count: errorCount,
  })
  return c.json(updated, 201)
})

// Auth: commit normalized rows into payments (ownership-checked).
router.post('/:id/commit', authMiddleware, zValidator('json', commitSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [batch] = await db.select().from(import_batches).where(eq(import_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (batch.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  let rows = await db.select().from(import_rows).where(eq(import_rows.batch_id, id))
  if (body.row_ids && body.row_ids.length > 0) {
    const wanted = new Set(body.row_ids)
    rows = rows.filter((r) => wanted.has(r.id))
  }

  let committed = 0
  for (const row of rows) {
    if (row.status === 'committed') continue
    const n = (row.normalized ?? {}) as Record<string, unknown>
    if (row.status === 'error') continue
    const baseCurrency = String(n.base_currency ?? '')
    const quoteCurrency = String(n.quote_currency ?? '')
    const notionalBase = Number(n.notional_base)
    const appliedRate = Number(n.applied_rate)
    const disclosedFeeCents = Math.round(Number(n.disclosed_fee_cents ?? 0))
    const valueDateStr = String(n.value_date ?? '')
    if (
      !baseCurrency ||
      !quoteCurrency ||
      !Number.isFinite(notionalBase) ||
      !Number.isFinite(appliedRate) ||
      Number.isNaN(Date.parse(valueDateStr))
    ) {
      continue
    }
    const valueDate = new Date(valueDateStr)

    // attach nearest benchmark mid-rate for the pair at/around value_date
    const benchmarks = await db
      .select()
      .from(benchmark_rates)
      .where(
        and(
          eq(benchmark_rates.org_id, batch.org_id),
          eq(benchmark_rates.base_currency, baseCurrency),
          eq(benchmark_rates.quote_currency, quoteCurrency),
        ),
      )
    let benchmarkId: string | null = null
    let midRate = appliedRate
    if (benchmarks.length > 0) {
      let best = benchmarks[0]
      let bestDiff = Math.abs(new Date(best.captured_at).getTime() - valueDate.getTime())
      for (const b of benchmarks) {
        const diff = Math.abs(new Date(b.captured_at).getTime() - valueDate.getTime())
        if (diff < bestDiff) {
          best = b
          bestDiff = diff
        }
      }
      benchmarkId = best.id
      midRate = best.mid_rate
    }

    const [payment] = await db
      .insert(payments)
      .values({
        org_id: batch.org_id,
        user_id: userId,
        provider_id: batch.provider_id ?? null,
        corridor_id: null,
        reference: n.reference != null ? String(n.reference) : null,
        base_currency: baseCurrency,
        quote_currency: quoteCurrency,
        notional_base: notionalBase,
        applied_rate: appliedRate,
        disclosed_fee_cents: disclosedFeeCents,
        value_date: valueDate,
        benchmark_rate_id: benchmarkId,
        status: 'recorded',
      })
      .returning()

    // compute markup decomposition
    const markupBps = midRate > 0 ? ((midRate - appliedRate) / midRate) * 10000 : 0
    const quoteAtMid = notionalBase * midRate
    const quoteReceived = notionalBase * appliedRate
    const hiddenSpreadBase = midRate > 0 ? (quoteAtMid - quoteReceived) / midRate : 0
    const hiddenSpreadCents = Math.round(hiddenSpreadBase * 100)
    const totalCostCents = disclosedFeeCents + hiddenSpreadCents
    const effectiveCostPct = notionalBase > 0 ? (totalCostCents / (notionalBase * 100)) * 100 : 0
    await db.insert(payment_markups).values({
      payment_id: payment.id,
      user_id: userId,
      mid_rate: midRate,
      applied_rate: appliedRate,
      markup_bps: markupBps,
      hidden_spread_cents: hiddenSpreadCents,
      disclosed_fee_cents: disclosedFeeCents,
      wire_fee_cents: 0,
      total_cost_cents: totalCostCents,
      effective_cost_pct: effectiveCostPct,
    })

    await db
      .update(import_rows)
      .set({ status: 'committed' })
      .where(eq(import_rows.id, row.id))
    committed++
  }

  await db
    .update(import_batches)
    .set({ status: 'committed' })
    .where(eq(import_batches.id, id))

  await recordAudit(batch.org_id, userId, id, 'commit', { committed })
  return c.json({ committed })
})

// Auth: delete a batch and its rows (ownership-checked).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [batch] = await db.select().from(import_batches).where(eq(import_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (batch.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(import_rows).where(eq(import_rows.batch_id, id))
  await db.delete(import_batches).where(eq(import_batches.id, id))
  await recordAudit(batch.org_id, userId, id, 'delete', { filename: batch.filename })
  return c.json({ success: true })
})

export default router
