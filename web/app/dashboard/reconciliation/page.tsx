'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Reconciliation {
  id: string
  payment_id: string
  expected_fee_cents: number
  observed_fee_cents: number
  variance_cents: number
  status: string
  notes: string | null
  created_at: string
  reference?: string | null
  provider_name?: string | null
}

interface ProviderVariance {
  provider_id?: string
  provider_name?: string
  name?: string
  total_variance_cents?: number
  variance_cents?: number
  reconciliation_count?: number
  count?: number
  avg_variance_cents?: number
  [k: string]: unknown
}

const STATUSES = ['open', 'matched', 'disputed', 'resolved']
const STATUS_FILTERS = ['', ...STATUSES]

function fmtMoney(cents?: number) {
  if (cents === undefined || cents === null || Number.isNaN(cents)) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(cents / 100)
}

function fmtTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusTone(s: string): 'slate' | 'amber' | 'green' | 'rose' | 'blue' {
  switch (s) {
    case 'resolved':
    case 'matched':
      return 'green'
    case 'disputed':
      return 'rose'
    case 'open':
      return 'blue'
    default:
      return 'slate'
  }
}

function varianceTone(cents: number): 'green' | 'amber' | 'rose' {
  const abs = Math.abs(cents)
  if (abs < 100) return 'green'
  if (abs < 5000) return 'amber'
  return 'rose'
}

function provName(v: ProviderVariance): string {
  return v.provider_name ?? v.name ?? (v.provider_id as string) ?? '—'
}

function provVariance(v: ProviderVariance): number {
  return v.total_variance_cents ?? v.variance_cents ?? 0
}

