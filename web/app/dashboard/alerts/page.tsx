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

interface Alert {
  id: string
  org_id: string
  rule_id: string | null
  payment_id: string | null
  message: string
  severity: string
  status: string
  created_at: string
}

interface AlertRule {
  id: string
  org_id: string
  name: string
  metric: string
  comparator: string
  threshold: number
  is_enabled: boolean
  created_at: string
}

const METRICS = [
  { value: 'markup_bps', label: 'Markup (bps)' },
  { value: 'effective_cost_pct', label: 'Effective cost %' },
  { value: 'hidden_spread_cents', label: 'Hidden spread (cents)' },
  { value: 'total_cost_cents', label: 'Total cost (cents)' },
  { value: 'variance_cents', label: 'Recon variance (cents)' },
]

const COMPARATORS = [
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'eq', label: 'equal to' },
]

function severityTone(sev: string): 'rose' | 'amber' | 'teal' | 'slate' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'rose'
    case 'medium':
    case 'warning':
      return 'amber'
    case 'low':
    case 'info':
      return 'teal'
    default:
      return 'slate'
  }
}

function statusTone(status: string): 'green' | 'amber' | 'slate' {
  switch ((status || '').toLowerCase()) {
    case 'resolved':
      return 'green'
    case 'acknowledged':
      return 'amber'
    default:
      return 'slate'
  }
}

function metricLabel(metric: string): string {
  return METRICS.find((m) => m.value === metric)?.label ?? metric
}

function comparatorLabel(c: string): string {
  return COMPARATORS.find((x) => x.value === c)?.label ?? c
}

