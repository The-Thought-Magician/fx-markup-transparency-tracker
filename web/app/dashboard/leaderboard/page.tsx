'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface RankingRow {
  rank?: number
  id?: string
  label?: string
  name?: string
  base_currency?: string
  quote_currency?: string
  markup_bps?: number
  avg_markup_bps?: number
  leakage_cents?: number
  total_leakage_cents?: number
  notional_cents?: number
  payment_count?: number
  [k: string]: unknown
}

interface LeaderboardSnapshot {
  id: string
  org_id: string
  kind?: string
  period: string
  rankings: RankingRow[]
  created_at: string
}

interface MoverRow {
  id?: string
  label?: string
  name?: string
  previous_bps?: number
  current_bps?: number
  delta_bps?: number
  [k: string]: unknown
}

interface MoversResult {
  improved?: MoverRow[]
  worsened?: MoverRow[]
  best?: MoverRow[]
  worst?: MoverRow[]
  [k: string]: unknown
}

const PERIODS = ['7d', '30d', '90d', 'ytd', 'all']

function fmtBps(v?: number) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—'
  return `${v >= 0 ? '' : ''}${v.toFixed(1)} bps`
}

function fmtMoney(cents?: number) {
  if (cents === undefined || cents === null || Number.isNaN(cents)) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function fmtTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function rowLabel(r: RankingRow | MoverRow): string {
  if (r.label) return r.label as string
  if (r.base_currency && r.quote_currency) return `${r.base_currency}/${r.quote_currency}`
  if (r.name) return r.name as string
  return (r.id as string) ?? '—'
}

function getMarkup(r: RankingRow): number | undefined {
  return r.markup_bps ?? r.avg_markup_bps
}

function getLeakage(r: RankingRow): number | undefined {
  return r.leakage_cents ?? r.total_leakage_cents
}

function markupTone(bps?: number): 'green' | 'amber' | 'rose' | 'slate' {
  if (bps === undefined) return 'slate'
  if (bps <= 25) return 'green'
  if (bps <= 75) return 'amber'
  return 'rose'
}

// horizontal bar relative to the max markup in the set
function MarkupBar({ value, max }: { value?: number; max: number }) {
  const pct = value && max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = value !== undefined && value > 75 ? 'bg-rose-500' : value !== undefined && value > 25 ? 'bg-amber-500' : 'bg-teal-500'
  return (
    <div className="h-2 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function LeaderboardPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [tab, setTab] = useState<'corridors' | 'providers'>('corridors')
  const [period, setPeriod] = useState('30d')
  const [corridorRows, setCorridorRows] = useState<RankingRow[]>([])
  const [providerRows, setProviderRows] = useState<RankingRow[]>([])
  const [snapshots, setSnapshots] = useState<LeaderboardSnapshot[]>([])
  const [movers, setMovers] = useState<MoversResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null)

  const load = useCallback(
    async (resolvedOrg: string | null, p: string) => {
      const [corr, prov, snaps, mov] = await Promise.all([
        api.getCorridorLeaderboard({ org_id: resolvedOrg ?? undefined, period: p }).catch(() => []),
        api.getProviderLeaderboard({ org_id: resolvedOrg ?? undefined, period: p }).catch(() => []),
        api.getLeaderboardSnapshots({ org_id: resolvedOrg ?? undefined }).catch(() => []),
        api.getLeaderboardMovers({ org_id: resolvedOrg ?? undefined, kind: tab }).catch(() => null),
      ])
      setCorridorRows(Array.isArray(corr) ? corr : [])
      setProviderRows(Array.isArray(prov) ? prov : [])
      setSnapshots(Array.isArray(snaps) ? snaps : [])
      setMovers(mov && typeof mov === 'object' ? mov : null)
    },
    [tab],
  )

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const org = await api.getCurrentOrg().catch(() => null)
      const resolvedOrg = org?.id ?? null
      setOrgId(resolvedOrg)
      await load(resolvedOrg, period)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard')
    } finally {
      setLoading(false)
    }
  }, [load, period])

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // reload rankings + movers when period or tab changes (after initial load)
  useEffect(() => {
    if (loading) return
    load(orgId, period).catch((e) => setError(e instanceof Error ? e.message : 'Failed to refresh'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, tab])

  const rows = tab === 'corridors' ? corridorRows : providerRows
  const ranked = useMemo(
    () => [...rows].sort((a, b) => (getMarkup(b) ?? 0) - (getMarkup(a) ?? 0)),
    [rows],
  )
  const maxMarkup = useMemo(() => ranked.reduce((m, r) => Math.max(m, getMarkup(r) ?? 0), 0), [ranked])
  const worstMarkup = ranked.length ? getMarkup(ranked[0]) : undefined
  const avgMarkup = useMemo(() => {
    const vals = rows.map(getMarkup).filter((v): v is number => v !== undefined)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined
  }, [rows])
  const totalLeakage = useMemo(
    () => rows.reduce((sum, r) => sum + (getLeakage(r) ?? 0), 0),
    [rows],
  )

  const snapshotsForTab = useMemo(
    () => snapshots.filter((s) => !s.kind || s.kind === tab),
    [snapshots, tab],
  )

  async function takeSnapshot() {
    setBusy(true)
    setSnapshotMsg(null)
    setError(null)
    try {
      await api.createLeaderboardSnapshot({ org_id: orgId, period })
      const snaps = await api.getLeaderboardSnapshots({ org_id: orgId ?? undefined })
      setSnapshots(Array.isArray(snaps) ? snaps : [])
      const mov = await api.getLeaderboardMovers({ org_id: orgId ?? undefined, kind: tab }).catch(() => null)
      setMovers(mov && typeof mov === 'object' ? mov : null)
      setSnapshotMsg('Snapshot saved. Movers compare the two most recent snapshots.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create snapshot')
    } finally {
      setBusy(false)
    }
  }

  const improved = movers?.improved ?? movers?.best ?? []
  const worsened = movers?.worsened ?? movers?.worst ?? []

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading leaderboard..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Markup Leaderboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Rank corridors and providers by FX markup so the most expensive flows surface first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Button onClick={takeSnapshot} disabled={busy}>
            {busy ? 'Saving...' : 'Take snapshot'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {snapshotMsg && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">{snapshotMsg}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={`${tab === 'corridors' ? 'Corridors' : 'Providers'} ranked`} value={rows.length} tone="teal" />
        <Stat label="Worst markup" value={fmtBps(worstMarkup)} tone="rose" />
        <Stat label="Average markup" value={fmtBps(avgMarkup)} tone="amber" />
        <Stat label="Total leakage" value={fmtMoney(totalLeakage)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        <button
          onClick={() => setTab('corridors')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'corridors' ? 'bg-teal-500/15 text-teal-300' : 'text-slate-400 hover:text-white'
          }`}
        >
          Corridors
        </button>
        <button
          onClick={() => setTab('providers')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'providers' ? 'bg-teal-500/15 text-teal-300' : 'text-slate-400 hover:text-white'
          }`}
        >
          Providers
        </button>
      </div>

      {/* Ranking table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">
            {tab === 'corridors' ? 'Corridor' : 'Provider'} markup ranking · {period}
          </h2>
        </CardHeader>
        <CardBody>
          {ranked.length === 0 ? (
            <EmptyState
              title="No ranking data"
              description="Once payments are priced against benchmarks, corridors and providers appear here ranked by markup."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">#</TH>
                  <TH>{tab === 'corridors' ? 'Corridor' : 'Provider'}</TH>
                  <TH>Markup</TH>
                  <TH>Distribution</TH>
                  <TH>Payments</TH>
                  <TH className="text-right">Leakage</TH>
                </TR>
              </THead>
              <TBody>
                {ranked.map((r, i) => {
                  const m = getMarkup(r)
                  return (
                    <TR key={(r.id as string) ?? `${rowLabel(r)}-${i}`}>
                      <TD>
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          i === 0 ? 'bg-rose-500/20 text-rose-300' : i < 3 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {i + 1}
                        </span>
                      </TD>
                      <TD className="font-semibold text-white">{rowLabel(r)}</TD>
                      <TD>
                        <Badge tone={markupTone(m)}>{fmtBps(m)}</Badge>
                      </TD>
                      <TD><MarkupBar value={m} max={maxMarkup} /></TD>
                      <TD className="tabular-nums text-slate-400">{r.payment_count ?? '—'}</TD>
                      <TD className="text-right tabular-nums text-slate-200">{fmtMoney(getLeakage(r))}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Movers */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="text-emerald-400">▼</span> Improving ({tab})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Largest markup reductions between the last two snapshots.</p>
          </CardHeader>
          <CardBody>
            {improved.length === 0 ? (
              <p className="text-sm text-slate-500">No movers yet. Take at least two snapshots to compare.</p>
            ) : (
              <ul className="space-y-2">
                {improved.map((m, i) => (
                  <li key={(m.id as string) ?? i} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                    <span className="font-medium text-white">{rowLabel(m)}</span>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500">{fmtBps(m.previous_bps)} → {fmtBps(m.current_bps)}</span>
                      <Badge tone="green">{fmtBps(m.delta_bps)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="text-rose-400">▲</span> Worsening ({tab})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Largest markup increases between the last two snapshots.</p>
          </CardHeader>
          <CardBody>
            {worsened.length === 0 ? (
              <p className="text-sm text-slate-500">No movers yet. Take at least two snapshots to compare.</p>
            ) : (
              <ul className="space-y-2">
                {worsened.map((m, i) => (
                  <li key={(m.id as string) ?? i} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                    <span className="font-medium text-white">{rowLabel(m)}</span>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500">{fmtBps(m.previous_bps)} → {fmtBps(m.current_bps)}</span>
                      <Badge tone="rose">{fmtBps(m.delta_bps)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Snapshots */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Saved snapshots</h2>
          <p className="mt-0.5 text-xs text-slate-500">Point-in-time captures used to compute movers ({tab}).</p>
        </CardHeader>
        <CardBody>
          {snapshotsForTab.length === 0 ? (
            <EmptyState
              title="No snapshots saved"
              description="Take a snapshot to freeze the current ranking and track movement over time."
              action={<Button onClick={takeSnapshot} disabled={busy}>Take snapshot</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Kind</TH>
                  <TH>Entries</TH>
                  <TH className="text-right">Captured</TH>
                </TR>
              </THead>
              <TBody>
                {snapshotsForTab.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-white">{s.period}</TD>
                    <TD><Badge tone="slate">{s.kind ?? tab}</Badge></TD>
                    <TD className="tabular-nums text-slate-400">{Array.isArray(s.rankings) ? s.rankings.length : 0}</TD>
                    <TD className="text-right text-slate-400">{fmtTime(s.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
