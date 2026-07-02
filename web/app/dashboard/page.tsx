'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'

interface Org {
  id: string
  name?: string
  base_currency?: string
}

interface Summary {
  total_leakage_cents?: number
  avg_markup_bps?: number
  annualized_leakage_cents?: number
  payment_count?: number
  total_notional_cents?: number
  [k: string]: unknown
}

interface TrendPoint {
  period?: string
  bucket?: string
  date?: string
  markup_bps?: number
  avg_markup_bps?: number
  leakage_cents?: number
  total_cost_cents?: number
  [k: string]: unknown
}

interface Offender {
  id?: string
  label?: string
  name?: string
  base_currency?: string
  quote_currency?: string
  leakage_cents?: number
  total_leakage_cents?: number
  avg_markup_bps?: number
  markup_bps?: number
  payment_count?: number
  [k: string]: unknown
}

interface TopOffenders {
  corridors?: Offender[]
  providers?: Offender[]
  [k: string]: unknown
}

interface Alert {
  id: string
  message?: string
  severity?: string
  status?: string
  created_at?: string
  payment_id?: string
  [k: string]: unknown
}

function fmtCents(cents?: number, currency?: string) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  const opts: Intl.NumberFormatOptions =
    Math.abs(v) >= 1000
      ? { maximumFractionDigits: 0 }
      : { maximumFractionDigits: 2 }
  const num = new Intl.NumberFormat('en-US', opts).format(v)
  return currency ? `${num} ${currency}` : `$${num}`
}

function fmtBps(bps?: number) {
  if (bps == null || Number.isNaN(bps)) return '—'
  return `${bps.toFixed(1)} bps`
}