export default function AlertsPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [form, setForm] = useState({
    name: '',
    metric: 'markup_bps',
    comparator: 'gt',
    threshold: '',
    is_enabled: true,
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const oid = org?.id as string | undefined
      setOrgId(oid)
      const [a, r] = await Promise.all([api.getAlerts({ org_id: oid }), api.getAlertRules(oid)])
      setAlerts(Array.isArray(a) ? a : [])
      setRules(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api.getAlerts({ org_id: orgId }), api.getAlertRules(orgId)])
      setAlerts(Array.isArray(a) ? a : [])
      setRules(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    }
  }, [orgId])

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (statusFilter !== 'all' && (a.status || '').toLowerCase() !== statusFilter) return false
      if (severityFilter !== 'all' && (a.severity || '').toLowerCase() !== severityFilter) return false
      if (search && !a.message.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [alerts, statusFilter, severityFilter, search])

  const stats = useMemo(() => {
    const open = alerts.filter((a) => (a.status || '').toLowerCase() === 'open').length
    const critical = alerts.filter((a) => severityTone(a.severity) === 'rose').length
    const enabledRules = rules.filter((r) => r.is_enabled).length
    return { total: alerts.length, open, critical, rules: rules.length, enabledRules }
  }, [alerts, rules])

  async function handleEvaluate() {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await api.evaluateAlerts({ org_id: orgId })
      const generated = res?.generated ?? res?.count ?? 0
      setNotice(`Evaluation complete — ${generated} alert${generated === 1 ? '' : 's'} generated.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setBusy(false)
    }
  }

  async function setAlertStatus(a: Alert, status: string) {
    setBusy(true)
    setError(null)
    try {
      await api.updateAlert(a.id, { status })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update alert')
    } finally {
      setBusy(false)
    }
  }

  async function removeAlert(a: Alert) {
    if (!confirm('Delete this alert?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAlert(a.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete alert')
    } finally {
      setBusy(false)
    }
  }

  function openCreateRule() {
    setEditingRule(null)
    setForm({ name: '', metric: 'markup_bps', comparator: 'gt', threshold: '', is_enabled: true })
    setRuleModalOpen(true)
  }

  function openEditRule(r: AlertRule) {
    setEditingRule(r)
    setForm({
      name: r.name,
      metric: r.metric,
      comparator: r.comparator,
      threshold: String(r.threshold ?? ''),
      is_enabled: r.is_enabled,
    })
    setRuleModalOpen(true)
  }

  async function submitRule() {
    if (!form.name.trim()) {
      setError('Rule name is required')
      return
    }
    const threshold = Number(form.threshold)
    if (Number.isNaN(threshold)) {
      setError('Threshold must be a number')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        org_id: orgId,
        name: form.name.trim(),
        metric: form.metric,
        comparator: form.comparator,
        threshold,
        is_enabled: form.is_enabled,
      }
      if (editingRule) {
        await api.updateAlertRule(editingRule.id, body)
      } else {
        await api.createAlertRule(body)
      }
      setRuleModalOpen(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setBusy(false)
    }
  }

  async function toggleRule(r: AlertRule) {
    setBusy(true)
    setError(null)
    try {
      await api.updateAlertRule(r.id, { is_enabled: !r.is_enabled })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle rule')
    } finally {
      setBusy(false)
    }
  }

  async function removeRule(r: AlertRule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAlertRule(r.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading alerts…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor FX-cost thresholds and triage leakage alerts as they fire.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openCreateRule}>
            + New rule
          </Button>
          <Button onClick={handleEvaluate} disabled={busy}>
            {busy ? 'Evaluating…' : 'Run evaluation'}
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total alerts" value={stats.total} />
        <Stat label="Open" value={stats.open} tone={stats.open > 0 ? 'amber' : 'default'} />
        <Stat label="Critical" value={stats.critical} tone={stats.critical > 0 ? 'rose' : 'default'} />
        <Stat label="Rules" value={stats.rules} />
        <Stat label="Enabled rules" value={stats.enabledRules} tone="teal" />
      </div>

      {/* Rules editor */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Alert rules</h2>
            <p className="text-xs text-slate-500">Threshold rules evaluated against payment markup metrics.</p>
          </div>
          <Button variant="secondary" onClick={openCreateRule}>
            + New rule
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {rules.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No alert rules yet"
                description="Create a rule to flag payments whose markup or cost exceeds your tolerance."
                action={<Button onClick={openCreateRule}>Create your first rule</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Condition</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rules.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-white">{r.name}</TD>
                    <TD className="text-slate-300">
                      <span className="text-orange-300">{metricLabel(r.metric)}</span>{' '}
                      {comparatorLabel(r.comparator)}{' '}
                      <span className="font-medium tabular-nums text-white">{r.threshold}</span>
                    </TD>
                    <TD>
                      <Badge tone={r.is_enabled ? 'green' : 'slate'}>
                        {r.is_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => toggleRule(r)} disabled={busy}>
                          {r.is_enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="ghost" onClick={() => openEditRule(r)} disabled={busy}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => removeRule(r)} disabled={busy}>
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

      {/* Alerts feed */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Alerts feed</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search messages…"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredAlerts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={alerts.length === 0 ? 'No alerts' : 'No alerts match your filters'}
                description={
                  alerts.length === 0
                    ? 'Run an evaluation to generate alerts from your enabled rules.'
                    : 'Try clearing the search or filters above.'
                }
                action={
                  alerts.length === 0 ? (
                    <Button onClick={handleEvaluate} disabled={busy}>
                      Run evaluation
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Message</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredAlerts.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Badge tone={severityTone(a.severity)}>{a.severity || 'info'}</Badge>
                    </TD>
                    <TD className="max-w-md text-slate-200">{a.message}</TD>
                    <TD>
                      <Badge tone={statusTone(a.status)}>{a.status || 'open'}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">
                      {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        {(a.status || '').toLowerCase() !== 'acknowledged' &&
                          (a.status || '').toLowerCase() !== 'resolved' && (
                            <Button variant="ghost" onClick={() => setAlertStatus(a, 'acknowledged')} disabled={busy}>
                              Acknowledge
                            </Button>
                          )}
                        {(a.status || '').toLowerCase() !== 'resolved' && (
                          <Button variant="ghost" onClick={() => setAlertStatus(a, 'resolved')} disabled={busy}>
                            Resolve
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={() => removeAlert(a)}
                          disabled={busy}
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

      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={editingRule ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRuleModalOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitRule} disabled={busy}>
              {busy ? 'Saving…' : editingRule ? 'Save changes' : 'Create rule'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Rule name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. High markup on USD/EUR"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Metric
              </label>
              <select
                value={form.metric}
                onChange={(e) => setForm({ ...form, metric: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Comparator
              </label>
              <select
                value={form.comparator}
                onChange={(e) => setForm({ ...form, comparator: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {COMPARATORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Threshold
              </label>
              <input
                type="number"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                placeholder="0"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-orange-500 focus:ring-orange-500"
            />
            Enabled
          </label>
        </div>
      </Modal>
    </div>
  )
}
