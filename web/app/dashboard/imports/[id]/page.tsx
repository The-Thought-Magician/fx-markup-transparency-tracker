'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface ImportBatch {
  id: string
  org_id: string
  provider_id?: string | null
  filename: string
  format: string
  status: string
  row_count: number
  error_count: number
  created_at: string
  rows?: ImportRow[]
}

interface ImportRow {
  id: string
  batch_id: string
  raw: Record<string, unknown> | null
  normalized: Record<string, unknown> | null
  status: string
  error?: string | null
  created_at: string
}

interface Mapping {
  id: string
  org_id: string
  provider_id?: string | null
  name: string
  field_map: Record<string, string>
  created_at: string
}

// Canonical payment fields the import normalizer targets.
const TARGET_FIELDS = [
  'reference',
  'base_currency',
  'quote_currency',
  'notional_base',
  'applied_rate',
  'disclosed_fee_cents',
  'value_date',
  'provider_id',
  'corridor',
]

function rowTone(status: string): 'green' | 'amber' | 'rose' | 'slate' {
  switch (status) {
    case 'ok':
    case 'valid':
    case 'committed':
      return 'green'
    case 'pending':
    case 'mapped':
      return 'amber'
    case 'error':
    case 'invalid':
      return 'rose'
    default:
      return 'slate'
  }
}

