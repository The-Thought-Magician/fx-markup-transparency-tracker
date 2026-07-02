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

interface AuditEvent {
  id: string
  org_id: string
  user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  detail: unknown
  created_at: string
}

const ENTITY_TYPES = [
  'payment',
  'provider',
  'corridor',
  'benchmark',
  'rate_source',
  'reconciliation',
  'import',
  'mapping',
  'scenario',
  'target',
  'alert',
  'alert_rule',
  'report',
  'tag',
  'ledger',
  'organization',
  'note',
  'widget',
]

const ACTIONS = ['create', 'update', 'delete', 'evaluate', 'generate', 'commit', 'run', 'seed', 'reset']

function actionTone(action: string): 'green' | 'amber' | 'rose' | 'teal' | 'blue' | 'slate' {
  switch ((action || '').toLowerCase()) {
    case 'create':
    case 'seed':
      return 'green'
    case 'update':
    case 'commit':
      return 'amber'
    case 'delete':
    case 'reset':
      return 'rose'
    case 'evaluate':
    case 'run':
      return 'blue'
    case 'generate':
      return 'teal'
    default:
      return 'slate'
  }
}

function detailPreview(detail: unknown): string {
  if (detail == null) return '—'
  if (typeof detail === 'string') return detail
  try {
    const s = JSON.stringify(detail)
    return s.length > 80 ? `${s.slice(0, 80)}…` : s
  } catch {
    return String(detail)
  }
}

