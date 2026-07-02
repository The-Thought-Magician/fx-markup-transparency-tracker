'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
}

interface Provider {
  id: string
  name: string
  tier?: string
  home_currency?: string
}

const FORMATS = ['csv', 'json', 'mt940', 'camt053']

function statusTone(status: string): 'teal' | 'green' | 'amber' | 'rose' | 'slate' {
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

const SAMPLE_CSV = `reference,base_currency,quote_currency,notional_base,applied_rate,disclosed_fee_cents,value_date
INV-1001,USD,EUR,100000,0.9120,4500,2026-06-01
INV-1002,USD,GBP,50000,0.7830,4500,2026-06-03
INV-1003,USD,JPY,250000,151.20,6000,2026-06-05`

function parseDelimited(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim()
    })
    return row
  })
}

export default function ImportsPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [uploadOpen, setUploadOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [format, setFormat] = useState('csv')
  const [providerId, setProviderId] = useState('')
  const [rawText, setRawText] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
      const [batchRes, providerRes] = await Promise.all([
        api.getImports(resolvedOrg ?? undefined),
        api.getProviders(resolvedOrg ?? undefined),
      ])
      setBatches(Array.isArray(batchRes) ? batchRes : [])
      setProviders(Array.isArray(providerRes) ? providerRes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load import batches')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const providerName = useCallback(
    (id?: string | null) => providers.find((p) => p.id === id)?.name ?? '—',
    [providers],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return batches.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (q && !b.filename.toLowerCase().includes(q)) return false
      return true
    })
  }, [batches, search, statusFilter])

  const stats = useMemo(() => {
    const totalRows = batches.reduce((s, b) => s + (b.row_count || 0), 0)
    const totalErrors = batches.reduce((s, b) => s + (b.error_count || 0), 0)
    const committed = batches.filter((b) => b.status === 'committed').length
    return { totalRows, totalErrors, committed, count: batches.length }
  }, [batches])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    batches.forEach((b) => set.add(b.status))
    return Array.from(set).sort()
  }, [batches])

  function openUpload() {
    setFilename('')
    setFormat('csv')
    setProviderId(providers[0]?.id ?? '')
    setRawText('')
    setFormError(null)
    setUploadOpen(true)
  }

  function handleFile(file: File) {
    setFilename(file.name)
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.json')) setFormat('json')
    else if (lower.endsWith('.csv')) setFormat('csv')
    const reader = new FileReader()
    reader.onload = () => setRawText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  async function submitUpload() {
    setFormError(null)
    if (!filename.trim()) {
      setFormError('Filename is required')
      return
    }
    if (!rawText.trim()) {
      setFormError('Paste or upload file content first')
      return
    }
    let rows: unknown
    try {
      if (format === 'json') {
        const parsed = JSON.parse(rawText)
        rows = Array.isArray(parsed) ? parsed : parsed?.rows ?? [parsed]
      } else {
        rows = parseDelimited(rawText)
      }
    } catch (e) {
      setFormError(e instanceof Error ? `Parse error: ${e.message}` : 'Could not parse content')
      return
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      setFormError('No data rows detected in the content')
      return
    }
    setSubmitting(true)
    try {
      await api.createImport({
        org_id: orgId ?? undefined,
        provider_id: providerId || undefined,
        filename: filename.trim(),
        format,
        rows,
        raw: rawText,
      })
      setUploadOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create import batch')
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this import batch and its rows? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await api.deleteImport(id)
      setBatches((prev) => prev.filter((b) => b.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete batch')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Imports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Upload provider statements and payment exports, then map and commit them into tracked payments.
          </p>
        </div>
        <Button onClick={openUpload}>New import</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Batches" value={stats.count} />
        <Stat label="Rows imported" value={stats.totalRows.toLocaleString()} tone="teal" />
        <Stat label="Committed" value={stats.committed} tone="green" />
        <Stat
          label="Row errors"
          value={stats.totalErrors.toLocaleString()}
          tone={stats.totalErrors > 0 ? 'rose' : 'default'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Import batches</span>
            <Badge tone="slate">{filtered.length}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename…"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading import batches…" />
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
                title={batches.length === 0 ? 'No imports yet' : 'No batches match your filters'}
                description={
                  batches.length === 0
                    ? 'Upload a provider statement or payment export to begin reconciling FX costs.'
                    : 'Try clearing the search or status filter.'
                }
                action={
                  batches.length === 0 ? (
                    <Button onClick={openUpload}>New import</Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('')
                        setStatusFilter('all')
                      }}
                    >
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
                  <TH>Filename</TH>
                  <TH>Provider</TH>
                  <TH>Format</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Link
                        href={`/dashboard/imports/${b.id}`}
                        className="font-medium text-orange-300 hover:text-orange-200 hover:underline"
                      >
                        {b.filename}
                      </Link>
                    </TD>
                    <TD className="text-slate-400">{providerName(b.provider_id)}</TD>
                    <TD>
                      <span className="font-mono text-xs uppercase text-slate-400">{b.format}</span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{(b.row_count ?? 0).toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      {b.error_count > 0 ? (
                        <span className="text-rose-300">{b.error_count}</span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </TD>
                    <TD className="text-slate-400">
                      {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/imports/${b.id}`}>
                          <Button variant="secondary" className="px-3 py-1.5 text-xs">
                            Open
                          </Button>
                        </Link>
                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          disabled={deletingId === b.id}
                          onClick={() => remove(b.id)}
                        >
                          {deletingId === b.id ? '…' : 'Delete'}
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
        open={uploadOpen}
        onClose={() => !submitting && setUploadOpen(false)}
        title="New import batch"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitUpload} disabled={submitting}>
              {submitting ? 'Uploading…' : 'Create batch'}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Filename
              </span>
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="june-statement.csv"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Format
              </span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Provider (optional)
            </span>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">— Unassigned —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                File content ({format === 'json' ? 'JSON array' : 'CSV with header row'})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRawText(SAMPLE_CSV)
                    setFormat('csv')
                    if (!filename) setFilename('sample-statement.csv')
                  }}
                  className="text-xs text-orange-400 hover:text-orange-300"
                >
                  Load sample
                </button>
                <label className="cursor-pointer text-xs text-orange-400 hover:text-orange-300">
                  Choose file
                  <input
                    type="file"
                    accept=".csv,.json,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFile(f)
                    }}
                  />
                </label>
              </div>
            </div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              placeholder="Paste CSV or JSON content here, or upload a file."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">
              Rows are parsed client-side and sent to the backend for normalization. Review and commit on
              the batch detail page.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
