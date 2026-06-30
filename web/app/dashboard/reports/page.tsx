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

interface Report {
  id: string
  org_id: string
  name: string
  kind: string
  config: unknown
  result: unknown
  created_at: string
}

interface ReportSchedule {
  id: string
  report_id: string
  cadence: string
  recipient_email: string
  is_enabled: boolean
  created_at: string
}

const REPORT_KINDS = [
  { value: 'leakage_summary', label: 'Leakage summary' },
  { value: 'provider_breakdown', label: 'Provider breakdown' },
  { value: 'corridor_breakdown', label: 'Corridor breakdown' },
  { value: 'markup_trend', label: 'Markup trend' },
  { value: 'reconciliation_variance', label: 'Reconciliation variance' },
]

const CADENCES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
]

function kindLabel(kind: string): string {
  return REPORT_KINDS.find((k) => k.value === kind)?.label ?? kind
}

export default function ReportsPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', kind: 'leakage_summary' })

  const [resultReport, setResultReport] = useState<Report | null>(null)

  // schedules
  const [scheduleReport, setScheduleReport] = useState<Report | null>(null)
  const [schedules, setSchedules] = useState<ReportSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    cadence: 'weekly',
    recipient_email: '',
    is_enabled: true,
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const oid = org?.id as string | undefined
      setOrgId(oid)
      const r = await api.getReports(oid)
      setReports(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refreshReports = useCallback(async () => {
    try {
      const r = await api.getReports(orgId)
      setReports(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh reports')
    }
  }, [orgId])

  const stats = useMemo(() => {
    const generated = reports.filter((r) => r.result != null).length
    const kinds = new Set(reports.map((r) => r.kind)).size
    return { total: reports.length, generated, kinds }
  }, [reports])

  async function submitCreate() {
    if (!createForm.name.trim()) {
      setError('Report name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createReport({
        org_id: orgId,
        name: createForm.name.trim(),
        kind: createForm.kind,
        config: {},
      })
      setCreateOpen(false)
      setCreateForm({ name: '', kind: 'leakage_summary' })
      setNotice('Report created and generated.')
      await refreshReports()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create report')
    } finally {
      setBusy(false)
    }
  }

  async function generate(r: Report) {
    setBusyId(r.id)
    setError(null)
    setNotice(null)
    try {
      const updated = await api.generateReport(r.id)
      setNotice(`Regenerated "${r.name}".`)
      if (resultReport?.id === r.id && updated?.id) setResultReport(updated)
      await refreshReports()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setBusyId(null)
    }
  }

  async function removeReport(r: Report) {
    if (!confirm(`Delete report "${r.name}"?`)) return
    setBusyId(r.id)
    setError(null)
    try {
      await api.deleteReport(r.id)
      if (resultReport?.id === r.id) setResultReport(null)
      if (scheduleReport?.id === r.id) setScheduleReport(null)
      await refreshReports()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setBusyId(null)
    }
  }

  const loadSchedules = useCallback(async (r: Report) => {
    setSchedulesLoading(true)
    try {
      const s = await api.getReportSchedules(r.id)
      setSchedules(Array.isArray(s) ? s : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules')
      setSchedules([])
    } finally {
      setSchedulesLoading(false)
    }
  }, [])

  async function openSchedules(r: Report) {
    setScheduleReport(r)
    setScheduleForm({ cadence: 'weekly', recipient_email: '', is_enabled: true })
    await loadSchedules(r)
  }

  async function submitSchedule() {
    if (!scheduleReport) return
    if (!scheduleForm.recipient_email.trim()) {
      setError('Recipient email is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createReportSchedule(scheduleReport.id, {
        cadence: scheduleForm.cadence,
        recipient_email: scheduleForm.recipient_email.trim(),
        is_enabled: scheduleForm.is_enabled,
      })
      setScheduleForm({ cadence: 'weekly', recipient_email: '', is_enabled: true })
      await loadSchedules(scheduleReport)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create schedule')
    } finally {
      setBusy(false)
    }
  }

  async function removeSchedule(s: ReportSchedule) {
    if (!scheduleReport) return
    if (!confirm('Delete this schedule?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteReportSchedule(scheduleReport.id, s.id)
      await loadSchedules(scheduleReport)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete schedule')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading reports…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Generate and schedule FX-cost transparency reports for finance and treasury stakeholders.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New report</Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total reports" value={stats.total} />
        <Stat label="Generated" value={stats.generated} tone="teal" />
        <Stat label="Report types" value={stats.kinds} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">All reports</h2>
        </CardHeader>
        <CardBody className="p-0">
          {reports.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No reports yet"
                description="Create a report to summarize hidden FX markup, leakage and reconciliation variance."
                action={<Button onClick={() => setCreateOpen(true)}>Create your first report</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {reports.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-white">{r.name}</TD>
                    <TD>
                      <Badge tone="blue">{kindLabel(r.kind)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={r.result != null ? 'green' : 'slate'}>
                        {r.result != null ? 'Generated' : 'Empty'}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setResultReport(r)}
                          disabled={r.result == null}
                        >
                          View result
                        </Button>
                        <Button variant="ghost" onClick={() => openSchedules(r)} disabled={busyId === r.id}>
                          Schedules
                        </Button>
                        <Button variant="ghost" onClick={() => generate(r)} disabled={busyId === r.id}>
                          {busyId === r.id ? 'Generating…' : 'Generate'}
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={() => removeReport(r)}
                          disabled={busyId === r.id}
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New report"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Create & generate'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Report name
            </label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="e.g. Q2 FX leakage summary"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Report type
            </label>
            <select
              value={createForm.kind}
              onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
            >
              {REPORT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Result modal */}
      <Modal
        open={resultReport != null}
        onClose={() => setResultReport(null)}
        title={resultReport ? `Result — ${resultReport.name}` : 'Result'}
        className="max-w-2xl"
        footer={
          resultReport && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setResultReport(null)}>
                Close
              </Button>
              <Button onClick={() => generate(resultReport)} disabled={busyId === resultReport.id}>
                {busyId === resultReport.id ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          )
        }
      >
        {resultReport && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone="blue">{kindLabel(resultReport.kind)}</Badge>
              <span className="text-xs text-slate-500">
                Generated {resultReport.created_at ? new Date(resultReport.created_at).toLocaleString() : ''}
              </span>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(resultReport.result ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </Modal>

      {/* Schedules modal */}
      <Modal
        open={scheduleReport != null}
        onClose={() => setScheduleReport(null)}
        title={scheduleReport ? `Schedules — ${scheduleReport.name}` : 'Schedules'}
        className="max-w-2xl"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setScheduleReport(null)}>
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Add schedule</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Cadence
                </label>
                <select
                  value={scheduleForm.cadence}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, cadence: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
                >
                  {CADENCES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Recipient email
                </label>
                <input
                  type="email"
                  value={scheduleForm.recipient_email}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, recipient_email: e.target.value })}
                  placeholder="treasury@company.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={scheduleForm.is_enabled}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, is_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500"
                />
                Enabled
              </label>
              <Button onClick={submitSchedule} disabled={busy}>
                {busy ? 'Adding…' : 'Add schedule'}
              </Button>
            </div>
          </div>

          {schedulesLoading ? (
            <Spinner label="Loading schedules…" className="py-6" />
          ) : schedules.length === 0 ? (
            <EmptyState title="No schedules" description="Add a recurring delivery schedule above." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Cadence</TH>
                  <TH>Recipient</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {schedules.map((s) => (
                  <TR key={s.id}>
                    <TD className="capitalize text-slate-200">{s.cadence}</TD>
                    <TD className="text-slate-300">{s.recipient_email}</TD>
                    <TD>
                      <Badge tone={s.is_enabled ? 'green' : 'slate'}>
                        {s.is_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={() => removeSchedule(s)}
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
        </div>
      </Modal>
    </div>
  )
}
