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

interface RateSource {
  id: string
  org_id: string
  name: string
  kind: string
  confidence: number
  created_at: string
}

interface BenchmarkRate {
  id: string
  org_id: string
  source_id: string | null
  base_currency: string
  quote_currency: string
  mid_rate: number
  captured_at: string
  created_at: string
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'SGD', 'HKD', 'INR', 'MXN', 'BRL', 'CNY', 'SEK', 'NOK']
const SOURCE_KINDS = ['central_bank', 'market_data', 'aggregator', 'internal', 'reference']

function nowLocalInput() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

function fmtTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function confidenceTone(c: number): 'green' | 'amber' | 'rose' {
  if (c >= 0.8) return 'green'
  if (c >= 0.5) return 'amber'
  return 'rose'
}

export default function BenchmarksPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [benchmarks, setBenchmarks] = useState<BenchmarkRate[]>([])
  const [sources, setSources] = useState<RateSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // filters
  const [filterBase, setFilterBase] = useState('')
  const [filterQuote, setFilterQuote] = useState('')
  const [search, setSearch] = useState('')

  // capture form
  const [showCapture, setShowCapture] = useState(false)
  const [capBase, setCapBase] = useState('USD')
  const [capQuote, setCapQuote] = useState('EUR')
  const [capRate, setCapRate] = useState('')
  const [capSource, setCapSource] = useState('')
  const [capAt, setCapAt] = useState(nowLocalInput())

  // lookup
  const [lkBase, setLkBase] = useState('USD')
  const [lkQuote, setLkQuote] = useState('EUR')
  const [lkAt, setLkAt] = useState(nowLocalInput())
  const [lkResult, setLkResult] = useState<BenchmarkRate | null>(null)
  const [lkError, setLkError] = useState<string | null>(null)
  const [lkBusy, setLkBusy] = useState(false)

  // backfill
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)

  // source editing
  const [showSource, setShowSource] = useState(false)
  const [editSource, setEditSource] = useState<RateSource | null>(null)
  const [srcName, setSrcName] = useState('')
  const [srcKind, setSrcKind] = useState(SOURCE_KINDS[0])
  const [srcConfidence, setSrcConfidence] = useState('0.9')

  const sourceName = useCallback(
    (id: string | null) => (id ? sources.find((s) => s.id === id)?.name ?? 'Unknown' : 'Unassigned'),
    [sources],
  )

  const loadBenchmarks = useCallback(async () => {
    const rows = await api.getBenchmarks(filterBase || undefined, filterQuote || undefined, orgId ?? undefined)
    setBenchmarks(Array.isArray(rows) ? rows : [])
  }, [filterBase, filterQuote, orgId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const org = await api.getCurrentOrg().catch(() => null)
      const resolvedOrg = org?.id ?? null
      setOrgId(resolvedOrg)
      const [srcs] = await Promise.all([
        api.getRateSources(resolvedOrg ?? undefined).catch(() => []),
        loadBenchmarks(),
      ])
      setSources(Array.isArray(srcs) ? srcs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load benchmarks')
    } finally {
      setLoading(false)
    }
  }, [loadBenchmarks])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // re-run benchmark fetch on filter change after initial load
  useEffect(() => {
    if (loading) return
    loadBenchmarks().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load rates'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBase, filterQuote])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return benchmarks
    return benchmarks.filter((b) =>
      `${b.base_currency}/${b.quote_currency} ${sourceName(b.source_id)}`.toLowerCase().includes(q),
    )
  }, [benchmarks, search, sourceName])

  const pairCount = useMemo(() => new Set(benchmarks.map((b) => `${b.base_currency}/${b.quote_currency}`)).size, [benchmarks])
  const latestCapture = useMemo(() => {
    if (benchmarks.length === 0) return null
    return benchmarks.reduce((acc, b) => (b.captured_at > acc ? b.captured_at : acc), benchmarks[0].captured_at)
  }, [benchmarks])

  async function submitCapture(e: React.FormEvent) {
    e.preventDefault()
    const rate = Number(capRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      setError('Enter a valid positive mid rate')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createBenchmark({
        org_id: orgId,
        source_id: capSource || null,
        base_currency: capBase,
        quote_currency: capQuote,
        mid_rate: rate,
        captured_at: new Date(capAt).toISOString(),
      })
      setShowCapture(false)
      setCapRate('')
      setCapAt(nowLocalInput())
      await loadBenchmarks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to capture rate')
    } finally {
      setBusy(false)
    }
  }

  async function removeBenchmark(id: string) {
    if (!confirm('Delete this benchmark rate?')) return
    setBusy(true)
    try {
      await api.deleteBenchmark(id)
      await loadBenchmarks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rate')
    } finally {
      setBusy(false)
    }
  }

  async function runLookup(e: React.FormEvent) {
    e.preventDefault()
    setLkBusy(true)
    setLkError(null)
    setLkResult(null)
    try {
      const res = await api.lookupBenchmark(lkBase, lkQuote, new Date(lkAt).toISOString(), orgId ?? undefined)
      if (res && res.id) setLkResult(res)
      else setLkError('No benchmark found for that pair near that time')
    } catch (e) {
      setLkError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLkBusy(false)
    }
  }

  async function runBackfill() {
    setBusy(true)
    setBackfillMsg(null)
    setError(null)
    try {
      const res = await api.backfillBenchmarks({ org_id: orgId })
      const updated = typeof res?.updated === 'number' ? res.updated : 0
      setBackfillMsg(`Attached nearest benchmark to ${updated} payment${updated === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backfill failed')
    } finally {
      setBusy(false)
    }
  }

  function openNewSource() {
    setEditSource(null)
    setSrcName('')
    setSrcKind(SOURCE_KINDS[0])
    setSrcConfidence('0.9')
    setShowSource(true)
  }

  function openEditSource(s: RateSource) {
    setEditSource(s)
    setSrcName(s.name)
    setSrcKind(s.kind)
    setSrcConfidence(String(s.confidence))
    setShowSource(true)
  }

  async function submitSource(e: React.FormEvent) {
    e.preventDefault()
    if (!srcName.trim()) {
      setError('Source name is required')
      return
    }
    const conf = Number(srcConfidence)
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      setError('Confidence must be between 0 and 1')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editSource) {
        await api.updateRateSource(editSource.id, { name: srcName.trim(), kind: srcKind, confidence: conf })
      } else {
        await api.createRateSource({ org_id: orgId, name: srcName.trim(), kind: srcKind, confidence: conf })
      }
      setShowSource(false)
      const srcs = await api.getRateSources(orgId ?? undefined)
      setSources(Array.isArray(srcs) ? srcs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save source')
    } finally {
      setBusy(false)
    }
  }

  async function removeSource(id: string) {
    if (!confirm('Delete this rate source?')) return
    setBusy(true)
    try {
      await api.deleteRateSource(id)
      const srcs = await api.getRateSources(orgId ?? undefined)
      setSources(Array.isArray(srcs) ? srcs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete source')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading benchmark rates..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Benchmark Rates</h1>
          <p className="mt-1 text-sm text-slate-400">
            Capture mid-market reference rates so every payment can be priced against an objective benchmark.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={runBackfill} disabled={busy}>
            Backfill payments
          </Button>
          <Button onClick={() => setShowCapture(true)}>Capture rate</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {backfillMsg && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">
          {backfillMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total rates" value={benchmarks.length} tone="teal" />
        <Stat label="Distinct pairs" value={pairCount} />
        <Stat label="Rate sources" value={sources.length} />
        <Stat label="Latest capture" value={<span className="text-base">{fmtTime(latestCapture || undefined)}</span>} />
      </div>

      {/* Point-in-time lookup */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Point-in-time lookup</h2>
          <p className="mt-0.5 text-xs text-slate-500">Find the nearest captured mid-rate for a pair at a moment in time.</p>
        </CardHeader>
        <CardBody>
          <form onSubmit={runLookup} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Base
              <select
                value={lkBase}
                onChange={(e) => setLkBase(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Quote
              <select
                value={lkQuote}
                onChange={(e) => setLkQuote(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              At
              <input
                type="datetime-local"
                value={lkAt}
                onChange={(e) => setLkAt(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <Button type="submit" disabled={lkBusy}>
              {lkBusy ? 'Looking up...' : 'Lookup'}
            </Button>
            {lkResult && (
              <div className="flex items-center gap-3 rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-sm">
                <span className="font-semibold text-teal-300">
                  {lkResult.base_currency}/{lkResult.quote_currency} = {lkResult.mid_rate}
                </span>
                <span className="text-slate-400">@ {fmtTime(lkResult.captured_at)}</span>
                <Badge tone="slate">{sourceName(lkResult.source_id)}</Badge>
              </div>
            )}
            {lkError && <span className="text-sm text-rose-300">{lkError}</span>}
          </form>
        </CardBody>
      </Card>

      {/* Rate sources */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Rate sources</h2>
            <p className="mt-0.5 text-xs text-slate-500">Provenance and confidence for the benchmarks you capture.</p>
          </div>
          <Button variant="secondary" onClick={openNewSource}>Add source</Button>
        </CardHeader>
        <CardBody>
          {sources.length === 0 ? (
            <EmptyState
              title="No rate sources yet"
              description="Add a central-bank feed, market data vendor, or internal reference so captured rates carry provenance."
              action={<Button variant="secondary" onClick={openNewSource}>Add source</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Kind</TH>
                  <TH>Confidence</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sources.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-white">{s.name}</TD>
                    <TD><Badge tone="slate">{s.kind}</Badge></TD>
                    <TD>
                      <Badge tone={confidenceTone(s.confidence)}>{Math.round(s.confidence * 100)}%</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openEditSource(s)}>Edit</Button>
                        <Button variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => removeSource(s.id)}>
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

      {/* Benchmark table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-white">Captured rates</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterBase}
              onChange={(e) => setFilterBase(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
            >
              <option value="">All base</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={filterQuote}
              onChange={(e) => setFilterQuote(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
            >
              <option value="">All quote</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              placeholder="Search pair / source"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={benchmarks.length === 0 ? 'No benchmark rates captured' : 'No rates match your filters'}
              description={
                benchmarks.length === 0
                  ? 'Capture a mid-market rate to start pricing payments against an objective benchmark.'
                  : 'Try clearing the base/quote filters or search term.'
              }
              action={
                benchmarks.length === 0 ? (
                  <Button onClick={() => setShowCapture(true)}>Capture rate</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Pair</TH>
                  <TH>Mid rate</TH>
                  <TH>Source</TH>
                  <TH>Captured</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <span className="font-semibold text-white">{b.base_currency}/{b.quote_currency}</span>
                    </TD>
                    <TD className="tabular-nums text-teal-300">{b.mid_rate}</TD>
                    <TD><Badge tone="slate">{sourceName(b.source_id)}</Badge></TD>
                    <TD className="text-slate-400">{fmtTime(b.captured_at)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => removeBenchmark(b.id)}>
                        Delete
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Capture modal */}
      <Modal
        open={showCapture}
        onClose={() => setShowCapture(false)}
        title="Capture benchmark rate"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCapture(false)}>Cancel</Button>
            <Button type="submit" form="capture-form" disabled={busy}>
              {busy ? 'Saving...' : 'Capture'}
            </Button>
          </div>
        }
      >
        <form id="capture-form" onSubmit={submitCapture} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Base currency
              <select
                value={capBase}
                onChange={(e) => setCapBase(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Quote currency
              <select
                value={capQuote}
                onChange={(e) => setCapQuote(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Mid rate
            <input
              type="number"
              step="any"
              min="0"
              value={capRate}
              onChange={(e) => setCapRate(e.target.value)}
              placeholder="e.g. 0.9234"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Rate source
            <select
              value={capSource}
              onChange={(e) => setCapSource(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Unassigned</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Captured at
            <input
              type="datetime-local"
              value={capAt}
              onChange={(e) => setCapAt(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              required
            />
          </label>
        </form>
      </Modal>

      {/* Source modal */}
      <Modal
        open={showSource}
        onClose={() => setShowSource(false)}
        title={editSource ? 'Edit rate source' : 'Add rate source'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowSource(false)}>Cancel</Button>
            <Button type="submit" form="source-form" disabled={busy}>
              {busy ? 'Saving...' : editSource ? 'Save' : 'Add'}
            </Button>
          </div>
        }
      >
        <form id="source-form" onSubmit={submitSource} className="space-y-4">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Name
            <input
              value={srcName}
              onChange={(e) => setSrcName(e.target.value)}
              placeholder="e.g. ECB reference, Reuters mid"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Kind
            <select
              value={srcKind}
              onChange={(e) => setSrcKind(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Confidence (0–1)
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={srcConfidence}
              onChange={(e) => setSrcConfidence(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}
