'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface LedgerSummary {
  org_id?: string
  period?: string
  total_notional_cents?: number
  total_markup_cents?: number
  total_fees_cents?: number
  annualized_leakage_cents?: number
  payment_count?: number
  avg_markup_bps?: number
  breakdown?: Record<string, number> | { label: string; value: number }[] | null
}

interface CostLedger {
  id: string
  org_id: string
  period: string
  total_notional_cents: number
  total_markup_cents: number
  total_fees_cents: number
  annualized_leakage_cents: number
  breakdown?: unknown
  created_at: string
}

function fmtMoney(cents?: number) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtMoneyPrecise(cents?: number) {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n?: number, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function defaultPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function normalizeBreakdown(breakdown: LedgerSummary['breakdown']): { label: string; value: number }[] {
  if (!breakdown) return []
  if (Array.isArray(breakdown)) {
    return breakdown
      .filter((b) => b && typeof b.value === 'number')
      .map((b) => ({ label: String(b.label), value: b.value }))
  }
  return Object.entries(breakdown)
    .filter(([, v]) => typeof v === 'number')
    .map(([label, value]) => ({ label, value: value as number }))
}

export default function LedgerPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [ledgers, setLedgers] = useState<CostLedger[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [period, setPeriod] = useState(defaultPeriod())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState<CostLedger | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const id = org?.id ?? null
      setOrgId(id)
      const [sum, list] = await Promise.all([
        api.getLedgerSummary({ org_id: id ?? undefined, period }),
        api.getLedgers(id ?? undefined),
      ])
      setSummary(sum ?? null)
      setLedgers(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost ledger')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  const refreshSummary = useCallback(async () => {
    try {
      const sum = await api.getLedgerSummary({ org_id: orgId ?? undefined, period })
      setSummary(sum ?? null)
    } catch {
      /* keep prior summary */
    }
  }, [orgId, period])

  async function handleCreate() {
    if (!period.trim()) {
      setSaveError('Period is required')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await api.createLedger({ org_id: orgId, period: period.trim() })
      const list = await api.getLedgers(orgId ?? undefined)
      setLedgers(Array.isArray(list) ? list : [])
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save ledger entry')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.deleteLedger(confirmDelete.id)
      setLedgers((prev) => prev.filter((l) => l.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to delete ledger entry')
    } finally {
      setDeleting(false)
    }
  }

  const breakdown = useMemo(() => normalizeBreakdown(summary?.breakdown), [summary])
  const breakdownMax = useMemo(
    () => breakdown.reduce((m, b) => Math.max(m, Math.abs(b.value)), 0),
    [breakdown],
  )

  const annualized = summary?.annualized_leakage_cents
  const totalLeakage = (summary?.total_markup_cents ?? 0) + (summary?.total_fees_cents ?? 0)

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading cost ledger…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Cost Ledger</h1>
          <Badge tone="teal">FX leakage accounting</Badge>
        </div>
        <p className="text-sm text-slate-500">
          Live annualized projection of hidden FX cost, plus saved period ledger entries you can compare over time.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}{' '}
          <button onClick={() => void load()} className="ml-2 underline hover:text-rose-200">
            Retry
          </button>
        </div>
      )}

      {/* Projection summary */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Annualized projection</h2>
            <p className="text-xs text-slate-500">Based on the selected period&apos;s observed payments.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Period
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </label>
            <Button variant="secondary" onClick={() => void refreshSummary()}>
              Recompute
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Annualized leakage"
            value={fmtMoney(annualized)}
            tone="rose"
            hint="Projected 12-month hidden cost"
          />
          <Stat label="Period leakage" value={fmtMoney(totalLeakage)} tone="amber" hint="Markup + fees this period" />
          <Stat label="Total notional" value={fmtMoney(summary?.total_notional_cents)} hint="Volume processed" />
          <Stat
            label="Avg markup"
            value={summary?.avg_markup_bps != null ? `${fmtNum(summary.avg_markup_bps)} bps` : '—'}
            tone="teal"
            hint={summary?.payment_count != null ? `${summary.payment_count} payments` : 'Effective spread'}
          />
        </div>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-white">Leakage breakdown</h3>
          </CardHeader>
          <CardBody>
            {breakdown.length === 0 ? (
              <p className="text-sm text-slate-500">
                No breakdown available for this period. Capture payments and benchmark rates, then recompute.
              </p>
            ) : (
              <div className="space-y-3">
                {breakdown.map((b) => {
                  const pct = breakdownMax > 0 ? (Math.abs(b.value) / breakdownMax) * 100 : 0
                  return (
                    <div key={b.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize text-slate-300">{b.label.replace(/_/g, ' ')}</span>
                        <span className="font-medium tabular-nums text-slate-100">{fmtMoney(b.value)}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* Save ledger entry */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-white">Save ledger entry</h3>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Period to persist
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
              />
            </label>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving ? 'Saving…' : 'Compute & save period'}
            </Button>
            {saveError && <span className="text-sm text-rose-400">{saveError}</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Persists a snapshot of total notional, markup, fees and annualized leakage for the chosen period.
          </p>
        </CardBody>
      </Card>

      {/* Saved entries */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Saved ledger entries</h3>
            <Badge tone="slate">{ledgers.length} entries</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {ledgers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No saved entries yet"
                description="Compute and save a period above to start tracking leakage over time."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH className="text-right">Notional</TH>
                  <TH className="text-right">Markup</TH>
                  <TH className="text-right">Fees</TH>
                  <TH className="text-right">Annualized leakage</TH>
                  <TH>Saved</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {ledgers.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-medium text-white">{l.period}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(l.total_notional_cents)}</TD>
                    <TD className="text-right tabular-nums text-amber-300">{fmtMoneyPrecise(l.total_markup_cents)}</TD>
                    <TD className="text-right tabular-nums text-slate-300">{fmtMoneyPrecise(l.total_fees_cents)}</TD>
                    <TD className="text-right tabular-nums font-semibold text-rose-300">
                      {fmtMoney(l.annualized_leakage_cents)}
                    </TD>
                    <TD className="text-slate-500">
                      {l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setConfirmDelete(l)}>
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

      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title="Delete ledger entry"
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
          Delete the saved ledger entry for{' '}
          <span className="font-semibold text-white">{confirmDelete?.period}</span>? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
