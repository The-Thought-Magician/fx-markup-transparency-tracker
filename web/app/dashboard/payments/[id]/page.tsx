'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? undefined : n
}
function fmtCents(cents?: number, currency?: string) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(cents / 100)
  return currency ? `${n} ${currency}` : `$${n}`
}
function fmtBps(bps?: number) {
  if (bps == null || Number.isNaN(bps)) return '—'
  return `${bps.toFixed(1)} bps`
}
function fmtRate(r?: number) {
  if (r == null || Number.isNaN(r)) return '—'
  return r.toFixed(6)
}

interface Markup {
  mid_rate?: number
  applied_rate?: number
  markup_bps?: number
  hidden_spread_cents?: number
  disclosed_fee_cents?: number
  wire_fee_cents?: number
  total_cost_cents?: number
  effective_cost_pct?: number
  [k: string]: unknown
}
interface WireFee {
  id: string
  kind?: string
  description?: string
  amount_cents?: number
  intermediary_bank?: string
  [k: string]: unknown
}
interface Reconciliation {
  id?: string
  expected_fee_cents?: number
  observed_fee_cents?: number
  variance_cents?: number
  status?: string
  notes?: string
  [k: string]: unknown
}
interface Note {
  id: string
  body?: string
  created_at?: string
  [k: string]: unknown
}
interface Payment {
  id: string
  reference?: string
  org_id?: string
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
  wire_fees?: WireFee[]
  reconciliation?: Reconciliation | null
  [k: string]: unknown
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none'

function reconTone(s?: string): 'green' | 'rose' | 'amber' | 'slate' {
  switch ((s || '').toLowerCase()) {
    case 'matched':
    case 'clean':
      return 'green'
    case 'over':
    case 'overcharged':
    case 'mismatch':
      return 'rose'
    case 'under':
    case 'review':
      return 'amber'
    default:
      return 'slate'
  }
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string
  const router = useRouter()

  const [payment, setPayment] = useState<Payment | null>(null)
  const [markup, setMarkup] = useState<Markup | null>(null)
  const [wireFees, setWireFees] = useState<WireFee[]>([])
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decomposing, setDecomposing] = useState(false)

  // wire fee form
  const [feeForm, setFeeForm] = useState({ kind: 'wire', description: '', amount_cents: '', intermediary_bank: '' })
  const [feeSaving, setFeeSaving] = useState(false)
  const [feeError, setFeeError] = useState<string | null>(null)

  // note form
  const [noteBody, setNoteBody] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  async function refreshDerived() {
    const [fees, rec, nts] = await Promise.all([
      api.getWireFees(id),
      api.getReconciliation(id).catch(() => null),
      api.getNotes('payment', id).catch(() => []),
    ])
    setWireFees(Array.isArray(fees) ? fees : (fees?.wire_fees ?? []))
    setRecon(rec && typeof rec === 'object' ? rec : null)
    setNotes(Array.isArray(nts) ? nts : (nts?.notes ?? []))
  }

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const p: Payment = await api.getPayment(id)
        const [fees, rec, nts] = await Promise.all([
          api.getWireFees(id),
          api.getReconciliation(id).catch(() => null),
          api.getNotes('payment', id).catch(() => []),
        ])
        if (!active) return
        setPayment(p)
        setMarkup(p?.markup ?? null)
        setWireFees(Array.isArray(fees) ? fees : (fees?.wire_fees ?? p?.wire_fees ?? []))
        setRecon(rec && typeof rec === 'object' ? rec : (p?.reconciliation ?? null))
        setNotes(Array.isArray(nts) ? nts : (nts?.notes ?? []))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load payment')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id])

