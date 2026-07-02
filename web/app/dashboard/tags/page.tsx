'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Tag {
  id: string
  org_id: string
  name: string
  color: string
  created_at: string
}

interface TagRollup {
  tag_id: string
  tag_name?: string
  name?: string
  color?: string
  payment_count?: number
  total_markup_cents?: number
  total_leakage_cents?: number
  hidden_spread_cents?: number
  total_cost_cents?: number
  total_notional_cents?: number
}

const COLOR_OPTIONS = ['#14b8a6', '#0ea5e9', '#f59e0b', '#f43f5e', '#a855f7', '#22c55e', '#64748b', '#eab308']

function centsToUsd(cents?: number): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function leakageOf(r: TagRollup): number {
  return r.total_leakage_cents ?? r.total_cost_cents ?? r.total_markup_cents ?? r.hidden_spread_cents ?? 0
}

function rollupName(r: TagRollup, tags: Tag[]): string {
  return r.tag_name ?? r.name ?? tags.find((t) => t.id === r.tag_id)?.name ?? r.tag_id
}

function rollupColor(r: TagRollup, tags: Tag[]): string {
  return r.color ?? tags.find((t) => t.id === r.tag_id)?.color ?? '#14b8a6'
}

export default function TagsPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [tags, setTags] = useState<Tag[]>([])
  const [rollups, setRollups] = useState<TagRollup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', color: COLOR_OPTIONS[0] })

  const load = useCallback(async () => {
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const oid = org?.id as string | undefined
      setOrgId(oid)
      const [t, r] = await Promise.all([api.getTags(oid), api.getTagRollups(oid)])
      setTags(Array.isArray(t) ? t : [])
      setRollups(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([api.getTags(orgId), api.getTagRollups(orgId)])
      setTags(Array.isArray(t) ? t : [])
      setRollups(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    }
  }, [orgId])

  const filteredTags = useMemo(
    () => tags.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())),
    [tags, search],
  )

  const sortedRollups = useMemo(
    () => [...rollups].sort((a, b) => leakageOf(b) - leakageOf(a)),
    [rollups],
  )

  const maxLeakage = useMemo(
    () => Math.max(1, ...sortedRollups.map((r) => leakageOf(r))),
    [sortedRollups],
  )

  const stats = useMemo(() => {
    const totalLeakage = rollups.reduce((s, r) => s + leakageOf(r), 0)
    const totalPayments = rollups.reduce((s, r) => s + (r.payment_count ?? 0), 0)
    const top = sortedRollups[0]
    return {
      tags: tags.length,
      totalLeakage,
      totalPayments,
      topName: top ? rollupName(top, tags) : '—',
    }
  }, [rollups, sortedRollups, tags])

  async function submitCreate() {
    if (!form.name.trim()) {
      setError('Tag name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createTag({ org_id: orgId, name: form.name.trim(), color: form.color })
      setCreateOpen(false)
      setForm({ name: '', color: COLOR_OPTIONS[0] })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag')
    } finally {
      setBusy(false)
    }
  }

  async function removeTag(t: Tag) {
    if (!confirm(`Delete tag "${t.name}"? This removes it from all payments.`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteTag(t.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading tags…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tags</h1>
          <p className="mt-1 text-sm text-slate-400">
            Categorize payments and roll up hidden FX leakage by tag.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New tag</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tags" value={stats.tags} />
        <Stat label="Tagged payments" value={stats.totalPayments} />
        <Stat label="Total tagged leakage" value={centsToUsd(stats.totalLeakage)} tone="rose" />
        <Stat label="Top leakage tag" value={<span className="text-lg">{stats.topName}</span>} tone="amber" />
      </div>

      {/* Leakage rollups */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Leakage by tag</h2>
          <p className="text-xs text-slate-500">Hidden spread and total FX cost aggregated across tagged payments.</p>
        </CardHeader>
        <CardBody>
          {sortedRollups.length === 0 ? (
            <EmptyState
              title="No rollup data"
              description="Assign tags to payments to see leakage roll up here."
            />
          ) : (
            <div className="space-y-4">
              {sortedRollups.map((r) => {
                const leak = leakageOf(r)
                const pct = Math.round((leak / maxLeakage) * 100)
                const color = rollupColor(r, tags)
                return (
                  <div key={r.tag_id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-200">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                        {rollupName(r, tags)}
                        <span className="text-xs text-slate-500">
                          {r.payment_count ?? 0} payment{(r.payment_count ?? 0) === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="font-medium tabular-nums text-rose-300">{centsToUsd(leak)}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Tags table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">All tags</h2>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredTags.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={tags.length === 0 ? 'No tags yet' : 'No tags match your search'}
                description={
                  tags.length === 0
                    ? 'Create a tag to start categorizing payments.'
                    : 'Try a different search term.'
                }
                action={
                  tags.length === 0 ? <Button onClick={() => setCreateOpen(true)}>Create your first tag</Button> : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Tag</TH>
                  <TH>Payments</TH>
                  <TH>Leakage</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredTags.map((t) => {
                  const roll = rollups.find((r) => r.tag_id === t.id)
                  return (
                    <TR key={t.id}>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: t.color || '#14b8a6' }}
                          />
                          <span className="font-medium text-white">{t.name}</span>
                        </span>
                      </TD>
                      <TD className="tabular-nums text-slate-300">{roll?.payment_count ?? 0}</TD>
                      <TD className="tabular-nums text-rose-300">
                        {roll ? centsToUsd(leakageOf(roll)) : centsToUsd(0)}
                      </TD>
                      <TD className="whitespace-nowrap text-slate-400">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            className="text-rose-400 hover:text-rose-300"
                            onClick={() => removeTag(t)}
                            disabled={busy}
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
        onClose={() => setCreateOpen(false)}
        title="New tag"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Create tag'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Tag name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. EMEA payroll"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    form.color === c ? 'scale-110 border-white' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Select color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