function formatRelative(iso: string): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function ActivityPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AuditEvent | null>(null)

  const [recordOpen, setRecordOpen] = useState(false)
  const [form, setForm] = useState({ entity_type: 'payment', entity_id: '', action: 'create', detail: '' })

  const load = useCallback(async () => {
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const oid = org?.id as string | undefined
      setOrgId(oid)
      const feed = await api.getActivity({ org_id: oid })
      setEvents(Array.isArray(feed) ? feed : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    try {
      const query: Record<string, string | undefined> = { org_id: orgId }
      if (entityFilter !== 'all') query.entity_type = entityFilter
      const feed = await api.getActivity(query)
      setEvents(Array.isArray(feed) ? feed : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh activity')
    }
  }, [orgId, entityFilter])

  // Server-side entity filter: re-fetch when entity filter changes.
  useEffect(() => {
    if (loading) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter])

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (actionFilter !== 'all' && (e.action || '').toLowerCase() !== actionFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${e.entity_type} ${e.entity_id ?? ''} ${e.action} ${detailPreview(e.detail)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, actionFilter, search])

  const stats = useMemo(() => {
    const byAction = new Map<string, number>()
    const byEntity = new Map<string, number>()
    let last24 = 0
    const dayAgo = Date.now() - 24 * 3600 * 1000
    for (const e of events) {
      byAction.set(e.action, (byAction.get(e.action) ?? 0) + 1)
      byEntity.set(e.entity_type, (byEntity.get(e.entity_type) ?? 0) + 1)
      if (new Date(e.created_at).getTime() >= dayAgo) last24++
    }
    const topEntity = [...byEntity.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      total: events.length,
      last24,
      distinctEntities: byEntity.size,
      topEntity: topEntity ? `${topEntity[0]} (${topEntity[1]})` : '—',
    }
  }, [events])

  const actionBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events) counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const max = rows.reduce((m, r) => Math.max(m, r[1]), 1)
    return { rows, max }
  }, [events])

  async function submitRecord() {
    if (!form.entity_type.trim()) {
      setError('Entity type is required')
      return
    }
    let detail: unknown = undefined
    if (form.detail.trim()) {
      try {
        detail = JSON.parse(form.detail)
      } catch {
        detail = { note: form.detail.trim() }
      }
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.recordActivity({
        org_id: orgId,
        entity_type: form.entity_type.trim(),
        entity_id: form.entity_id.trim() || null,
        action: form.action,
        detail,
      })
      setRecordOpen(false)
      setForm({ entity_type: 'payment', entity_id: '', action: 'create', detail: '' })
      setNotice('Activity event recorded.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record activity')
    } finally {
      setBusy(false)
    }
  }

  function clearFilters() {
    setEntityFilter('all')
    setActionFilter('all')
    setSearch('')
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading activity…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity</h1>
          <p className="mt-1 text-sm text-slate-400">
            A chronological audit trail of every change across providers, payments, and FX-cost analysis.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refresh} disabled={busy}>
            Refresh
          </Button>
          <Button onClick={() => setRecordOpen(true)} disabled={busy}>
            + Record event
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total events" value={stats.total} />
        <Stat label="Last 24h" value={stats.last24} tone={stats.last24 > 0 ? 'teal' : 'default'} />
        <Stat label="Entity types" value={stats.distinctEntities} />
        <Stat label="Most active" value={<span className="text-base">{stats.topEntity}</span>} />
      </div>

      {/* Action breakdown chart (pure SVG/divs) */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Activity by action</h2>
          <p className="text-xs text-slate-500">Distribution of recorded actions across the feed.</p>
        </CardHeader>
        <CardBody>
          {actionBreakdown.rows.length === 0 ? (
            <p className="text-sm text-slate-500">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {actionBreakdown.rows.map(([action, count]) => (
                <div key={action} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-right">
                    <Badge tone={actionTone(action)}>{action}</Badge>
                  </div>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${Math.max(4, (count / actionBreakdown.max) * 100)}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-slate-300">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Feed */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Audit feed</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events…"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
              />
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All entities</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All actions</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              {(entityFilter !== 'all' || actionFilter !== 'all' || search) && (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={events.length === 0 ? 'No activity yet' : 'No events match your filters'}
                description={
                  events.length === 0
                    ? 'As you create providers, record payments, and run analyses, every change is logged here.'
                    : 'Try clearing the search or filters above.'
                }
                action={
                  events.length === 0 ? (
                    <Button onClick={() => setRecordOpen(true)}>Record an event</Button>
                  ) : (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Detail</TH>
                  <TH>When</TH>
                  <TH className="text-right">View</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Badge tone={actionTone(e.action)}>{e.action || '—'}</Badge>
                    </TD>
                    <TD>
                      <div className="font-medium text-white">{e.entity_type}</div>
                      {e.entity_id && (
                        <div className="font-mono text-xs text-slate-500">{e.entity_id}</div>
                      )}
                    </TD>
                    <TD className="max-w-xs truncate font-mono text-xs text-slate-400">
                      {detailPreview(e.detail)}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400" title={e.created_at ? new Date(e.created_at).toLocaleString() : ''}>
                      {formatRelative(e.created_at)}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button variant="ghost" onClick={() => setSelected(e)}>
                          Details
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

      <Modal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        title="Record activity event"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRecordOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitRecord} disabled={busy}>
              {busy ? 'Recording…' : 'Record event'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Entity type
              </label>
              <select
                value={form.entity_type}
                onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Action
              </label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Entity ID <span className="text-slate-600">(optional)</span>
            </label>
            <input
              value={form.entity_id}
              onChange={(e) => setForm({ ...form, entity_id: e.target.value })}
              placeholder="e.g. payment id"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Detail <span className="text-slate-600">(JSON or plain note)</span>
            </label>
            <textarea
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              rows={4}
              placeholder='{"reason": "manual adjustment"}'
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={selected != null}
        onClose={() => setSelected(null)}
        title="Event detail"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={actionTone(selected.action)}>{selected.action}</Badge>
              <span className="font-medium text-white">{selected.entity_type}</span>
            </div>
            <dl className="grid grid-cols-3 gap-y-2">
              <dt className="text-slate-500">Entity ID</dt>
              <dd className="col-span-2 break-all font-mono text-xs text-slate-300">
                {selected.entity_id || '—'}
              </dd>
              <dt className="text-slate-500">User</dt>
              <dd className="col-span-2 break-all font-mono text-xs text-slate-300">
                {selected.user_id || '—'}
              </dd>
              <dt className="text-slate-500">Created</dt>
              <dd className="col-span-2 text-slate-300">
                {selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}
              </dd>
            </dl>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Detail</div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-300">
                {selected.detail == null
                  ? '—'
                  : typeof selected.detail === 'string'
                    ? selected.detail
                    : JSON.stringify(selected.detail, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
