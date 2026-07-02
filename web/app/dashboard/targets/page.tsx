'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Corridor {
  id: string
  org_id: string
  base_currency: string
  quote_currency: string
  label?: string | null
  is_active?: boolean
}

interface Target {
  id: string
  org_id: string
  corridor_id: string
  target_markup_bps: number
  created_at: string
}

interface VarianceRow {
  corridor_id?: string
  corridor_label?: string
  base_currency?: string
  quote_currency?: string
  target_markup_bps?: number
  actual_markup_bps?: number
  avg_markup_bps?: number
  variance_bps?: number
  payment_count?: number
  over_target?: boolean
  leakage_cents?: number
  [k: string]: unknown
}

function fmtBps(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v.toFixed(1)} bps`
}

function fmtCents(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return (v / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function corridorName(c?: Corridor): string {
  if (!c) return 'Unknown corridor'
  return c.label || `${c.base_currency}/${c.quote_currency}`
}

export default function TargetsPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [variance, setVariance] = useState<VarianceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyOver, setOnlyOver] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Target | null>(null)
  const [corridorId, setCorridorId] = useState('')
  const [bps, setBps] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let resolvedOrg = orgId
      if (!resolvedOrg) {
        try {
          const org = await api.getCurrentOrg()
          resolvedOrg = org?.id ?? null
          setOrgId(resolvedOrg)
        } catch {
          resolvedOrg = null
        }
      }
      const [corridorRes, targetRes, varianceRes] = await Promise.all([
        api.getCorridors(resolvedOrg ?? undefined),
        api.getTargets(resolvedOrg ?? undefined),
        api.getTargetVariance(resolvedOrg ?? undefined),
      ])
      setCorridors(Array.isArray(corridorRes) ? corridorRes : [])
      setTargets(Array.isArray(targetRes) ? targetRes : [])
      setVariance(Array.isArray(varianceRes) ? varianceRes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load targets')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const corridorById = useCallback(
    (cid: string) => corridors.find((c) => c.id === cid),
    [corridors],
  )

  // Join targets with corridor + variance details.
  const enriched = useMemo(() => {
    const varByCorridor = new Map<string, VarianceRow>()
    variance.forEach((v) => {
      if (v.corridor_id) varByCorridor.set(v.corridor_id, v)
    })
    return targets.map((t) => {
      const c = corridorById(t.corridor_id)
      const v = varByCorridor.get(t.corridor_id)
      const actual = v?.actual_markup_bps ?? v?.avg_markup_bps
      const varianceBps =
        v?.variance_bps ?? (actual !== undefined ? actual - t.target_markup_bps : undefined)
      const over = v?.over_target ?? (varianceBps !== undefined ? varianceBps > 0 : false)
      return {
        target: t,
        corridor: c,
        name: corridorName(c),
        actual,
        varianceBps,
        over,
        paymentCount: v?.payment_count,
        leakage: v?.leakage_cents,
      }
    })
  }, [targets, variance, corridorById])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (onlyOver && !r.over) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [enriched, search, onlyOver])

  // Variance rows that have no configured target yet (over-target corridors worth flagging).
  const untargeted = useMemo(() => {
    const targetedCorridors = new Set(targets.map((t) => t.corridor_id))
    return variance.filter((v) => v.corridor_id && !targetedCorridors.has(v.corridor_id))
  }, [variance, targets])

  const stats = useMemo(() => {
    const overCount = enriched.filter((r) => r.over).length
    const totalLeakage = enriched.reduce((s, r) => s + (r.leakage ?? 0), 0)
    const avgTarget = targets.length
      ? targets.reduce((s, t) => s + t.target_markup_bps, 0) / targets.length
      : 0
    return { count: targets.length, overCount, totalLeakage, avgTarget }
  }, [enriched, targets])

  const availableCorridors = useMemo(() => {
    if (editing) return corridors
    const used = new Set(targets.map((t) => t.corridor_id))
    return corridors.filter((c) => !used.has(c.id))
  }, [corridors, targets, editing])

  function openCreate() {
    setEditing(null)
    setCorridorId(availableCorridors[0]?.id ?? '')
    setBps('')
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(t: Target) {
    setEditing(t)
    setCorridorId(t.corridor_id)
    setBps(String(t.target_markup_bps))
    setFormError(null)
    setFormOpen(true)
  }

  function quickAddForCorridor(cid: string) {
    setEditing(null)
    setCorridorId(cid)
    setBps('')
    setFormError(null)
    setFormOpen(true)
  }

  async function save() {
    setFormError(null)
    const bpsNum = Number(bps)
    if (!editing && !corridorId) {
      setFormError('Select a corridor')
      return
    }
    if (bps === '' || Number.isNaN(bpsNum) || bpsNum < 0) {
      setFormError('Enter a valid target markup in basis points')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateTarget(editing.id, { target_markup_bps: bpsNum })
      } else {
        await api.createTarget({
          org_id: orgId ?? undefined,
          corridor_id: corridorId,
          target_markup_bps: bpsNum,
        })
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save target')
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: Target) {
    if (!confirm('Delete this corridor target?')) return
    setDeletingId(t.id)
    try {
      await api.deleteTarget(t.id)
      setTargets((prev) => prev.filter((x) => x.id !== t.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete target')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Corridor targets</h1>
          <p className="mt-1 text-sm text-slate-400">
            Set acceptable markup ceilings per corridor and flag payments that drift over target.
          </p>
        </div>
        <Button onClick={openCreate} disabled={availableCorridors.length === 0 && corridors.length > 0}>
          New target
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Targets set" value={stats.count} />
        <Stat label="Avg target" value={fmtBps(stats.avgTarget)} tone="teal" />
        <Stat
          label="Over target"
          value={stats.overCount}
          tone={stats.overCount > 0 ? 'rose' : 'green'}
        />
        <Stat
          label="Flagged leakage"
          value={fmtCents(stats.totalLeakage)}
          tone={stats.totalLeakage > 0 ? 'amber' : 'default'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Targets</span>
            <Badge tone="slate">{filtered.length}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search corridor…"
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={onlyOver}
                onChange={(e) => setOnlyOver(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-orange-500"
              />
              Over target only
            </label>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading targets…" />
            </div>
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={targets.length === 0 ? 'No targets configured' : 'No targets match your filters'}
                description={
                  targets.length === 0
                    ? corridors.length === 0
                      ? 'Create corridors first, then set markup targets here.'
                      : 'Set a markup ceiling per corridor to start flagging variance.'
                    : 'Adjust the search or the over-target filter.'
                }
                action={
                  targets.length === 0 && corridors.length > 0 ? (
                    <Button onClick={openCreate}>New target</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Corridor</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">Actual</TH>
                  <TH>Variance</TH>
                  <TH className="text-right">Payments</TH>
                  <TH className="text-right">Leakage</TH>
                  <TH>Flag</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const ratio =
                    r.actual !== undefined && r.target.target_markup_bps > 0
                      ? r.actual / r.target.target_markup_bps
                      : undefined
                  const barPct = ratio === undefined ? 0 : Math.min(100, ratio * 50)
                  return (
                    <TR key={r.target.id}>
                      <TD>
                        <div className="font-medium text-slate-100">{r.name}</div>
                        {r.corridor && (
                          <div className="font-mono text-xs text-slate-500">
                            {r.corridor.base_currency}/{r.corridor.quote_currency}
                          </div>
                        )}
                      </TD>
                      <TD className="text-right font-medium tabular-nums text-orange-300">
                        {fmtBps(r.target.target_markup_bps)}
                      </TD>
                      <TD className="text-right tabular-nums">{fmtBps(r.actual)}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full ${r.over ? 'bg-rose-500' : 'bg-emerald-500'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span
                            className={`text-xs tabular-nums ${
                              r.varianceBps === undefined
                                ? 'text-slate-500'
                                : r.varianceBps > 0
                                  ? 'text-rose-300'
                                  : 'text-emerald-300'
                            }`}
                          >
                            {r.varianceBps === undefined
                              ? '—'
                              : `${r.varianceBps > 0 ? '+' : ''}${r.varianceBps.toFixed(1)}`}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-slate-400">
                        {r.paymentCount ?? '—'}
                      </TD>
                      <TD className="text-right tabular-nums">{fmtCents(r.leakage)}</TD>
                      <TD>
                        {r.actual === undefined ? (
                          <Badge tone="slate">no data</Badge>
                        ) : r.over ? (
                          <Badge tone="rose">over target</Badge>
                        ) : (
                          <Badge tone="green">within</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => openEdit(r.target)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            className="px-3 py-1.5 text-xs"
                            disabled={deletingId === r.target.id}
                            onClick={() => remove(r.target)}
                          >
                            {deletingId === r.target.id ? '…' : 'Delete'}
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Untargeted corridors that show variance — encourage setting a target */}
      {!loading && !error && untargeted.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Corridors without a target</span>
              <Badge tone="amber">{untargeted.length}</Badge>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Corridor</TH>
                  <TH className="text-right">Actual markup</TH>
                  <TH className="text-right">Payments</TH>
                  <TH className="text-right">Leakage</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {untargeted.map((v) => {
                  const c = v.corridor_id ? corridorById(v.corridor_id) : undefined
                  const name =
                    corridorName(c) !== 'Unknown corridor'
                      ? corridorName(c)
                      : v.corridor_label ||
                        (v.base_currency && v.quote_currency
                          ? `${v.base_currency}/${v.quote_currency}`
                          : 'Corridor')
                  return (
                    <TR key={v.corridor_id}>
                      <TD className="font-medium text-slate-100">{name}</TD>
                      <TD className="text-right tabular-nums">
                        {fmtBps(v.actual_markup_bps ?? v.avg_markup_bps)}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-400">
                        {v.payment_count ?? '—'}
                      </TD>
                      <TD className="text-right tabular-nums">{fmtCents(v.leakage_cents)}</TD>
                      <TD className="text-right">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => v.corridor_id && quickAddForCorridor(v.corridor_id)}
                          disabled={!v.corridor_id}
                        >
                          Set target
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editing ? 'Edit target' : 'New corridor target'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save target' : 'Create target'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Corridor
            </span>
            <select
              value={corridorId}
              onChange={(e) => setCorridorId(e.target.value)}
              disabled={!!editing}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none disabled:opacity-60"
            >
              {editing ? (
                <option value={editing.corridor_id}>
                  {corridorName(corridorById(editing.corridor_id))}
                </option>
              ) : availableCorridors.length === 0 ? (
                <option value="">No corridors available</option>
              ) : (
                availableCorridors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {corridorName(c)}
                  </option>
                ))
              )}
            </select>
            {!editing && availableCorridors.length === 0 && corridors.length > 0 && (
              <p className="mt-1 text-xs text-amber-400">
                Every corridor already has a target. Edit an existing one instead.
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Target markup (basis points)
            </span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={bps}
              onChange={(e) => setBps(e.target.value)}
              placeholder="e.g. 25"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">
              Payments whose effective markup exceeds this ceiling are flagged as over target.
            </p>
          </label>
        </div>
      </Modal>
    </div>
  )
}
