// ---------------------------------------------------------------------------
// cron.ts — deterministic scheduling/firing engine.
//
// Pure functions only. No DB, no network, no external services. Every export
// takes plain inputs and returns plain data so routes (and tests) can call them
// directly and get identical output for identical input.
//
// Three schedule "kinds" are supported:
//   - 'cron'   : a standard 5/6-field cron expression, parsed via cron-parser.
//   - 'rate'   : a human "every N minutes|hours|days" expression, computed
//                arithmetically (no cron parsing).
//   - 'oneoff' : a single ISO timestamp; fires once if it is in the future.
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string // ISO
  end: string // ISO
  label?: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  durationMinutes: number
  label?: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const DEFAULT_TZ = 'UTC'
const MINUTE_MS = 60_000

// ---------------------------------------------------------------------------
// Rate-expression parsing: "every N minutes|hours|days"
// ---------------------------------------------------------------------------

interface RateSpec {
  unitMs: number
  n: number
}

function parseRate(expr: string): RateSpec | null {
  const m = /^\s*every\s+(\d+)\s*(minute|minutes|hour|hours|day|days|min|mins|hr|hrs)\s*$/i.exec(
    expr,
  )
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let unitMs: number
  if (unit.startsWith('min')) unitMs = MINUTE_MS
  else if (unit.startsWith('h')) unitMs = 60 * MINUTE_MS
  else unitMs = 24 * 60 * MINUTE_MS
  return { unitMs, n }
}

function isValidIso(s: string): boolean {
  const t = Date.parse(s)
  return Number.isFinite(t)
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    return parseRate(expr)
      ? { valid: true }
      : { valid: false, error: 'Expected "every N minutes|hours|days"' }
  }
  if (kind === 'oneoff') {
    return isValidIso(expr)
      ? { valid: true }
      : { valid: false, error: 'Expected a valid ISO-8601 timestamp' }
  }
  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression — human readable summary