export default function ReconciliationPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [recons, setRecons] = useState<Reconciliation[]>([])
  const [variance, setVariance] = useState<ProviderVariance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  // edit modal
  const [editing, setEditing] = useState<Reconciliation | null>(null)
  const [editStatus, setEditStatus] = useState('open')
  const [editNotes, setEditNotes] = useState('')

  const loadRecons = useCallback(
    async (resolvedOrg: string | null) => {
      const rows = await api.getReconciliations({ org_id: resolvedOrg ?? undefined, status: statusFilter || undefined })
      setRecons(Array.isArray(rows) ? rows : [])
    },
    [statusFilter],
  )

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const org = await api.getCurrentOrg().catch(() => null)
      const resolvedOrg = org?.id ?? null
      setOrgId(resolvedOrg)
      const [, varRows] = await Promise.all([
        loadRecons(resolvedOrg),
        api.getReconVarianceByProvider(resolvedOrg ?? undefined).catch(() => []),
      ])
      setVariance(Array.isArray(varRows) ? varRows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reconciliations')
    } finally {
      setLoading(false)
    }
  }, [loadRecons])

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loading) return
    loadRecons(orgId).catch((e) => setError(e instanceof Error ? e.message : 'Failed to refresh'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return recons
    return recons.filter((r) =>
      `${r.reference ?? ''} ${r.provider_name ?? ''} ${r.payment_id} ${r.status}`.toLowerCase().includes(q),
    )
  }, [recons, search])

  const stats = useMemo(() => {
    const open = recons.filter((r) => r.status === 'open').length
    const disputed = recons.filter((r) => r.status === 'disputed').length
    const totalVar = recons.reduce((s, r) => s + (r.variance_cents ?? 0), 0)
    const totalAbs = recons.reduce((s, r) => s + Math.abs(r.variance_cents ?? 0), 0)
    return { open, disputed, totalVar, totalAbs }
  }, [recons])

  const maxAbsVar = useMemo(
    () => variance.reduce((m, v) => Math.max(m, Math.abs(provVariance(v))), 0),
    [variance],
  )

  async function runRecon() {
    setBusy(true)
    setRunMsg(null)
    setError(null)
    try {
      const res = await api.runReconciliation({ org_id: orgId })
      const n = typeof res?.reconciled === 'number' ? res.reconciled : 0
      setRunMsg(`Reconciled ${n} payment${n === 1 ? '' : 's'} against provider fee schedules.`)
      await loadRecons(orgId)
      const varRows = await api.getReconVarianceByProvider(orgId ?? undefined).catch(() => [])
      setVariance(Array.isArray(varRows) ? varRows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconciliation run failed')
    } finally {
      setBusy(false)
    }
  }

  function openEdit(r: Reconciliation) {
    setEditing(r)
    setEditStatus(r.status)
    setEditNotes(r.notes ?? '')
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await api.updateReconciliation(editing.id, { status: editStatus, notes: editNotes || null })
      setEditing(null)
      await loadRecons(orgId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update reconciliation')
    } finally {
      setBusy(false)
    }
  }

  // quick status transition without opening the modal
  async function quickStatus(r: Reconciliation, status: string) {
    setBusy(true)
    setError(null)
    try {
      await api.updateReconciliation(r.id, { status, notes: r.notes ?? null })
      await loadRecons(orgId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading reconciliations..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Fee Reconciliation</h1>
          <p className="mt-1 text-sm text-slate-400">
            Compare what providers charged against their published fee schedules and chase down the variance.
          </p>
        </div>
        <Button onClick={runRecon} disabled={busy}>
          {busy ? 'Running...' : 'Run reconciliation'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {runMsg && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">{runMsg}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Reconciliations" value={recons.length} tone="teal" />
        <Stat label="Open" value={stats.open} tone="amber" />
        <Stat label="Disputed" value={stats.disputed} tone="rose" />
        <Stat
          label="Net variance"
          value={fmtMoney(stats.totalVar)}
          tone={stats.totalVar > 0 ? 'rose' : 'green'}
          hint={`${fmtMoney(stats.totalAbs)} absolute`}
        />
      </div>

      {/* Provider variance */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Variance by provider</h2>
          <p className="mt-0.5 text-xs text-slate-500">Aggregate observed-minus-expected fee variance per provider.</p>
        </CardHeader>
        <CardBody>
          {variance.length === 0 ? (
            <EmptyState
              title="No provider variance yet"
              description="Run a reconciliation to compute the gap between observed and expected fees per provider."
            />
          ) : (
            <div className="space-y-3">
              {variance.map((v, i) => {
                const amount = provVariance(v)
                const pct = maxAbsVar > 0 ? Math.min(100, (Math.abs(amount) / maxAbsVar) * 100) : 0
                const over = amount > 0
                return (
                  <div key={(v.provider_id as string) ?? i} className="flex items-center gap-4">
                    <div className="w-40 shrink-0 truncate text-sm font-medium text-white">{provName(v)}</div>
                    <div className="flex-1">
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className={`h-full rounded-full ${over ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      <Badge tone={varianceTone(amount)}>{over ? '+' : ''}{fmtMoney(amount)}</Badge>
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs text-slate-500">
                      {(v.reconciliation_count ?? v.count ?? 0)} recs
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Reconciliation list */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-white">Reconciliations</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s || 'all'} value={s}>{s ? s : 'All statuses'}</option>
              ))}
            </select>
            <input
              placeholder="Search reference / provider"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={recons.length === 0 ? 'No reconciliations yet' : 'No reconciliations match your filters'}
              description={
                recons.length === 0
                  ? 'Run a reconciliation to compare disclosed and observed fees against provider fee schedules.'
                  : 'Try a different status filter or search term.'
              }
              action={recons.length === 0 ? <Button onClick={runRecon} disabled={busy}>Run reconciliation</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Provider</TH>
                  <TH className="text-right">Expected</TH>
                  <TH className="text-right">Observed</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-white">{r.reference || r.payment_id.slice(0, 8)}</TD>
                    <TD className="text-slate-400">{r.provider_name || '—'}</TD>
                    <TD className="text-right tabular-nums text-slate-300">{fmtMoney(r.expected_fee_cents)}</TD>
                    <TD className="text-right tabular-nums text-slate-300">{fmtMoney(r.observed_fee_cents)}</TD>
                    <TD className="text-right">
                      <Badge tone={varianceTone(r.variance_cents)}>
                        {r.variance_cents > 0 ? '+' : ''}{fmtMoney(r.variance_cents)}
                      </Badge>
                    </TD>
                    <TD><Badge tone={statusTone(r.status)}>{r.status}</Badge></TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.status !== 'resolved' && (
                          <Button variant="ghost" className="text-emerald-400 hover:text-emerald-300" onClick={() => quickStatus(r, 'resolved')} disabled={busy}>
                            Resolve
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Update reconciliation"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="recon-form" disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </div>
        }
      >
        {editing && (
          <form id="recon-form" onSubmit={saveEdit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Expected</div>
                <div className="font-semibold text-slate-200">{fmtMoney(editing.expected_fee_cents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Observed</div>
                <div className="font-semibold text-slate-200">{fmtMoney(editing.observed_fee_cents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Variance</div>
                <div className={`font-semibold ${editing.variance_cents > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {editing.variance_cents > 0 ? '+' : ''}{fmtMoney(editing.variance_cents)}
                </div>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Status
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Notes
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
                placeholder="Disposition, contact, dispute reference..."
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              />
            </label>
          </form>
        )}
      </Modal>
    </div>
  )
}
