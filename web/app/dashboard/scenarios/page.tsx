'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

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
}

function fmtMoney(cents?: number | null) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function ScenariosPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<SavingsScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetBps, setTargetBps] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState<SavingsScenario | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const id = org?.id ?? null
      setOrgId(id)
      const list = await api.getScenarios(id ?? undefined)
      setScenarios(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setName('')
    setDescription('')
    setTargetBps('')
    setSaveError(null)
  }

  async function handleCreate() {
    if (!name.trim()) {
      setSaveError('Name is required')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const body: Record<string, unknown> = {
        org_id: orgId,
        name: name.trim(),
        description: description.trim() || null,
      }
      if (targetBps.trim() !== '') body.target_markup_bps = Number(targetBps)
      const created = await api.createScenario(body)
      if (created && created.id) {
        setScenarios((prev) => [created, ...prev])
      } else {
        await load()
      }
      setCreateOpen(false)
      resetForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to create scenario')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.deleteScenario(confirmDelete.id)
      setScenarios((prev) => prev.filter((s) => s.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete scenario')
    } finally {
      setDeleting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scenarios
    return scenarios.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
    )
  }, [scenarios, search])

  const totalProjected = useMemo(
    () => scenarios.reduce((sum, s) => sum + (s.projected_savings_cents ?? 0), 0),
    [scenarios],
  )
  const bestScenario = useMemo(
    () =>
      scenarios.reduce<SavingsScenario | null>(
        (best, s) =>
          (s.projected_savings_cents ?? 0) > (best?.projected_savings_cents ?? -Infinity) ? s : best,
        null,
      ),
    [scenarios],
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading scenarios…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Savings Scenarios</h1>
            <Badge tone="teal">What-if modeling</Badge>
          </div>
          <p className="text-sm text-slate-500">
            Model corridor and provider switches to project how much FX leakage you can recover.
          </p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true) }}>New scenario</Button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}{' '}
          <button onClick={() => void load()} className="ml-2 underline hover:text-rose-200">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Scenarios" value={scenarios.length} hint="Saved models" />
        <Stat label="Total projected savings" value={fmtMoney(totalProjected)} tone="green" hint="Across all scenarios" />
        <Stat
          label="Best scenario"
          value={bestScenario ? fmtMoney(bestScenario.projected_savings_cents) : '—'}
          tone="teal"
          hint={bestScenario?.name ?? 'No scenarios yet'}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">All scenarios</h3>
            <input
              type="search"
              placeholder="Search scenarios…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={scenarios.length === 0 ? 'No scenarios yet' : 'No matches'}
              description={
                scenarios.length === 0
                  ? 'Create a scenario, then add legs to model switching providers or tightening markup.'
                  : 'No scenarios match your search.'
              }
              action={
                scenarios.length === 0 ? (
                  <Button onClick={() => { resetForm(); setCreateOpen(true) }}>New scenario</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => {
                const savings = s.projected_savings_cents ?? 0
                const current = s.current_leakage_cents ?? 0
                const pct = current > 0 ? Math.min(100, (savings / current) * 100) : 0
                return (
                  <div
                    key={s.id}
                    className="group flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-teal-500/40"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/dashboard/scenarios/${s.id}`}
                          className="text-base font-semibold text-white hover:text-teal-300"
                        >
                          {s.name}
                        </Link>
                        {s.target_markup_bps != null && (
                          <Badge tone="blue">{s.target_markup_bps} bps target</Badge>
                        )}
                      </div>
                      {s.description && <p className="text-sm text-slate-500">{s.description}</p>}
                      <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-600">Current leakage</div>
                          <div className="font-medium tabular-nums text-amber-300">{fmtMoney(current)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-600">Projected savings</div>
                          <div className="font-semibold tabular-nums text-emerald-300">{fmtMoney(savings)}</div>
                        </div>
                      </div>
                      <div className="space-y-1 pt-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-right text-xs text-slate-600">{pct.toFixed(0)}% recoverable</div>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <Link href={`/dashboard/scenarios/${s.id}`}>
                        <Button variant="secondary" className="px-3 py-1.5 text-xs">
                          Open
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300"
                        onClick={() => setConfirmDelete(s)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New savings scenario"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving ? 'Creating…' : 'Create scenario'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Consolidate EUR corridor to Provider B"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional notes about this scenario"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Target markup (bps)</span>
            <input
              type="number"
              value={targetBps}
              onChange={(e) => setTargetBps(e.target.value)}
              placeholder="e.g. 25"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </label>
          {saveError && <p className="text-sm text-rose-400">{saveError}</p>}
        </div>
      </Modal>

      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title="Delete scenario"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{confirmDelete?.name}</span> and all of its legs? This
          cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