// ---------------------------------------------------------------------------

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
): string {
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return 'Invalid rate expression'
    const unit = r.unitMs === MINUTE_MS ? 'minute' : r.unitMs === 60 * MINUTE_MS ? 'hour' : 'day'
    return r.n === 1 ? `Every ${unit}` : `Every ${r.n} ${unit}s`
  }
  if (kind === 'oneoff') {
    if (!isValidIso(expr)) return 'Invalid one-off timestamp'
    return `Once at ${new Date(expr).toISOString()}`
  }
  // cron
  const v = validateExpression('cron', expr)
  if (!v.valid) return `Invalid cron expression: ${v.error}`
  const fields = expr.trim().split(/\s+/)
  const tzNote = timezone && timezone !== DEFAULT_TZ ? ` (${timezone})` : ''
  if (fields.length >= 5) {
    const [min, hour, dom, mon, dow] = fields
    if (min === '*' && hour === '*') return `Every minute${tzNote}`
    if (
      /^\d+$/.test(min) &&
      hour === '*' &&
      dom === '*' &&
      mon === '*' &&
      dow === '*'
    ) {
      return `At minute ${min} of every hour${tzNote}`
    }
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}${tzNote}`
    }
  }
  return `Cron "${expr}"${tzNote}`
}

// ---------------------------------------------------------------------------
// nextFirings — the next `count` firing instants as ISO UTC strings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  count: number = 10,
): string[] {
  const from = isValidIso(fromISO) ? new Date(fromISO) : new Date()
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  if (kind === 'oneoff') {
    if (!isValidIso(expr)) return []
    const when = new Date(expr)
    return when.getTime() > from.getTime() ? [when.toISOString()] : []
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.n * r.unitMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.n * r.unitMs
    }
    return out
  }

  // cron
  try {
    const interval = CronExpressionParser.parse(expr, {
      tz: timezone || DEFAULT_TZ,
      currentDate: from,
    })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      out.push(interval.next().toDate().toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Internal: enumerate all firings of a job over a horizon (in ms from now)
// ---------------------------------------------------------------------------

function firingsWithinHorizon(job: Job, fromMs: number, horizonMs: number): number[] {
  const fromISO = new Date(fromMs).toISOString()
  const endMs = fromMs + horizonMs
  const out: number[] = []

  if (job.kind === 'oneoff') {
    if (!isValidIso(job.expr)) return out
    const t = new Date(job.expr).getTime()
    if (t > fromMs && t <= endMs) out.push(t)
    return out
  }

  if (job.kind === 'rate') {
    const r = parseRate(job.expr)
    if (!r) return out
    let t = fromMs + r.n * r.unitMs
    let guard = 0
    while (t <= endMs && guard < 200_000) {
      out.push(t)
      t += r.n * r.unitMs
      guard++
    }
    return out
  }

  // cron
  try {
    const interval = CronExpressionParser.parse(job.expr, {
      tz: job.timezone || DEFAULT_TZ,
      currentDate: new Date(fromISO),
    })
    let guard = 0
    while (guard < 200_000) {
      const next = interval.next().toDate().getTime()
      if (next > endMs) break
      out.push(next)
      guard++
    }
  } catch {
    // ignore malformed jobs
  }
  return out
}

function minuteBucket(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

// ---------------------------------------------------------------------------
// computeCollisions — flag minutes where too many jobs fire at once, or where
// two+ jobs sharing a resource fire in the same minute.
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays: number; threshold: number },
): Collision[] {
  const fromMs = Date.now()
  const horizonMs = Math.max(0, opts.horizonDays) * 24 * 60 * MINUTE_MS
  const threshold = Math.max(2, Math.floor(opts.threshold || 2))

  // bucketMs -> jobId -> count of firings in that minute
  const buckets = new Map<number, Map<string, number>>()
  for (const job of jobs) {
    for (const fire of firingsWithinHorizon(job, fromMs, horizonMs)) {
      const b = minuteBucket(fire)
      let inner = buckets.get(b)
      if (!inner) {
        inner = new Map()
        buckets.set(b, inner)
      }
      inner.set(job.id, (inner.get(job.id) ?? 0) + 1)
    }
  }

  const resourceOf = new Map<string, string | undefined>()
  for (const j of jobs) resourceOf.set(j.id, j.resourceId)

  const collisions: Collision[] = []
  const sortedBuckets = [...buckets.keys()].sort((a, b) => a - b)
  for (const b of sortedBuckets) {
    const inner = buckets.get(b)!
    const jobIds = [...inner.keys()]
    const concurrency = [...inner.values()].reduce((s, n) => s + n, 0)

    // group by shared resource
    const byResource = new Map<string, string[]>()
    for (const jid of jobIds) {
      const rid = resourceOf.get(jid)
      if (!rid) continue
      const arr = byResource.get(rid) ?? []
      arr.push(jid)
      byResource.set(rid, arr)
    }
    let sharedResource: string | undefined
    for (const [rid, ids] of byResource) {
      if (ids.length >= 2) {
        sharedResource = rid
        break
      }
    }

    const overThreshold = concurrency >= threshold || jobIds.length >= threshold
    if (!overThreshold && !sharedResource) continue

    let severity: Collision['severity'] = 'low'
    if (concurrency >= threshold * 2 || jobIds.length >= threshold * 2) severity = 'high'
    else if (overThreshold) severity = 'medium'
    else if (sharedResource) severity = 'medium'

    collisions.push({
      windowStart: new Date(b).toISOString(),
      windowEnd: new Date(b + MINUTE_MS).toISOString(),
      jobIds,
      severity,
      resourceId: sharedResource,
    })
  }
  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap — firings bucketed by hour across the horizon.
// ---------------------------------------------------------------------------

export function loadHeatmap(jobs: Job[], opts: { horizonDays: number }): HeatmapBucket[] {
  const fromMs = Date.now()
  const horizonMs = Math.max(0, opts.horizonDays) * 24 * 60 * MINUTE_MS
  const HOUR_MS = 60 * MINUTE_MS
  const counts = new Map<number, number>()
  for (const job of jobs) {
    for (const fire of firingsWithinHorizon(job, fromMs, horizonMs)) {
      const hourBucket = Math.floor(fire / HOUR_MS) * HOUR_MS
      counts.set(hourBucket, (counts.get(hourBucket) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({ bucket: new Date(bucket).toISOString(), count }))
}

// ---------------------------------------------------------------------------
// dstTraps — detect daylight-saving transitions in the window that cause a
// local wall-clock time to be skipped, repeated (double fire), or ambiguous.
// Uses Intl timezone offset changes across the window.
// ---------------------------------------------------------------------------

function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Returns the offset (minutes) such that UTC + offset = local wall clock.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  let hour = parseInt(map.hour, 10)
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  )
  return Math.round((asUTC - date.getTime()) / MINUTE_MS)
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  days: number = 90,
): DstTrap[] {
  if (!timezone || timezone === DEFAULT_TZ) return []
  const traps: DstTrap[] = []
  const fromMs = isValidIso(fromISO) ? new Date(fromISO).getTime() : Date.now()
  const horizonMs = Math.max(0, days) * 24 * 60 * MINUTE_MS
  const HOUR_MS = 60 * MINUTE_MS

  let prev = tzOffsetMinutes(new Date(fromMs), timezone)
  for (let t = fromMs + HOUR_MS; t <= fromMs + horizonMs; t += HOUR_MS) {
    const cur = tzOffsetMinutes(new Date(t), timezone)
    if (cur === prev) {
      prev = cur
      continue
    }
    const transitionUtc = new Date(t)
    const localStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(transitionUtc)

    if (cur > prev) {
      // clocks moved forward — a wall-clock hour is skipped.
      traps.push({ type: 'skip', atLocal: localStr, atUtc: transitionUtc.toISOString() })
      traps.push({ type: 'ambiguous', atLocal: localStr, atUtc: transitionUtc.toISOString() })
    } else {
      // clocks moved back — a wall-clock hour repeats: double fire / ambiguous.
      traps.push({ type: 'double_fire', atLocal: localStr, atUtc: transitionUtc.toISOString() })
      traps.push({ type: 'ambiguous', atLocal: localStr, atUtc: transitionUtc.toISOString() })
    }
    prev = cur
  }

  // If a concrete cron/rate schedule was supplied, keep only traps that land
  // near an actual firing (within the affected hour). For empty/oneoff, return
  // the raw transition traps so callers can still surface them.
  if (kind === 'cron' || kind === 'rate') {
    const fires = firingsWithinHorizon(
      { id: '_', kind, expr, timezone },
      fromMs,
      horizonMs,
    )
    if (fires.length === 0) return []
    const fireHours = new Set(fires.map((f) => Math.floor(f / HOUR_MS)))
    return traps.filter((tr) => fireHours.has(Math.floor(Date.parse(tr.atUtc) / HOUR_MS)))
  }
  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps — given required coverage windows and the jobs that should cover
// them, find sub-intervals of each window with no firing.
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const fromMs = Date.now()
  const horizonMs = Math.max(0, opts.horizonDays) * 24 * 60 * MINUTE_MS

  // Collect all firing instants within the horizon, sorted.
  const allFires: number[] = []
  for (const job of jobs) {
    for (const fire of firingsWithinHorizon(job, fromMs, horizonMs)) allFires.push(fire)
  }
  allFires.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    if (!isValidIso(w.start) || !isValidIso(w.end)) continue
    const wStart = new Date(w.start).getTime()
    const wEnd = new Date(w.end).getTime()
    if (wEnd <= wStart) continue

    const inWindow = allFires.filter((f) => f >= wStart && f <= wEnd)
    let cursor = wStart
    const boundaries = [...inWindow, wEnd]
    for (const fire of boundaries) {
      if (fire - cursor > 0) {
        // a gap from cursor to fire
        const durationMinutes = Math.round((fire - cursor) / MINUTE_MS)
        if (durationMinutes > 0) {
          gaps.push({
            windowStart: new Date(cursor).toISOString(),
            windowEnd: new Date(fire).toISOString(),
            durationMinutes,
            label: w.label,
          })
        }
      }
      cursor = Math.max(cursor, fire)
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread — suggest staggered expressions for jobs participating in
// collisions, to spread load off the colliding minute.
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: Job[],
  opts: { threshold: number },
): SpreadSuggestion[] {
  const threshold = Math.max(2, Math.floor(opts.threshold || 2))
  const collisions = computeCollisions(jobs, { horizonDays: 1, threshold })

  // Determine which jobs collide and how many times.
  const colliding = new Map<string, number>()
  for (const col of collisions) {
    col.jobIds.forEach((jid, idx) => {
      // first job in a colliding minute keeps its slot; the rest get spread.
      if (idx > 0) colliding.set(jid, (colliding.get(jid) ?? 0) + 1)
    })
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []
  let offset = 0
  for (const [jid, hits] of colliding) {
    const job = jobById.get(jid)
    if (!job) continue
    offset = (offset + 7) % 60 // deterministic prime-step stagger
    let suggestedExpr = job.expr

    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      if (fields.length >= 5) {
        fields[0] = String(offset) // rewrite the minute field
        suggestedExpr = fields.join(' ')
      }
    } else if (job.kind === 'rate') {
      const r = parseRate(job.expr)
      if (r) {
        const unit = r.unitMs === MINUTE_MS ? 'minutes' : r.unitMs === 60 * MINUTE_MS ? 'hours' : 'days'
        // nudge the cadence so firings drift off the shared minute.
        suggestedExpr = `every ${r.n + 1} ${unit}`
      }
    }

    suggestions.push({
      jobId: jid,
      suggestedExpr,
      reason: `Collides in ${hits} window(s); stagger to minute ${offset} to spread load`,
    })
  }
  return suggestions
}
