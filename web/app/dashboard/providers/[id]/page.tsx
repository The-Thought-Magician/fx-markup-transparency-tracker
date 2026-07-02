'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface FeeSchedule {
  id: string
  provider_id: string
  wire_fee_cents?: number | null
  stated_fx_fee_pct?: number | null
  lifting_charge_cents?: number | null
  lifting_policy?: string | null
  effective_date?: string | null
  is_current?: boolean | null
  created_at?: string | null
}

interface Provider {
  id: string
  org_id: string
  name: string
  tier?: string | null
  home_currency?: string | null
  swift_bic?: string | null
  is_active?: boolean | null
  created_at?: string | null
  current_fee_schedule?: FeeSchedule | null
}

interface ProviderStats {
  payment_count?: number
  total_notional_cents?: number
  total_markup_cents?: number
  total_leakage_cents?: number
  avg_markup_bps?: number
  total_hidden_spread_cents?: number
  total_wire_fee_cents?: number
  [k: string]: unknown
}

interface Note {
  id: string
  body: string
  created_at?: string | null
}

const TIERS = ['bank', 'fintech', 'broker', 'fx_specialist', 'other']
const LIFTING_POLICIES = ['OUR', 'BEN', 'SHA', 'unknown']

function fmtCents(c?: number | null): string {
  if (c == null) return '—'
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtBps(b?: number | null): string {
  if (b == null) return '—'
  return `${b.toFixed(1)} bps`
}
function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString()
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export default function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [provider, setProvider] = useState<Provider | null>(null)
  const [schedules, setSchedules] = useState<FeeSchedule[]>([])
  const [stats, setStats] = useState<ProviderStats | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', tier: 'bank', home_currency: '', swift_bic: '', is_active: true })

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    wire_fee: '',
    stated_fx_fee_pct: '',
    lifting_charge: '',
    lifting_policy: 'OUR',
    effective_date: new Date().toISOString().slice(0, 10),
  })

  const [noteBody, setNoteBody] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, fs, st, nt] = await Promise.all([
        api.getProvider(id),
        api.getFeeSchedules(id).catch(() => []),
        api.getProviderStats(id).catch(() => null),
        api.getNotes('provider', id).catch(() => []),
      ])
      const prov: Provider = p
      setProvider(prov)
      setSchedules(Array.isArray(fs) ? fs : fs?.schedules ?? [])
      setStats(st && typeof st === 'object' ? st : null)
      setNotes(Array.isArray(nt) ? nt : nt?.notes ?? [])
      setEditForm({
        name: prov.name ?? '',
        tier: prov.tier ?? 'bank',
        home_currency: prov.home_currency ?? '',
        swift_bic: prov.swift_bic ?? '',
        is_active: prov.is_active ?? true,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load provider')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    setSavingEdit(true)
    setActionError(null)
    try {
      await api.updateProvider(id, {
        name: editForm.name.trim(),
        tier: editForm.tier,
        home_currency: editForm.home_currency.trim().toUpperCase() || null,
        swift_bic: editForm.swift_bic.trim().toUpperCase() || null,
        is_active: editForm.is_active,
      })
      setEditOpen(false)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update provider')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleAddSchedule(e: React.FormEvent) {
    e.preventDefault()
    setSavingSchedule(true)
    setActionError(null)
    try {
      await api.addFeeSchedule(id, {
        wire_fee_cents: Math.round(num(scheduleForm.wire_fee) * 100),
        stated_fx_fee_pct: scheduleForm.stated_fx_fee_pct === '' ? 0 : num(scheduleForm.stated_fx_fee_pct),
        lifting_charge_cents: Math.round(num(scheduleForm.lifting_charge) * 100),
        lifting_policy: scheduleForm.lifting_policy,
        effective_date: scheduleForm.effective_date,
      })
      setScheduleOpen(false)
      setScheduleForm({
        wire_fee: '',
        stated_fx_fee_pct: '',
        lifting_charge: '',
        lifting_policy: 'OUR',
        effective_date: new Date().toISOString().slice(0, 10),
      })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to add fee schedule')
    } finally {
      setSavingSchedule(false)
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteBody.trim()) return
    setSavingNote(true)
    setActionError(null)
    try {
      await api.createNote({ entity_type: 'provider', entity_id: id, org_id: provider?.org_id, body: noteBody.trim() })
      setNoteBody('')
      const nt = await api.getNotes('provider', id).catch(() => [])
      setNotes(Array.isArray(nt) ? nt : nt?.notes ?? [])
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to add note')
    } finally {
      setSavingNote(false)
    }
  }

  if (loading) {
    return <Spinner className="py-24" label="Loading provider…" />
  }

  if (error || !provider) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/providers" className="text-sm text-orange-300 hover:text-orange-200">
          ← Back to providers
        </Link>
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-sm text-rose-300">{error ?? 'Provider not found'}</p>
            <Button variant="secondary" className="mt-4" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const leakage = num(stats?.total_leakage_cents ?? stats?.total_markup_cents)
  const maxScheduleFee = Math.max(1, ...schedules.map((s) => num(s.wire_fee_cents) + num(s.lifting_charge_cents)))

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/providers" className="text-sm text-orange-300 hover:text-orange-200">
          ← Back to providers
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{provider.name}</h1>
            {provider.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <Badge tone="blue">{provider.tier ?? '—'}</Badge>
            <span>Home: {provider.home_currency ?? '—'}</span>
            {provider.swift_bic && <span className="font-mono text-xs">{provider.swift_bic}</span>}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          Edit provider
        </Button>
      </div>

      {actionError && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{actionError}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Payments" value={num(stats?.payment_count).toLocaleString()} />
        <Stat label="Total notional" value={fmtCents(stats?.total_notional_cents)} />
        <Stat label="Avg markup" value={fmtBps(stats?.avg_markup_bps)} tone="amber" />
        <Stat label="Total leakage" value={fmtCents(leakage)} tone="rose" />
      </div>

      {(num(stats?.total_hidden_spread_cents) > 0 || num(stats?.total_wire_fee_cents) > 0) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Cost composition</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {[
              { label: 'Hidden spread', value: num(stats?.total_hidden_spread_cents), tone: 'bg-rose-500' },
              { label: 'Wire & lifting fees', value: num(stats?.total_wire_fee_cents), tone: 'bg-amber-500' },
            ].map((row) => {
              const total = Math.max(1, num(stats?.total_hidden_spread_cents) + num(stats?.total_wire_fee_cents))
              const pct = (row.value / total) * 100
              return (
                <div key={row.label}>
                  <div className="mb-1 flex justify-between text-xs text-slate-400">
                    <span>{row.label}</span>
                    <span className="tabular-nums text-slate-300">{fmtCents(row.value)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full ${row.tone}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Fee schedules</h2>
            <p className="mt-0.5 text-xs text-slate-500">Stated wire, FX and lifting charges over time.</p>
          </div>
          <Button onClick={() => setScheduleOpen(true)}>+ Add schedule</Button>
        </CardHeader>
        <CardBody className="p-0">
          {schedules.length === 0 ? (
            <EmptyState
              className="m-5"
              title="No fee schedules"
              description="Add the provider's stated fees to power reconciliation and markup expectations."
              action={<Button onClick={() => setScheduleOpen(true)}>+ Add schedule</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Effective</TH>
                  <TH>Wire fee</TH>
                  <TH>Stated FX %</TH>
                  <TH>Lifting</TH>
                  <TH>Policy</TH>
                  <TH>Stated cost</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {schedules.map((s) => {
                  const totalStated = num(s.wire_fee_cents) + num(s.lifting_charge_cents)
                  return (
                    <TR key={s.id}>
                      <TD>{fmtDate(s.effective_date)}</TD>
                      <TD className="tabular-nums">{fmtCents(s.wire_fee_cents)}</TD>
                      <TD className="tabular-nums">{s.stated_fx_fee_pct != null ? `${num(s.stated_fx_fee_pct).toFixed(3)}%` : '—'}</TD>
                      <TD className="tabular-nums">{fmtCents(s.lifting_charge_cents)}</TD>
                      <TD>
                        <Badge tone="slate">{s.lifting_policy ?? '—'}</Badge>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-orange-500" style={{ width: `${(totalStated / maxScheduleFee) * 100}%` }} />
                          </div>
                          <span className="tabular-nums text-xs text-slate-400">{fmtCents(totalStated)}</span>
                        </div>
                      </TD>
                      <TD>{s.is_current ? <Badge tone="teal">Current</Badge> : <Badge tone="slate">Past</Badge>}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Notes</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <form onSubmit={handleAddNote} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add a note about this provider…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <Button type="submit" disabled={savingNote || !noteBody.trim()}>
              {savingNote ? 'Saving…' : 'Add note'}
            </Button>
          </form>
          {notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-sm text-slate-200">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-600">{fmtDate(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => (savingEdit ? null : setEditOpen(false))}
        title="Edit provider"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="submit" form="provider-edit-form" disabled={savingEdit || !editForm.name.trim()}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <form id="provider-edit-form" onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Tier</label>
              <select
                value={editForm.tier}
                onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Home currency</label>
              <input
                value={editForm.home_currency}
                onChange={(e) => setEditForm({ ...editForm, home_currency: e.target.value })}
                maxLength={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">SWIFT / BIC</label>
            <input
              value={editForm.swift_bic}
              onChange={(e) => setEditForm({ ...editForm, swift_bic: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
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
        open={scheduleOpen}
        onClose={() => (savingSchedule ? null : setScheduleOpen(false))}
        title="Add fee schedule"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setScheduleOpen(false)} disabled={savingSchedule}>
              Cancel
            </Button>
            <Button type="submit" form="schedule-form" disabled={savingSchedule}>
              {savingSchedule ? 'Saving…' : 'Add schedule'}
            </Button>
          </div>
        }
      >
        <form id="schedule-form" onSubmit={handleAddSchedule} className="space-y-4">
          <p className="text-xs text-slate-500">Adding a schedule marks any prior schedule as no longer current.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Wire fee (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={scheduleForm.wire_fee}
                onChange={(e) => setScheduleForm({ ...scheduleForm, wire_fee: e.target.value })}
                placeholder="25.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Stated FX fee %</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={scheduleForm.stated_fx_fee_pct}
                onChange={(e) => setScheduleForm({ ...scheduleForm, stated_fx_fee_pct: e.target.value })}
                placeholder="0.50"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Lifting charge (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={scheduleForm.lifting_charge}
                onChange={(e) => setScheduleForm({ ...scheduleForm, lifting_charge: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Lifting policy</label>
              <select
                value={scheduleForm.lifting_policy}
                onChange={(e) => setScheduleForm({ ...scheduleForm, lifting_policy: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {LIFTING_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Effective date</label>
            <input
              type="date"
              value={scheduleForm.effective_date}
              onChange={(e) => setScheduleForm({ ...scheduleForm, effective_date: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
