'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

interface Org {
  id: string
  base_currency?: string
}
interface Provider {
  id: string
  name?: string
}
interface Corridor {
  id: string
  label?: string
  base_currency?: string
  quote_currency?: string
}
interface Markup {
  markup_bps?: number
  total_cost_cents?: number
  hidden_spread_cents?: number
  effective_cost_pct?: number
  [k: string]: unknown
}
interface Payment {
  id: string
  reference?: string
  provider_id?: string
  corridor_id?: string
  base_currency?: string
  quote_currency?: string
  notional_base?: number
  applied_rate?: number
  disclosed_fee_cents?: number
  value_date?: string
  status?: string
  markup?: Markup | null
  markup_bps?: number
  total_cost_cents?: number
  created_at?: string
  [k: string]: unknown
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? undefined : n
}

function fmtCents(cents?: number, currency?: string) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const num2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(cents / 100)
  return currency ? `${num2} ${currency}` : `$${num2}`
}
function fmtBps(bps?: number) {
  if (bps == null || Number.isNaN(bps)) return '—'
  return `${bps.toFixed(1)}`
}
function markupOf(p: Payment): number | undefined {
  return num(p.markup?.markup_bps) ?? num(p.markup_bps)
}
function costOf(p: Payment): number | undefined {
  return num(p.markup?.total_cost_cents) ?? num(p.total_cost_cents)
}
function markupTone(bps?: number): 'rose' | 'amber' | 'teal' | 'slate' {
  if (bps == null) return 'slate'
  if (bps >= 100) return 'rose'
  if (bps >= 50) return 'amber'
  return 'teal'
}
function statusTone(s?: string): 'green' | 'amber' | 'slate' {
  switch ((s || '').toLowerCase()) {
    case 'settled':
    case 'completed':
      return 'green'
    case 'pending':
    case 'processing':
      return 'amber'
    default:
      return 'slate'
  }
}

const emptyForm = {
  reference: '',
  provider_id: '',
  corridor_id: '',
  base_currency: '',
  quote_currency: '',
  notional_base: '',
  applied_rate: '',
  disclosed_fee_cents: '',
  value_date: '',
  status: 'settled',
}