function severityTone(sev?: string): 'rose' | 'amber' | 'teal' | 'slate' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'rose'
    case 'medium':
    case 'warning':
      return 'amber'
    case 'low':
    case 'info':
      return 'teal'
    default:
      return 'slate'
  }
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? undefined : n
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const series = useMemo(() => {
    return points
      .map((p) => ({
        label: p.period || p.bucket || p.date || '',
        value: num(p.markup_bps) ?? num(p.avg_markup_bps) ?? 0,
        leakage: num(p.leakage_cents) ?? num(p.total_cost_cents) ?? 0,
      }))
      .filter((p) => p.label !== '')
  }, [points])

  if (series.length === 0) {
    return (
      <EmptyState
        title="No trend data yet"
        description="Record payments to build a markup-over-time series."
      />
    )
  }

  const max = Math.max(...series.map((s) => s.value), 1)
  const min = Math.min(...series.map((s) => s.value), 0)
  const range = max - min || 1
  const W = 760
  const H = 200
  const pad = 28
  const step = series.length > 1 ? (W - pad * 2) / (series.length - 1) : 0
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2)
  const x = (i: number) => pad + i * step

  const linePath = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.value).toFixed(1)}`)
    .join(' ')
  const areaPath =
    `M ${x(0).toFixed(1)} ${(H - pad).toFixed(1)} ` +
    series.map((s, i) => `L ${x(i).toFixed(1)} ${y(s.value).toFixed(1)}`).join(' ') +
    ` L ${x(series.length - 1).toFixed(1)} ${(H - pad).toFixed(1)} Z`

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[600px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(45 212 191)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(45 212 191)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gy = pad + t * (H - pad * 2)
          return (
            <line
              key={t}
              x1={pad}
              x2={W - pad}
              y1={gy}
              y2={gy}
              stroke="rgb(30 41 59)"
              strokeWidth="1"
            />
          )
        })}
        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} fill="none" stroke="rgb(45 212 191)" strokeWidth="2.5" strokeLinejoin="round" />
        {series.map((s, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(s.value)} r="3.5" fill="rgb(13 148 136)" stroke="rgb(2 6 23)" strokeWidth="1.5">
              <title>{`${s.label}: ${s.value.toFixed(1)} bps`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex justify-between gap-2 px-7 text-[10px] text-slate-500">
        {series.map((s, i) => (
          <span key={i} className="truncate">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function OffenderList({ items, kind }: { items: Offender[]; kind: 'corridor' | 'provider' }) {
  if (!items || items.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-slate-500">No {kind}s with measured leakage.</p>
  }
  const maxLeak = Math.max(
    ...items.map((o) => num(o.leakage_cents) ?? num(o.total_leakage_cents) ?? 0),
    1,
  )
  return (
    <ul className="space-y-3">
      {items.slice(0, 6).map((o, i) => {
        const leak = num(o.leakage_cents) ?? num(o.total_leakage_cents) ?? 0
        const name =
          o.label ||
          o.name ||
          (o.base_currency && o.quote_currency ? `${o.base_currency}/${o.quote_currency}` : 'Unknown')
        const pct = Math.max(2, (leak / maxLeak) * 100)
        const mk = num(o.avg_markup_bps) ?? num(o.markup_bps)
        const href = o.id
          ? kind === 'provider'
            ? `/dashboard/providers/${o.id}`
            : `/dashboard/corridors`
          : undefined
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-slate-200">
                <span className="mr-2 text-xs text-slate-600">#{i + 1}</span>
                {name}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-300">
                {fmtCents(leak)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-rose-500/70" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>{mk != null ? fmtBps(mk) : ''}</span>
              <span>{o.payment_count != null ? `${o.payment_count} payments` : ''}</span>
            </div>
          </>
        )
        return (
          <li key={o.id || i}>
            {href ? (
              <Link href={href} className="block rounded-lg p-1 transition-colors hover:bg-slate-800/40">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function DashboardPage() {
  const [org, setOrg] = useState<Org | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [offenders, setOffenders] = useState<TopOffenders>({})
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offenderTab, setOffenderTab] = useState<'corridor' | 'provider'>('corridor')

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const o: Org = await api.getCurrentOrg()
        const orgId = o?.id
        const [s, t, off, al] = await Promise.all([
          api.getDashboardSummary(orgId),
          api.getDashboardTrends({ org_id: orgId, period: 'monthly' }),
          api.getTopOffenders(orgId),
          api.getAlerts({ org_id: orgId, status: 'open' }),
        ])
        if (!active) return
        setOrg(o)
        setSummary(s || {})
        setTrends(Array.isArray(t) ? t : (t?.points ?? t?.trends ?? []))
        setOffenders(off || {})
        setAlerts(Array.isArray(al) ? al : (al?.alerts ?? []))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading transparency overview..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-500/30">
          <CardBody>
            <h2 className="text-base font-semibold text-rose-300">Could not load dashboard</h2>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
            <p className="mt-3 text-sm text-slate-500">
              If you have no data yet, seed a sample workspace from{' '}
              <Link href="/dashboard/seed" className="text-orange-400 hover:underline">
                Sample Data
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      </div>
    )
  }

  const ccy = org?.base_currency
  const corridorOffenders = offenders.corridors ?? []
  const providerOffenders = offenders.providers ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Transparency Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hidden FX cost across {org?.name || 'your workspace'}
            {ccy ? ` · base ${ccy}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/payments">
            <Button variant="secondary">View payments</Button>
          </Link>
          <Link href="/dashboard/reports">
            <Button>Reports</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total hidden leakage"
          value={fmtCents(num(summary?.total_leakage_cents), ccy)}
          hint="Hidden spread + fees on recorded payments"
          tone="rose"
        />
        <Stat
          label="Avg markup"
          value={fmtBps(num(summary?.avg_markup_bps))}
          hint="Weighted across corridors"
          tone="amber"
        />
        <Stat
          label="Annualized projection"
          value={fmtCents(num(summary?.annualized_leakage_cents), ccy)}
          hint="Run-rate leakage if current pattern holds"
          tone="teal"
        />
        <Stat
          label="Payments analyzed"
          value={num(summary?.payment_count) ?? 0}
          hint={
            summary?.total_notional_cents != null
              ? `${fmtCents(num(summary?.total_notional_cents), ccy)} notional`
              : 'Decomposed transactions'
          }
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Markup over time</h2>
            <p className="text-xs text-slate-500">Average markup (bps) per period</p>
          </div>
          <Badge tone="teal">monthly</Badge>
        </CardHeader>
        <CardBody>
          <TrendChart points={trends} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Top offenders</h2>
            <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
              <button
                onClick={() => setOffenderTab('corridor')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  offenderTab === 'corridor'
                    ? 'bg-slate-800 text-orange-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Corridors
              </button>
              <button
                onClick={() => setOffenderTab('provider')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  offenderTab === 'provider'
                    ? 'bg-slate-800 text-orange-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Providers
              </button>
            </div>
          </CardHeader>
          <CardBody>
            {offenderTab === 'corridor' ? (
              <OffenderList items={corridorOffenders} kind="corridor" />
            ) : (
              <OffenderList items={providerOffenders} kind="provider" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent alerts</h2>
            <Link href="/dashboard/alerts" className="text-xs font-medium text-orange-400 hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardBody>
            {alerts.length === 0 ? (
              <EmptyState
                title="No open alerts"
                description="Markup thresholds are within tolerance, or no rules have fired yet."
              />
            ) : (
              <ul className="space-y-2">
                {alerts.slice(0, 8).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{a.message || 'Alert'}</p>
                      {a.created_at && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {new Date(a.created_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={severityTone(a.severity)}>{a.severity || 'alert'}</Badge>
                      {a.payment_id && (
                        <Link
                          href={`/dashboard/payments/${a.payment_id}`}
                          className="text-[11px] text-orange-400 hover:underline"
                        >
                          payment
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
