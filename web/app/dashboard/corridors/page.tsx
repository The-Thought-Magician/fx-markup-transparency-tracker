'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Corridor {
  id: string
  org_id: string
  base_currency: string
  quote_currency: string
  label?: string | null
  is_active?: boolean | null
  created_at?: string | null
}

interface CorridorStats {
  payment_count?: number
  total_notional_cents?: number
  total_leakage_cents?: number
  total_markup_cents?: number
  avg_markup_bps?: number
  [k: string]: unknown
}

function fmtCents(c?: number | null): string {
  if (c == null) return '—'
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function bpsTone(b: number): 'green' | 'amber' | 'rose' {
  if (b <= 25) return 'green'
  if (b <= 75) return 'amber'
  return 'rose'
}

export default function CorridorsPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, CorridorStats>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ base_currency: '', quote_currency: '', label: '', is_active: true })

  const [editTarget, setEditTarget] = useState<Corridor | null>(null)
  const [editForm, setEditForm] = useState({ label: '', is_active: true })
  const [savingEdit, setSavingEdit] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Corridor | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      let resolvedOrg = orgId
      if (!resolvedOrg) {
        try {
          const org = await api.getCurrentOrg()
          resolvedOrg = org?.id
          setOrgId(resolvedOrg)
        } catch {
          // fall back to unfiltered
        }
      }
      const data = await api.getCorridors(resolvedOrg)
      const list: Corridor[] = Array.isArray(data) ? data : data?.corridors ?? []
      setCorridors(list)

      const entries = await Promise.all(
        list.map(async (c) => {
          try {
            const s = await api.getCorridorStats(c.id)
            return [c.id, (s && typeof s === 'object' ? s : {}) as CorridorStats] as const
          } catch {
            return [c.id, {} as CorridorStats] as const
          }
        })
      )
      setStatsMap(Object.fromEntries(entries))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load corridors')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return corridors.filter((c) => {
      const pair = `${c.base_currency}/${c.quote_currency} ${c.label ?? ''}`.toLowerCase()
      if (search && !pair.includes(search.toLowerCase())) return false
      if (activeFilter === 'active' && !c.is_active) return false
      if (activeFilter === 'inactive' && c.is_active) return false
      return true
    })
  }, [corridors, search, activeFilter])

  const totalLeakage = corridors.reduce(
    (sum, c) => sum + num(statsMap[c.id]?.total_leakage_cents ?? statsMap[c.id]?.total_markup_cents),
    0
  )
  const totalPayments = corridors.reduce((sum, c) => sum + num(statsMap[c.id]?.payment_count), 0)
  const maxLeakage = Math.max(
    1,
    ...corridors.map((c) => num(statsMap[c.id]?.total_leakage_cents ?? statsMap[c.id]?.total_markup_cents))
  )

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createCorridor({
        org_id: orgId,
        base_currency: form.base_currency.trim().toUpperCase(),
        quote_currency: form.quote_currency.trim().toUpperCase(),
        label: form.label.trim() || null,
        is_active: form.is_active,
      })
      setCreateOpen(false)
      setForm({ base_currency: '', quote_currency: '', label: '', is_active: true })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create corridor')
    } finally {
      setSubmitting(false)
    }
  }

  function openEdit(c: Corridor) {
    setEditTarget(c)
    setEditForm({ label: c.label ?? '', is_active: c.is_active ?? true })
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setSavingEdit(true)
    try {
      await api.updateCorridor(editTarget.id, {
        label: editForm.label.trim() || null,
        is_active: editForm.is_active,
      })
      setEditTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update corridor')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCorridor(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete corridor')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Corridors</h1>
          <p className="mt-1 text-sm text-slate-400">
            Currency pairs you send money across. Track volume, average markup and leakage per corridor.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New corridor</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Corridors" value={corridors.length} tone="teal" />
        <Stat label="Payments tracked" value={totalPayments.toLocaleString()} />
        <Stat label="Total leakage" value={fmtCents(totalLeakage)} tone="rose" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pair or label (e.g. USD/EUR)…"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
          />
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <Spinner className="py-16" label="Loading corridors…" />
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              className="m-5"
              title={corridors.length === 0 ? 'No corridors yet' : 'No corridors match your filters'}
              description={
                corridors.length === 0
                  ? 'Define the currency pairs you transact in to measure FX markup across each route.'
                  : 'Try clearing the search or filters above.'
              }
              action={
                corridors.length === 0 ? <Button onClick={() => setCreateOpen(true)}>+ New corridor</Button> : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Pair</TH>
                  <TH>Label</TH>
                  <TH className="text-right">Payments</TH>
                  <TH className="text-right">Notional</TH>
                  <TH className="text-right">Avg markup</TH>
                  <TH>Leakage</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const s = statsMap[c.id] ?? {}
                  const leak = num(s.total_leakage_cents ?? s.total_markup_cents)
                  const bps = num(s.avg_markup_bps)
                  return (
                    <TR key={c.id}>
                      <TD>
                        <span className="font-mono font-semibold text-orange-300">
                          {c.base_currency}/{c.quote_currency}
                        </span>
                      </TD>
                      <TD className="text-slate-400">{c.label ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{num(s.payment_count).toLocaleString()}</TD>
                      <TD className="text-right tabular-nums">{fmtCents(s.total_notional_cents)}</TD>
                      <TD className="text-right">
                        {s.avg_markup_bps != null ? (
                          <Badge tone={bpsTone(bps)}>{bps.toFixed(1)} bps</Badge>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-rose-500" style={{ width: `${(leak / maxLeakage) * 100}%` }} />
                          </div>
                          <span className="tabular-nums text-xs text-slate-400">{fmtCents(leak)}</span>
                        </div>
                      </TD>
                      <TD>{c.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" className="px-3 py-1.5" onClick={() => openEdit(c)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-3 py-1.5 text-rose-300 hover:text-rose-200"
                            onClick={() => setDeleteTarget(c)}
                          >
                            Delete
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

      <Modal
        open={createOpen}
        onClose={() => (submitting ? null : setCreateOpen(false))}
        title="New corridor"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="corridor-create-form"
              disabled={submitting || form.base_currency.trim().length < 3 || form.quote_currency.trim().length < 3}
            >
              {submitting ? 'Creating…' : 'Create corridor'}
            </Button>
          </div>
        }
      >
        <form id="corridor-create-form" onSubmit={handleCreate} className="space-y-4">
          {formError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Base currency</label>
              <input
                value={form.base_currency}
                onChange={(e) => setForm({ ...form, base_currency: e.target.value })}
                placeholder="USD"
                maxLength={3}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Quote currency</label>
              <input
                value={form.quote_currency}
                onChange={(e) => setForm({ ...form, quote_currency: e.target.value })}
                placeholder="EUR"
                maxLength={3}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Label (optional)</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="EU supplier payments"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-orange-500 focus:ring-orange-500"
            />
            Active
          </label>
        </form>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => (savingEdit ? null : setEditTarget(null))}
        title={editTarget ? `Edit ${editTarget.base_currency}/${editTarget.quote_currency}` : 'Edit corridor'}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="submit" form="corridor-edit-form" disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <form id="corridor-edit-form" onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Label</label>
            <input
              value={editForm.label}
              onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
              placeholder="EU supplier payments"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-orange-500 focus:ring-orange-500"
            />
            Active
          </label>
        </form>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title="Delete corridor"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">
          Delete corridor{' '}
          <span className="font-mono font-semibold text-white">
            {deleteTarget?.base_currency}/{deleteTarget?.quote_currency}
          </span>
          ? Payments referencing this corridor may be affected.
        </p>
      </Modal>
    </div>
  )
}