function batchTone(status: string): 'teal' | 'green' | 'amber' | 'rose' | 'slate' {
  switch (status) {
    case 'committed':
      return 'green'
    case 'parsed':
    case 'ready':
      return 'teal'
    case 'pending':
    case 'parsing':
      return 'amber'
    case 'failed':
    case 'error':
      return 'rose'
    default:
      return 'slate'
  }
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function ImportDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')

  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'raw' | 'normalized'>('raw')
  const [rowFilter, setRowFilter] = useState('all')

  const [committing, setCommitting] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Mapping editor state
  const [mapOpen, setMapOpen] = useState(false)
  const [editingMap, setEditingMap] = useState<Mapping | null>(null)
  const [mapName, setMapName] = useState('')
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({})
  const [savingMap, setSavingMap] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [batchRes, rowsRes] = await Promise.all([api.getImport(id), api.getImportRows(id)])
      const b: ImportBatch = batchRes
      setBatch(b)
      setRows(Array.isArray(rowsRes) ? rowsRes : Array.isArray(b?.rows) ? b.rows : [])
      try {
        const mapRes = await api.getMappings({ org_id: b?.org_id, provider_id: b?.provider_id ?? undefined })
        setMappings(Array.isArray(mapRes) ? mapRes : [])
      } catch {
        setMappings([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load import batch')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const sourceColumns = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => {
      const obj = r.raw
      if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => set.add(k))
    })
    return Array.from(set)
  }, [rows])

  const columns = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => {
      const obj = view === 'raw' ? r.raw : r.normalized
      if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => set.add(k))
    })
    return Array.from(set)
  }, [rows, view])

  const filteredRows = useMemo(() => {
    if (rowFilter === 'all') return rows
    if (rowFilter === 'errors') return rows.filter((r) => r.status === 'error' || r.status === 'invalid' || r.error)
    return rows.filter((r) => r.status === rowFilter)
  }, [rows, rowFilter])

  const rowStats = useMemo(() => {
    const errors = rows.filter((r) => r.status === 'error' || r.status === 'invalid' || r.error).length
    return { total: rows.length, errors, ok: rows.length - errors }
  }, [rows])

  function openCreateMapping() {
    setEditingMap(null)
    setMapName('')
    const initial: Record<string, string> = {}
    // Pre-fill identity matches where a source column equals a target field.
    TARGET_FIELDS.forEach((t) => {
      const match = sourceColumns.find((c) => c.toLowerCase() === t.toLowerCase())
      if (match) initial[t] = match
    })
    setFieldMap(initial)
    setMapError(null)
    setMapOpen(true)
  }

  function openEditMapping(m: Mapping) {
    setEditingMap(m)
    setMapName(m.name)
    setFieldMap({ ...(m.field_map || {}) })
    setMapError(null)
    setMapOpen(true)
  }

  async function saveMapping() {
    setMapError(null)
    if (!mapName.trim()) {
      setMapError('Mapping name is required')
      return
    }
    const cleaned: Record<string, string> = {}
    Object.entries(fieldMap).forEach(([k, v]) => {
      if (v && v.trim()) cleaned[k] = v.trim()
    })
    if (Object.keys(cleaned).length === 0) {
      setMapError('Map at least one target field to a source column')
      return
    }
    setSavingMap(true)
    try {
      if (editingMap) {
        await api.updateMapping(editingMap.id, { name: mapName.trim(), field_map: cleaned })
      } else {
        await api.createMapping({
          org_id: batch?.org_id,
          provider_id: batch?.provider_id ?? undefined,
          name: mapName.trim(),
          field_map: cleaned,
        })
      }
      setMapOpen(false)
      await load()
    } catch (e) {
      setMapError(e instanceof Error ? e.message : 'Failed to save mapping')
    } finally {
      setSavingMap(false)
    }
  }

  async function removeMapping(m: Mapping) {
    if (!confirm(`Delete mapping "${m.name}"?`)) return
    try {
      await api.deleteMapping(m.id)
      setMappings((prev) => prev.filter((x) => x.id !== m.id))
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to delete mapping')
    }
  }

  async function commit(mappingId?: string) {
    setActionMsg(null)
    if (!confirm('Commit normalized rows into tracked payments?')) return
    setCommitting(true)
    try {
      const res = await api.commitImport(id, {
        mapping_id: mappingId,
        field_map: mappingId ? undefined : Object.keys(fieldMap).length ? fieldMap : undefined,
      })
      const committed = res?.committed ?? res?.created ?? 0
      setActionMsg(`Committed ${committed} payment${committed === 1 ? '' : 's'} from this batch.`)
      await load()
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to commit batch')
    } finally {
      setCommitting(false)
    }
  }

  if (loading) {
    return (
      <div className="py-20">
        <Spinner label="Loading import batch…" />
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/imports" className="text-sm text-teal-400 hover:text-teal-300">
          ← Back to imports
        </Link>
        <EmptyState
          title="Could not load this import"
          description={error ?? 'The batch may have been deleted.'}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const committed = batch.status === 'committed'

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/imports" className="text-sm text-teal-400 hover:text-teal-300">
          ← Back to imports
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">{batch.filename}</h1>
            <Badge tone={batchTone(batch.status)}>{batch.status}</Badge>
            <span className="font-mono text-xs uppercase text-slate-500">{batch.format}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={openCreateMapping}>
              New mapping
            </Button>
            <Button onClick={() => commit()} disabled={committing || committed}>
              {committed ? 'Committed' : committing ? 'Committing…' : 'Commit batch'}
            </Button>
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total rows" value={rowStats.total.toLocaleString()} />
        <Stat label="Valid rows" value={rowStats.ok.toLocaleString()} tone="green" />
        <Stat
          label="Error rows"
          value={rowStats.errors.toLocaleString()}
          tone={rowStats.errors > 0 ? 'rose' : 'default'}
        />
        <Stat label="Created" value={new Date(batch.created_at).toLocaleDateString()} />
      </div>

      {/* Mapping editor / list */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Field mappings</span>
            <Badge tone="slate">{mappings.length}</Badge>
          </div>
          <Button variant="ghost" onClick={openCreateMapping}>
            + Add mapping
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {mappings.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No saved mappings"
                description="Create a mapping to translate this provider's column names into canonical payment fields before committing."
                action={<Button onClick={openCreateMapping}>New mapping</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Mapped fields</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {mappings.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium text-slate-100">{m.name}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(m.field_map || {}).map(([target, source]) => (
                          <span
                            key={target}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs"
                          >
                            <span className="text-slate-500">{source}</span>
                            <span className="text-slate-600">→</span>
                            <span className="text-teal-300">{target}</span>
                          </span>
                        ))}
                      </div>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          disabled={committing || committed}
                          onClick={() => commit(m.id)}
                        >
                          Commit with this
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => openEditMapping(m)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => removeMapping(m)}
                        >
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

      {/* Rows preview */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Rows preview</span>
            <Badge tone="slate">{filteredRows.length}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              <button
                onClick={() => setView('raw')}
                className={`px-3 py-1.5 text-xs font-medium ${
                  view === 'raw' ? 'bg-teal-500 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                Raw
              </button>
              <button
                onClick={() => setView('normalized')}
                className={`px-3 py-1.5 text-xs font-medium ${
                  view === 'normalized'
                    ? 'bg-teal-500 text-slate-950'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                Normalized
              </button>
            </div>
            <select
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
            >
              <option value="all">All rows</option>
              <option value="errors">Errors only</option>
              <option value="ok">Valid only</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredRows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rows.length === 0 ? 'No rows in this batch' : 'No rows match this filter'}
                description={
                  rows.length === 0
                    ? 'The uploaded file produced no parseable rows.'
                    : 'Switch the filter to see other rows.'
                }
              />
            </div>
          ) : columns.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={view === 'normalized' ? 'No normalized data yet' : 'No columns detected'}
                description={
                  view === 'normalized'
                    ? 'Apply a mapping and commit to populate normalized fields, or switch to the Raw view.'
                    : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Status</TH>
                  {columns.map((c) => (
                    <TH key={c}>{c}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {filteredRows.map((r, i) => {
                  const obj = (view === 'raw' ? r.raw : r.normalized) || {}
                  return (
                    <TR key={r.id}>
                      <TD className="text-slate-500">{i + 1}</TD>
                      <TD>
                        <Badge tone={rowTone(r.status)}>{r.status}</Badge>
                        {r.error && (
                          <div className="mt-1 max-w-xs text-xs text-rose-400">{r.error}</div>
                        )}
                      </TD>
                      {columns.map((c) => (
                        <TD key={c} className="whitespace-nowrap font-mono text-xs text-slate-300">
                          {fmtCell((obj as Record<string, unknown>)[c])}
                        </TD>
                      ))}
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={mapOpen}
        onClose={() => !savingMap && setMapOpen(false)}
        title={editingMap ? 'Edit mapping' : 'New mapping'}
        className="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMapOpen(false)} disabled={savingMap}>
              Cancel
            </Button>
            <Button onClick={saveMapping} disabled={savingMap}>
              {savingMap ? 'Saving…' : editingMap ? 'Save mapping' : 'Create mapping'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {mapError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {mapError}
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Mapping name
            </span>
            <input
              value={mapName}
              onChange={(e) => setMapName(e.target.value)}
              placeholder="Bank XYZ statement layout"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </label>
          <div>
            <p className="mb-2 text-xs text-slate-500">
              Map each canonical payment field to a source column from this batch.
            </p>
            <div className="space-y-2">
              {TARGET_FIELDS.map((t) => (
                <div key={t} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 font-mono text-xs text-teal-300">{t}</span>
                  <span className="text-slate-600">←</span>
                  {sourceColumns.length > 0 ? (
                    <select
                      value={fieldMap[t] ?? ''}
                      onChange={(e) => setFieldMap((prev) => ({ ...prev, [t]: e.target.value }))}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
                    >
                      <option value="">— Not mapped —</option>
                      {sourceColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={fieldMap[t] ?? ''}
                      onChange={(e) => setFieldMap((prev) => ({ ...prev, [t]: e.target.value }))}
                      placeholder="source column name"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