  async function onDecompose() {
    setDecomposing(true)
    setError(null)
    try {
      const m: Markup = await api.decomposePayment(id)
      setMarkup(m && typeof m === 'object' ? m : null)
      // reconciliation depends on fees/markup; refresh it
      const rec = await api.getReconciliation(id).catch(() => null)
      setRecon(rec && typeof rec === 'object' ? rec : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to recompute decomposition')
    } finally {
      setDecomposing(false)
    }
  }

  async function onAddFee(e: React.FormEvent) {
    e.preventDefault()
    setFeeError(null)
    const amount = num(feeForm.amount_cents)
    if (amount == null) {
      setFeeError('Amount (cents) must be numeric.')
      return
    }
    setFeeSaving(true)
    try {
      await api.createWireFee({
        payment_id: id,
        kind: feeForm.kind || 'wire',
        description: feeForm.description || undefined,
        amount_cents: amount,
        intermediary_bank: feeForm.intermediary_bank || undefined,
      })
      setFeeForm({ kind: 'wire', description: '', amount_cents: '', intermediary_bank: '' })
      await api.getWireFees(id).then((fees) =>
        setWireFees(Array.isArray(fees) ? fees : (fees?.wire_fees ?? [])),
      )
      // fees change the markup decomposition; recompute
      await onDecompose()
    } catch (e) {
      setFeeError(e instanceof Error ? e.message : 'Failed to add fee')
    } finally {
      setFeeSaving(false)
    }
  }

  async function onDeleteFee(feeId: string) {
    try {
      await api.deleteWireFee(feeId)
      setWireFees((prev) => prev.filter((f) => f.id !== feeId))
      await onDecompose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete fee')
    }
  }

  async function onAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteBody.trim()) return
    setNoteSaving(true)
    try {
      await api.createNote({
        org_id: payment?.org_id,
        entity_type: 'payment',
        entity_id: id,
        body: noteBody.trim(),
      })
      setNoteBody('')
      await api.getNotes('payment', id).then((nts) => setNotes(Array.isArray(nts) ? nts : (nts?.notes ?? [])))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add note')
    } finally {
      setNoteSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading payment..." />
      </div>
    )
  }

  if (error && !payment) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-500/30">
          <CardBody>
            <h2 className="text-base font-semibold text-rose-300">Could not load payment</h2>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
            <Link href="/dashboard/payments" className="mt-3 inline-block text-sm text-teal-400 hover:underline">
              ← Back to payments
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!payment) return null

  const ccy = payment.base_currency
  const m = markup
  const feeTotal = wireFees.reduce((acc, f) => acc + (num(f.amount_cents) ?? 0), 0)

  // decomposition segments for the stacked bar
  const segs = [
    { label: 'Hidden spread', value: num(m?.hidden_spread_cents) ?? 0, color: 'bg-rose-500' },
    { label: 'Disclosed fee', value: num(m?.disclosed_fee_cents) ?? num(payment.disclosed_fee_cents) ?? 0, color: 'bg-amber-500' },
    { label: 'Wire / lifting fees', value: num(m?.wire_fee_cents) ?? feeTotal, color: 'bg-sky-500' },
  ]
  const totalCost = num(m?.total_cost_cents) ?? segs.reduce((a, s) => a + s.value, 0)
  const variance = num(recon?.variance_cents)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/payments" className="text-xs text-teal-400 hover:underline">
            ← Payments
          </Link>
          <h1 className="mt-1 text-xl font-bold text-white">{payment.reference || `Payment ${id.slice(0, 8)}`}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {payment.base_currency && payment.quote_currency && (
              <span>
                {payment.base_currency}/{payment.quote_currency}
              </span>
            )}
            {payment.value_date && <span>· value {new Date(payment.value_date).toLocaleDateString()}</span>}
            {payment.status && <Badge tone="slate">{payment.status}</Badge>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDecompose} disabled={decomposing}>
            {decomposing ? 'Recomputing...' : 'Recompute decomposition'}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('Delete this payment?')) return
              try {
                await api.deletePayment(id)
                router.push('/dashboard/payments')
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Failed to delete')
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody>
            <p className="text-sm text-rose-300">{error}</p>
          </CardBody>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Markup" value={fmtBps(num(m?.markup_bps))} tone="rose" hint="vs benchmark mid" />
        <Stat label="Total hidden cost" value={fmtCents(totalCost, ccy)} tone="amber" />
        <Stat
          label="Effective cost"
          value={m?.effective_cost_pct != null ? `${(num(m.effective_cost_pct) as number).toFixed(3)}%` : '—'}
          tone="teal"
          hint="of notional"
        />
        <Stat
          label="Notional"
          value={
            num(payment.notional_base) != null
              ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
                  num(payment.notional_base) as number,
                )
              : '—'
          }
          hint={ccy}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Decomposition */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Cost decomposition</h2>
            <p className="text-xs text-slate-500">Where the money actually went</p>
          </CardHeader>
          <CardBody className="space-y-5">
            {!m ? (
              <EmptyState
                title="Not decomposed yet"
                description="Run the decomposition to break this payment into hidden spread, disclosed fees, and wire charges."
                action={
                  <Button onClick={onDecompose} disabled={decomposing}>
                    {decomposing ? 'Recomputing...' : 'Decompose now'}
                  </Button>
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  <KV label="Benchmark mid" value={fmtRate(num(m.mid_rate))} />
                  <KV label="Applied rate" value={fmtRate(num(m.applied_rate) ?? num(payment.applied_rate))} />
                  <KV label="Markup" value={fmtBps(num(m.markup_bps))} tone="rose" />
                </div>

                {/* stacked bar */}
                {totalCost > 0 && (
                  <div>
                    <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
                      {segs.map(
                        (s) =>
                          s.value > 0 && (
                            <div
                              key={s.label}
                              className={s.color}
                              style={{ width: `${(s.value / totalCost) * 100}%` }}
                              title={`${s.label}: ${fmtCents(s.value, ccy)}`}
                            />
                          ),
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4">
                      {segs.map((s) => (
                        <div key={s.label} className="flex items-center gap-2 text-xs">
                          <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
                          <span className="text-slate-400">{s.label}</span>
                          <span className="font-semibold tabular-nums text-slate-200">
                            {fmtCents(s.value, ccy)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Table>
                  <TBody>
                    <Row label="Hidden spread" value={fmtCents(num(m.hidden_spread_cents), ccy)} tone="rose" />
                    <Row
                      label="Disclosed fee"
                      value={fmtCents(num(m.disclosed_fee_cents) ?? num(payment.disclosed_fee_cents), ccy)}
                    />
                    <Row label="Wire / lifting fees" value={fmtCents(num(m.wire_fee_cents) ?? feeTotal, ccy)} />
                    <Row label="Total cost" value={fmtCents(totalCost, ccy)} strong />
                  </TBody>
                </Table>
              </>
            )}
          </CardBody>
        </Card>

        {/* Reconciliation */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Reconciliation</h2>
            <p className="text-xs text-slate-500">Expected vs observed fees</p>
          </CardHeader>
          <CardBody>
            {!recon ? (
              <EmptyState
                title="No reconciliation"
                description="Run reconciliation from the Reconciliation page to compare against the provider fee schedule."
              />
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Status</span>
                  <Badge tone={reconTone(recon.status)}>{recon.status || 'unknown'}</Badge>
                </div>
                <KVrow label="Expected fee" value={fmtCents(num(recon.expected_fee_cents), ccy)} />
                <KVrow label="Observed fee" value={fmtCents(num(recon.observed_fee_cents), ccy)} />
                <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                  <span className="text-slate-400">Variance</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      variance == null ? 'text-slate-300' : variance > 0 ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    {fmtCents(variance, ccy)}
                  </span>
                </div>
                {recon.notes && <p className="rounded-lg bg-slate-950/50 p-2 text-xs text-slate-400">{recon.notes}</p>}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Wire fees */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Wire & lifting fees</h2>
            <p className="text-xs text-slate-500">Line items including intermediary bank charges</p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-slate-300">{fmtCents(feeTotal, ccy)}</span>
        </CardHeader>
        <CardBody className="space-y-4">
          {wireFees.length === 0 ? (
            <p className="text-sm text-slate-500">No wire or lifting fees recorded for this payment yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Kind</TH>
                  <TH>Description</TH>
                  <TH>Intermediary bank</TH>
                  <TH className="text-right">Amount</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {wireFees.map((f) => (
                  <TR key={f.id}>
                    <TD>
                      <Badge tone="blue">{f.kind || 'wire'}</Badge>
                    </TD>
                    <TD className="text-slate-300">{f.description || '—'}</TD>
                    <TD className="text-slate-400">{f.intermediary_bank || '—'}</TD>
                    <TD className="text-right tabular-nums">{fmtCents(num(f.amount_cents), ccy)}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        onClick={() => onDeleteFee(f.id)}
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <form onSubmit={onAddFee} className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-5">
            <select
              value={feeForm.kind}
              onChange={(e) => setFeeForm({ ...feeForm, kind: e.target.value })}
              className={inputCls}
            >
              <option value="wire">wire</option>
              <option value="lifting">lifting</option>
              <option value="intermediary">intermediary</option>
              <option value="other">other</option>
            </select>
            <input
              value={feeForm.description}
              onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })}
              placeholder="Description"
              className={inputCls}
            />
            <input
              value={feeForm.intermediary_bank}
              onChange={(e) => setFeeForm({ ...feeForm, intermediary_bank: e.target.value })}
              placeholder="Intermediary bank"
              className={inputCls}
            />
            <input
              value={feeForm.amount_cents}
              onChange={(e) => setFeeForm({ ...feeForm, amount_cents: e.target.value })}
              placeholder="Amount (cents)"
              inputMode="numeric"
              className={inputCls}
            />
            <Button type="submit" disabled={feeSaving}>
              {feeSaving ? 'Adding...' : 'Add fee'}
            </Button>
          </form>
          {feeError && <p className="text-sm text-rose-300">{feeError}</p>}
        </CardBody>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Notes</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <form onSubmit={onAddNote} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add a note about this payment..."
              className={inputCls}
            />
            <Button type="submit" disabled={noteSaving || !noteBody.trim()}>
              {noteSaving ? 'Saving...' : 'Add note'}
            </Button>
          </form>
          {notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                  <p className="text-sm text-slate-200">{n.body}</p>
                  <div className="mt-1 flex items-center justify-between">
                    {n.created_at && (
                      <span className="text-[11px] text-slate-500">{new Date(n.created_at).toLocaleString()}</span>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await api.deleteNote(n.id)
                          setNotes((prev) => prev.filter((x) => x.id !== n.id))
                        } catch (e) {
                          alert(e instanceof Error ? e.message : 'Failed to delete note')
                        }
                      }}
                      className="text-[11px] text-rose-400 hover:underline"
                    >
                      delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function KV({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'rose' }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${tone === 'rose' ? 'text-rose-300' : 'text-slate-200'}`}>
        {value}
      </div>
    </div>
  )
}

function KVrow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium tabular-nums text-slate-200">{value}</span>
    </div>
  )
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: React.ReactNode
  tone?: 'rose'
  strong?: boolean
}) {
  return (
    <TR>
      <TD className={strong ? 'font-semibold text-white' : 'text-slate-400'}>{label}</TD>
      <TD
        className={`text-right tabular-nums ${
          strong ? 'font-bold text-white' : tone === 'rose' ? 'text-rose-300' : 'text-slate-200'
        }`}
      >
        {value}
      </TD>
    </TR>
  )
}
