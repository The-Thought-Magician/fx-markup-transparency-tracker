'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ScenarioLeg {
  id: string
  scenario_id: string
  corridor_id?: string | null
  from_provider_id?: string | null
  to_provider_id?: string | null
  notional_cents: number
  current_markup_bps: number
  modeled_markup_bps: number
  leg_savings_cents: number
  created_at: string
}

interface SavingsScenario {
  id: string
  org_id: string
  name: string
  description?: string | null
  target_markup_bps?: number | null
  current_leakage_cents?: number | null
  modeled_leakage_cents?: number | null
  projected_savings_cents?: number | null
  created_at: string
  legs?: ScenarioLeg[]
}

interface Corridor {
  id: string
  label?: string | null
  base_currency: string
  quote_currency: string
}

interface Provider {
  id: string
  name: string
}

function fmtMoney(cents?: number | null) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function corridorLabel(c?: Corridor) {
  if (!c) return '—'
  return c.label || `${c.base_currency}/${c.quote_currency}`
}

const emptyLeg = {
  corridor_id: '',
  from_provider_id: '',
  to_provider_id: '',
  notional: '',
  current_markup_bps: '',
  modeled_markup_bps: '',
}

export default function ScenarioDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [scenario, setScenario] = useState<SavingsScenario | null>(null)
  const [legs, setLegs] = useState<ScenarioLeg[]>([])
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // edit scenario meta
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editTarget, setEditTarget] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  // add leg
  const [legForm, setLegForm] = useState({ ...emptyLeg })
  const [addingLeg, setAddingLeg] = useState(false)
  const [legError, setLegError] = useState<string | null>(null)

  // edit leg
  const [editLeg, setEditLeg] = useState<ScenarioLeg | null>(null)
  const [editLegForm, setEditLegForm] = useState({ ...emptyLeg })
  const [savingLeg, setSavingLeg] = useState(false)
  const [editLegError, setEditLegError] = useState<string | null>(null)

  // delete leg
  const [deleteLeg, setDeleteLeg] = useState<ScenarioLeg | null>(null)
  const [deletingLeg, setDeletingLeg] = useState(false)

  const applyScenario = useCallback((s: SavingsScenario | null) => {
    setScenario(s)
    setLegs(Array.isArray(s?.legs) ? s!.legs! : [])
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const s = await api.getScenario(id)
      applyScenario(s ?? null)
      const orgId = s?.org_id
      const [cs, ps] = await Promise.all([api.getCorridors(orgId), api.getProviders(orgId)])
      setCorridors(Array.isArray(cs) ? cs : [])
      setProviders(Array.isArray(ps) ? ps : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenario')
    } finally {
      setLoading(false)
    }
  }, [id, applyScenario])

  useEffect(() => {
    void load()
  }, [load])

  const corridorMap = useMemo(() => new Map(corridors.map((c) => [c.id, c])), [corridors])
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])

  // recompute totals after a leg mutation: refetch scenario (backend recomputes totals)
  const refetchScenario = useCallback(async () => {
    if (!id) return
    try {
      const s = await api.getScenario(id)
      applyScenario(s ?? null)
    } catch {
      /* keep current */
    }
  }, [id, applyScenario])

  function openEdit() {
    if (!scenario) return
    setEditName(scenario.name)
    setEditDesc(scenario.description ?? '')
    setEditTarget(scenario.target_markup_bps != null ? String(scenario.target_markup_bps) : '')
    setMetaError(null)
    setEditOpen(true)
  }

  async function handleSaveMeta() {
    if (!id) return
    if (!editName.trim()) {
      setMetaError('Name is required')
      return
    }
    setSavingMeta(true)
    setMetaError(null)
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        description: editDesc.trim() || null,
      }
      if (editTarget.trim() !== '') body.target_markup_bps = Number(editTarget)
      else body.target_markup_bps = null
      const updated = await api.updateScenario(id, body)
      if (updated && updated.id) applyScenario(updated)
      else await refetchScenario()
      setEditOpen(false)
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'Failed to update scenario')
    } finally {
      setSavingMeta(false)
    }
  }

  function legBody(form: typeof emptyLeg) {
    return {
      corridor_id: form.corridor_id || null,
      from_provider_id: form.from_provider_id || null,
      to_provider_id: form.to_provider_id || null,
      notional_cents: Math.round(Number(form.notional || 0) * 100),
      current_markup_bps: Number(form.current_markup_bps || 0),
      modeled_markup_bps: Number(form.modeled_markup_bps || 0),
    }
  }

  async function handleAddLeg() {
    if (!id) return
    if (legForm.notional.trim() === '' || Number(legForm.notional) <= 0) {
      setLegError('Notional must be greater than zero')
      return
    }
    setAddingLeg(true)
    setLegError(null)
    try {
      await api.addScenarioLeg(id, legBody(legForm))
      await refetchScenario()
      setLegForm({ ...emptyLeg })
    } catch (e) {
      setLegError(e instanceof Error ? e.message : 'Failed to add leg')
    } finally {
      setAddingLeg(false)
    }
  }

  function openEditLeg(leg: ScenarioLeg) {
    setEditLeg(leg)
    setEditLegForm({
      corridor_id: leg.corridor_id ?? '',
      from_provider_id: leg.from_provider_id ?? '',
      to_provider_id: leg.to_provider_id ?? '',
      notional: String((leg.notional_cents ?? 0) / 100),
      current_markup_bps: String(leg.current_markup_bps ?? ''),
      modeled_markup_bps: String(leg.modeled_markup_bps ?? ''),
    })
    setEditLegError(null)
  }

  async function handleSaveLeg() {
    if (!id || !editLeg) return
    if (editLegForm.notional.trim() === '' || Number(editLegForm.notional) <= 0) {
      setEditLegError('Notional must be greater than zero')
      return
    }
    setSavingLeg(true)
    setEditLegError(null)
    try {
      await api.updateScenarioLeg(id, editLeg.id, legBody(editLegForm))
      await refetchScenario()
      setEditLeg(null)
    } catch (e) {
      setEditLegError(e instanceof Error ? e.message : 'Failed to update leg')
    } finally {
      setSavingLeg(false)
    }
  }

  async function handleDeleteLeg() {
    if (!id || !deleteLeg) return
    setDeletingLeg(true)
    try {
      await api.deleteScenarioLeg(id, deleteLeg.id)
      await refetchScenario()
      setDeleteLeg(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete leg')
    } finally {
      setDeletingLeg(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading scenario…" />
      </div>
    )
  }

  if (error && !scenario) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/scenarios" className="text-sm text-orange-400 hover:text-orange-300">
          ← Back to scenarios
        </Link>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}{' '}
          <button onClick={() => void load()} className="ml-2 underline hover:text-rose-200">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/scenarios" className="text-sm text-orange-400 hover:text-orange-300">
          ← Back to scenarios
        </Link>
        <EmptyState title="Scenario not found" description="It may have been deleted." />
      </div>
    )
  }

  const current = scenario.current_leakage_cents ?? 0
  const modeled = scenario.modeled_leakage_cents ?? 0
  const savings = scenario.projected_savings_cents ?? 0
  const recoverablePct = current > 0 ? Math.min(100, (savings / current) * 100) : 0
  const maxBar = Math.max(current, modeled, 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/scenarios" className="text-sm text-orange-400 hover:text-orange-300">
          ← Back to scenarios
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{scenario.name}</h1>
            {scenario.target_markup_bps != null && (
              <Badge tone="blue">{scenario.target_markup_bps} bps target</Badge>
            )}
          </div>
          {scenario.description && <p className="max-w-2xl text-sm text-slate-500">{scenario.description}</p>}
        </div>
        <Button variant="secondary" onClick={openEdit}>
          Edit scenario
        </Button>
      </header>

      {/* Projected savings */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Current leakage" value={fmtMoney(current)} tone="amber" hint="Today's hidden cost" />
        <Stat label="Modeled leakage" value={fmtMoney(modeled)} tone="teal" hint="After applying legs" />
        <Stat label="Projected savings" value={fmtMoney(savings)} tone="green" hint="Recoverable annually" />
        <Stat label="Recoverable" value={`${recoverablePct.toFixed(0)}%`} tone="green" hint="Of current leakage" />
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-white">Current vs modeled leakage</h3>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Current</span>
                <span className="tabular-nums text-amber-300">{fmtMoney(current)}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                  style={{ width: `${(current / maxBar) * 100}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Modeled</span>
                <span className="tabular-nums text-orange-300">{fmtMoney(modeled)}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-300"
                  style={{ width: `${(modeled / maxBar) * 100}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
              Projected savings of <span className="font-semibold">{fmtMoney(savings)}</span> by applying the legs below.
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Add leg */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-white">Add leg</h3>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Corridor</span>
              <select
                value={legForm.corridor_id}
                onChange={(e) => setLegForm((f) => ({ ...f, corridor_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              >
                <option value="">— Select corridor —</option>
                {corridors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {corridorLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">From provider</span>
              <select
                value={legForm.from_provider_id}
                onChange={(e) => setLegForm((f) => ({ ...f, from_provider_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              >
                <option value="">— Select provider —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">To provider</span>
              <select
                value={legForm.to_provider_id}
                onChange={(e) => setLegForm((f) => ({ ...f, to_provider_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              >
                <option value="">— Select provider —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Notional (USD)</span>
              <input
                type="number"
                value={legForm.notional}
                onChange={(e) => setLegForm((f) => ({ ...f, notional: e.target.value }))}
                placeholder="e.g. 250000"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Current markup (bps)</span>
              <input
                type="number"
                value={legForm.current_markup_bps}
                onChange={(e) => setLegForm((f) => ({ ...f, current_markup_bps: e.target.value }))}
                placeholder="e.g. 80"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Modeled markup (bps)</span>
              <input
                type="number"
                value={legForm.modeled_markup_bps}
                onChange={(e) => setLegForm((f) => ({ ...f, modeled_markup_bps: e.target.value }))}
                placeholder="e.g. 25"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void handleAddLeg()} disabled={addingLeg}>
              {addingLeg ? 'Adding…' : 'Add leg'}
            </Button>
            {legError && <span className="text-sm text-rose-400">{legError}</span>}
          </div>
        </CardBody>
      </Card>

      {/* Legs table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Legs</h3>
            <Badge tone="slate">{legs.length} legs</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {legs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No legs yet"
                description="Add a leg above to model a corridor or provider switch and see projected savings."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Corridor</TH>
                  <TH>From → To</TH>
                  <TH className="text-right">Notional</TH>
                  <TH className="text-right">Current bps</TH>
                  <TH className="text-right">Modeled bps</TH>
                  <TH className="text-right">Leg savings</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {legs.map((leg) => (
                  <TR key={leg.id}>
                    <TD>{corridorLabel(corridorMap.get(leg.corridor_id ?? ''))}</TD>
                    <TD className="text-slate-300">
                      {providerMap.get(leg.from_provider_id ?? '')?.name ?? '—'}
                      <span className="px-1 text-slate-600">→</span>
                      {providerMap.get(leg.to_provider_id ?? '')?.name ?? '—'}
                    </TD>
                    <TD className="text-right tabular-nums">{fmtMoney(leg.notional_cents)}</TD>
                    <TD className="text-right tabular-nums text-amber-300">{leg.current_markup_bps}</TD>
                    <TD className="text-right tabular-nums text-orange-300">{leg.modeled_markup_bps}</TD>
                    <TD className="text-right tabular-nums font-semibold text-emerald-300">
                      {fmtMoney(leg.leg_savings_cents)}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => openEditLeg(leg)}>
                          Edit
                        </Button>
                        <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setDeleteLeg(leg)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit scenario modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit scenario"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveMeta()} disabled={savingMeta}>
              {savingMeta ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Description</span>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Target markup (bps)</span>
            <input
              type="number"
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
            />
          </label>
          {metaError && <p className="text-sm text-rose-400">{metaError}</p>}
        </div>
      </Modal>

      {/* Edit leg modal */}
      <Modal
        open={editLeg != null}
        onClose={() => setEditLeg(null)}
        title="Edit leg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditLeg(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveLeg()} disabled={savingLeg}>
              {savingLeg ? 'Saving…' : 'Save leg'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Corridor</span>
            <select
              value={editLegForm.corridor_id}
              onChange={(e) => setEditLegForm((f) => ({ ...f, corridor_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
            >
              <option value="">— Select corridor —</option>
              {corridors.map((c) => (
                <option key={c.id} value={c.id}>
                  {corridorLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">From provider</span>
              <select
                value={editLegForm.from_provider_id}
                onChange={(e) => setEditLegForm((f) => ({ ...f, from_provider_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              >
                <option value="">—</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">To provider</span>
              <select
                value={editLegForm.to_provider_id}
                onChange={(e) => setEditLegForm((f) => ({ ...f, to_provider_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              >
                <option value="">—</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Notional (USD)</span>
            <input
              type="number"
              value={editLegForm.notional}
              onChange={(e) => setEditLegForm((f) => ({ ...f, notional: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Current bps</span>
              <input
                type="number"
                value={editLegForm.current_markup_bps}
                onChange={(e) => setEditLegForm((f) => ({ ...f, current_markup_bps: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Modeled bps</span>
              <input
                type="number"
                value={editLegForm.modeled_markup_bps}
                onChange={(e) => setEditLegForm((f) => ({ ...f, modeled_markup_bps: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-orange-500 focus:outline-none"
              />
            </label>
          </div>
          {editLegError && <p className="text-sm text-rose-400">{editLegError}</p>}
        </div>
      </Modal>

      {/* Delete leg modal */}
      <Modal
        open={deleteLeg != null}
        onClose={() => setDeleteLeg(null)}
        title="Delete leg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteLeg(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteLeg()} disabled={deletingLeg}>
              {deletingLeg ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">Remove this leg from the scenario? Totals will be recomputed.</p>
      </Modal>
    </div>
  )
}