export default function PaymentsPage() {
  const [org, setOrg] = useState<Org | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [corridors, setCorridors] = useState<Corridor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterCorridor, setFilterCorridor] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const providerName = useMemo(() => {
    const m = new Map<string, string>()
    providers.forEach((p) => m.set(p.id, p.name || p.id))
    return m
  }, [providers])
  const corridorLabel = useMemo(() => {
    const m = new Map<string, string>()
    corridors.forEach((c) =>
      m.set(c.id, c.label || (c.base_currency && c.quote_currency ? `${c.base_currency}/${c.quote_currency}` : c.id)),
    )
    return m
  }, [corridors])

  async function loadPayments(orgId?: string) {
    const query: Record<string, string | undefined> = { org_id: orgId }
    if (filterProvider) query.provider_id = filterProvider
    if (filterCorridor) query.corridor_id = filterCorridor
    const list = await api.getPayments(query)
    setPayments(Array.isArray(list) ? list : (list?.payments ?? []))
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const o: Org = await api.getCurrentOrg()
        const orgId = o?.id
        const [provs, corrs] = await Promise.all([api.getProviders(orgId), api.getCorridors(orgId)])
        if (!active) return
        setOrg(o)
        setProviders(Array.isArray(provs) ? provs : (provs?.providers ?? []))
        setCorridors(Array.isArray(corrs) ? corrs : (corrs?.corridors ?? []))
        await loadPayments(orgId)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load payments')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fetch payments when server-side filters change (after initial load).
  useEffect(() => {
    if (!org) return
    let active = true
    ;(async () => {
      try {
        await loadPayments(org.id)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to filter payments')
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProvider, filterCorridor])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return payments
    return payments.filter((p) => {
      const hay = [
        p.reference,
        providerName.get(p.provider_id || ''),
        corridorLabel.get(p.corridor_id || ''),
        p.base_currency,
        p.quote_currency,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [payments, search, providerName, corridorLabel])

  const onCorridorPick = (id: string) => {
    const c = corridors.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      corridor_id: id,
      base_currency: c?.base_currency || f.base_currency,
      quote_currency: c?.quote_currency || f.quote_currency,
    }))
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.provider_id || !form.corridor_id) {
      setFormError('Provider and corridor are required.')
      return
    }
    if (!num(form.notional_base) || !num(form.applied_rate)) {
      setFormError('Notional and applied rate must be numeric and non-zero.')
      return
    }
    setSaving(true)
    try {
      const body = {
        org_id: org?.id,
        reference: form.reference || undefined,
        provider_id: form.provider_id,
        corridor_id: form.corridor_id,
        base_currency: form.base_currency || undefined,
        quote_currency: form.quote_currency || undefined,
        notional_base: num(form.notional_base),
        applied_rate: num(form.applied_rate),
        disclosed_fee_cents: num(form.disclosed_fee_cents) ?? 0,
        value_date: form.value_date || undefined,
        status: form.status || undefined,
      }
      await api.createPayment(body)
      setCreateOpen(false)
      setForm({ ...emptyForm })
      await loadPayments(org?.id)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create payment')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this payment and its decomposition?')) return
    setDeletingId(id)
    try {
      await api.deletePayment(id)
      setPayments((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete payment')
    } finally {
      setDeletingId(null)
    }
  }

  const ccy = org?.base_currency
  const totalLeak = filtered.reduce((acc, p) => acc + (costOf(p) ?? 0), 0)
  const avgMarkup =
    (() => {
      const vals = filtered.map(markupOf).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined
    })()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading payments..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered.length} of {payments.length} payments · avg markup {fmtBps(avgMarkup)} bps · total cost{' '}
            {fmtCents(totalLeak, ccy)}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Record payment</Button>
      </div>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody>
            <p className="text-sm text-rose-300">{error}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, provider, corridor..."
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
          />
          <select
            value={filterProvider}
            onChange={(e) => setFilterProvider(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
          <select
            value={filterCorridor}
            onChange={(e) => setFilterCorridor(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            <option value="">All corridors</option>
            {corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {corridorLabel.get(c.id)}
              </option>
            ))}
          </select>
          {(filterProvider || filterCorridor || search) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('')
                setFilterProvider('')
                setFilterCorridor('')
              }}
            >
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              title={payments.length === 0 ? 'No payments yet' : 'No payments match your filters'}
              description={
                payments.length === 0
                  ? 'Record a cross-border payment to decompose its hidden FX markup.'
                  : 'Try clearing the search or filters.'
              }
              action={
                payments.length === 0 ? (
                  <Button onClick={() => setCreateOpen(true)}>Record payment</Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Provider</TH>
                <TH>Corridor</TH>
                <TH className="text-right">Notional</TH>
                <TH className="text-right">Applied rate</TH>
                <TH className="text-right">Markup (bps)</TH>
                <TH className="text-right">Total cost</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((p) => {
                const mk = markupOf(p)
                return (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/dashboard/payments/${p.id}`}
                        className="font-medium text-teal-300 hover:underline"
                      >
                        {p.reference || p.id.slice(0, 8)}
                      </Link>
                      {p.value_date && (
                        <div className="text-[11px] text-slate-500">
                          {new Date(p.value_date).toLocaleDateString()}
                        </div>
                      )}
                    </TD>
                    <TD className="text-slate-300">{providerName.get(p.provider_id || '') || '—'}</TD>
                    <TD className="text-slate-300">
                      {corridorLabel.get(p.corridor_id || '') ||
                        (p.base_currency && p.quote_currency
                          ? `${p.base_currency}/${p.quote_currency}`
                          : '—')}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {num(p.notional_base) != null
                        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
                            num(p.notional_base) as number,
                          )
                        : '—'}{' '}
                      <span className="text-xs text-slate-500">{p.base_currency || ''}</span>
                    </TD>
                    <TD className="text-right tabular-nums text-slate-300">
                      {num(p.applied_rate) != null ? (num(p.applied_rate) as number).toFixed(4) : '—'}
                    </TD>
                    <TD className="text-right">
                      {mk != null ? <Badge tone={markupTone(mk)}>{fmtBps(mk)}</Badge> : '—'}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-200">{fmtCents(costOf(p), ccy)}</TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>{p.status || 'unknown'}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/dashboard/payments/${p.id}`}>
                          <Button variant="ghost" className="px-2 py-1 text-xs">
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                          disabled={deletingId === p.id}
                          onClick={() => onDelete(p.id)}
                        >
                          {deletingId === p.id ? '…' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => (saving ? null : setCreateOpen(false))}
        title="Record payment"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-payment-form" disabled={saving}>
              {saving ? 'Saving...' : 'Create & decompose'}
            </Button>
          </div>
        }
      >
        <form id="create-payment-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reference">
              <input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="INV-2026-001"
                className={inputCls}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={inputCls}
              >
                <option value="settled">settled</option>
                <option value="pending">pending</option>
                <option value="processing">processing</option>
              </select>
            </Field>
            <Field label="Provider *">
              <select
                value={form.provider_id}
                onChange={(e) => setForm({ ...form, provider_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Select provider</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Corridor *">
              <select
                value={form.corridor_id}
                onChange={(e) => onCorridorPick(e.target.value)}
                className={inputCls}
              >
                <option value="">Select corridor</option>
                {corridors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {corridorLabel.get(c.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Base currency">
              <input
                value={form.base_currency}
                onChange={(e) => setForm({ ...form, base_currency: e.target.value.toUpperCase() })}
                placeholder="USD"
                className={inputCls}
              />
            </Field>
            <Field label="Quote currency">
              <input
                value={form.quote_currency}
                onChange={(e) => setForm({ ...form, quote_currency: e.target.value.toUpperCase() })}
                placeholder="EUR"
                className={inputCls}
              />
            </Field>
            <Field label="Notional (base) *">
              <input
                value={form.notional_base}
                onChange={(e) => setForm({ ...form, notional_base: e.target.value })}
                placeholder="100000"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Applied rate *">
              <input
                value={form.applied_rate}
                onChange={(e) => setForm({ ...form, applied_rate: e.target.value })}
                placeholder="0.9125"
                inputMode="decimal"
                className={inputCls}
              />
            </Field>
            <Field label="Disclosed fee (cents)">
              <input
                value={form.disclosed_fee_cents}
                onChange={(e) => setForm({ ...form, disclosed_fee_cents: e.target.value })}
                placeholder="2500"
                inputMode="numeric"
                className={inputCls}
              />
            </Field>
            <Field label="Value date">
              <input
                type="date"
                value={form.value_date}
                onChange={(e) => setForm({ ...form, value_date: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            The nearest benchmark mid-rate is attached automatically and the markup decomposition is computed on
            create.
          </p>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
