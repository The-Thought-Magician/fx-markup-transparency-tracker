'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/DashboardLayout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Org {
  id: string
  name: string
  base_currency: string
  owner_id: string | null
  created_at: string
}

interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: string
  created_at: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string
  current_period_end?: string | null
}

interface BillingInfo {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

interface Widget {
  id: string
  org_id: string
  kind: string
  title: string
  config: unknown
  position: number
  created_at: string
}

type Tab = 'org' | 'members' | 'billing' | 'widgets'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'INR', 'SGD', 'HKD', 'CNY', 'MXN', 'BRL', 'ZAR']

const WIDGET_KINDS = [
  { value: 'kpi', label: 'KPI card' },
  { value: 'trend', label: 'Trend chart' },
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'top_offenders', label: 'Top offenders' },
  { value: 'recent_alerts', label: 'Recent alerts' },
  { value: 'recon_variance', label: 'Reconciliation variance' },
]

function widgetKindLabel(kind: string): string {
  return WIDGET_KINDS.find((k) => k.value === kind)?.label ?? kind
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('org')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [org, setOrg] = useState<Org | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [widgets, setWidgets] = useState<Widget[]>([])

  // Org form
  const [orgForm, setOrgForm] = useState({ name: '', base_currency: 'USD' })

  // Member modal
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'member' })

  // Widget modal
  const [widgetOpen, setWidgetOpen] = useState(false)
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null)
  const [widgetForm, setWidgetForm] = useState({ kind: 'kpi', title: '', position: '0' })

  const load = useCallback(async () => {
    setError(null)
    try {
      const o = await api.getCurrentOrg()
      const orgObj = o && typeof o === 'object' ? (o as Org) : null
      setOrg(orgObj)
      setOrgForm({
        name: orgObj?.name ?? '',
        base_currency: orgObj?.base_currency ?? 'USD',
      })
      const oid = orgObj?.id
      const [m, b, w] = await Promise.all([
        oid ? api.getOrgMembers(oid) : Promise.resolve([]),
        api.getBillingPlan().catch(() => null),
        api.getWidgets(oid).catch(() => []),
      ])
      setMembers(Array.isArray(m) ? m : [])
      setBilling(b && typeof b === 'object' ? (b as BillingInfo) : null)
      setWidgets(Array.isArray(w) ? w : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refreshMembers = useCallback(async () => {
    if (!org?.id) return
    try {
      const m = await api.getOrgMembers(org.id)
      setMembers(Array.isArray(m) ? m : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh members')
    }
  }, [org])

  const refreshWidgets = useCallback(async () => {
    try {
      const w = await api.getWidgets(org?.id)
      setWidgets(Array.isArray(w) ? w : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh widgets')
    }
  }, [org])

  const orgDirty = useMemo(() => {
    if (!org) return false
    return orgForm.name !== org.name || orgForm.base_currency !== org.base_currency
  }, [org, orgForm])

  async function saveOrg() {
    if (!org?.id) return
    if (!orgForm.name.trim()) {
      setError('Organization name is required')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await api.updateOrg(org.id, {
        name: orgForm.name.trim(),
        base_currency: orgForm.base_currency,
      })
      if (updated && typeof updated === 'object') setOrg(updated as Org)
      setNotice('Organization settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save organization')
    } finally {
      setBusy(false)
    }
  }

  async function addMember() {
    if (!org?.id) return
    if (!memberForm.user_id.trim()) {
      setError('User ID is required')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.addOrgMember(org.id, {
        user_id: memberForm.user_id.trim(),
        role: memberForm.role,
      })
      setMemberOpen(false)
      setMemberForm({ user_id: '', role: 'member' })
      setNotice('Member added.')
      await refreshMembers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add member')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(m: OrgMember) {
    if (!org?.id) return
    if (!confirm(`Remove ${m.user_id} from this organization?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.removeOrgMember(org.id, m.id)
      await refreshMembers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.startCheckout()
      const url = res?.url as string | undefined
      if (url) {
        window.location.href = url
      } else {
        setError('Checkout is unavailable (billing not configured).')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start checkout')
    } finally {
      setBusy(false)
    }
  }

  async function handlePortal() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.openBillingPortal()
      const url = res?.url as string | undefined
      if (url) {
        window.location.href = url
      } else {
        setError('Billing portal is unavailable (billing not configured).')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open billing portal')
    } finally {
      setBusy(false)
    }
  }

  function openCreateWidget() {
    setEditingWidget(null)
    setWidgetForm({ kind: 'kpi', title: '', position: String(widgets.length) })
    setWidgetOpen(true)
  }

  function openEditWidget(w: Widget) {
    setEditingWidget(w)
    setWidgetForm({ kind: w.kind, title: w.title, position: String(w.position ?? 0) })
    setWidgetOpen(true)
  }

  async function submitWidget() {
    if (!widgetForm.title.trim()) {
      setError('Widget title is required')
      return
    }
    const position = Number(widgetForm.position)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const body = {
        org_id: org?.id,
        kind: widgetForm.kind,
        title: widgetForm.title.trim(),
        position: Number.isNaN(position) ? 0 : position,
        config: {},
      }
      if (editingWidget) {
        await api.updateWidget(editingWidget.id, body)
      } else {
        await api.createWidget(body)
      }
      setWidgetOpen(false)
      await refreshWidgets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save widget')
    } finally {
      setBusy(false)
    }
  }

  async function moveWidget(w: Widget, dir: -1 | 1) {
    setBusy(true)
    setError(null)
    try {
      await api.updateWidget(w.id, { position: (w.position ?? 0) + dir })
      await refreshWidgets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder widget')
    } finally {
      setBusy(false)
    }
  }

  async function removeWidget(w: Widget) {
    if (!confirm(`Delete widget "${w.title}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteWidget(w.id)
      await refreshWidgets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete widget')
    } finally {
      setBusy(false)
    }
  }

  const sortedWidgets = useMemo(
    () => widgets.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [widgets],
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'org', label: 'Organization' },
    { id: 'members', label: `Members${members.length ? ` (${members.length})` : ''}` },
    { id: 'billing', label: 'Billing' },
    { id: 'widgets', label: `Widgets${widgets.length ? ` (${widgets.length})` : ''}` },
  ]

  return (
    <DashboardLayout>
      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner label="Loading settings…" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage your organization, members, billing, and dashboard widgets.
            </p>
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

          {/* Tabs */}
          <div className="flex flex-wrap gap-1 border-b border-slate-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                  setError(null)
                  setNotice(null)
                }}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-orange-400 text-orange-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Organization */}
          {tab === 'org' && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Organization details</h2>
                <p className="text-xs text-slate-500">
                  The base currency anchors how markup and leakage are reported across the platform.
                </p>
              </CardHeader>
              <CardBody className="space-y-4">
                {!org ? (
                  <EmptyState title="No organization found" description="Create an organization to get started." />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Organization name
                        </label>
                        <input
                          value={orgForm.name}
                          onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Base currency
                        </label>
                        <select
                          value={orgForm.base_currency}
                          onChange={(e) => setOrgForm({ ...orgForm, base_currency: e.target.value })}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-y-2 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm sm:grid-cols-4">
                      <dt className="text-slate-500">Org ID</dt>
                      <dd className="col-span-1 break-all font-mono text-xs text-slate-300 sm:col-span-3">
                        {org.id}
                      </dd>
                      <dt className="text-slate-500">Created</dt>
                      <dd className="col-span-1 text-slate-300 sm:col-span-3">
                        {org.created_at ? new Date(org.created_at).toLocaleString() : '—'}
                      </dd>
                    </dl>
                    <div className="flex justify-end">
                      <Button onClick={saveOrg} disabled={busy || !orgDirty}>
                        {busy ? 'Saving…' : 'Save changes'}
                      </Button>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          {/* Members */}
          {tab === 'members' && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Members</h2>
                  <p className="text-xs text-slate-500">People with access to this organization.</p>
                </div>
                <Button onClick={() => setMemberOpen(true)} disabled={!org}>
                  + Add member
                </Button>
              </CardHeader>
              <CardBody className="p-0">
                {members.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No members yet"
                      description="Add teammates so they can view and manage FX-cost data."
                      action={
                        <Button onClick={() => setMemberOpen(true)} disabled={!org}>
                          Add a member
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>User</TH>
                        <TH>Role</TH>
                        <TH>Joined</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {members.map((m) => {
                        const isOwner = org?.owner_id && m.user_id === org.owner_id
                        return (
                          <TR key={m.id}>
                            <TD className="break-all font-mono text-xs text-slate-200">{m.user_id}</TD>
                            <TD>
                              <Badge tone={(m.role || '').toLowerCase() === 'owner' || isOwner ? 'teal' : 'slate'}>
                                {isOwner ? 'owner' : m.role || 'member'}
                              </Badge>
                            </TD>
                            <TD className="whitespace-nowrap text-slate-400">
                              {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                            </TD>
                            <TD>
                              <div className="flex justify-end">
                                <Button
                                  variant="ghost"
                                  className="text-rose-400 hover:text-rose-300"
                                  onClick={() => removeMember(m)}
                                  disabled={busy || !!isOwner}
                                  title={isOwner ? 'The owner cannot be removed' : 'Remove member'}
                                >
                                  Remove
                                </Button>
                              </div>
                            </TD>
                          </TR>
                        )
                      })}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          )}

          {/* Billing */}
          {tab === 'billing' && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Billing &amp; plan</h2>
                <p className="text-xs text-slate-500">Manage your subscription and payment method.</p>
              </CardHeader>
              <CardBody className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 px-5 py-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Current plan</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xl font-bold text-white">
                        {billing?.plan?.name ?? 'Free'}
                      </span>
                      <Badge
                        tone={
                          (billing?.subscription?.status || '').toLowerCase() === 'active' ? 'green' : 'slate'
                        }
                      >
                        {billing?.subscription?.status ?? 'free'}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Price</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-white">
                      {billing?.plan ? (billing.plan.price_cents > 0 ? `${fmtCents(billing.plan.price_cents)}/mo` : 'Free') : 'Free'}
                    </div>
                  </div>
                </div>

                {billing?.subscription?.current_period_end && (
                  <p className="text-sm text-slate-400">
                    Current period ends{' '}
                    <span className="text-slate-200">
                      {new Date(billing.subscription.current_period_end).toLocaleDateString()}
                    </span>
                    .
                  </p>
                )}

                {billing?.stripeEnabled === false && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    Stripe billing is not configured for this deployment. Checkout and the billing portal are unavailable.
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleCheckout}
                    disabled={busy || billing?.stripeEnabled === false}
                  >
                    {(billing?.subscription?.status || '').toLowerCase() === 'active'
                      ? 'Change plan'
                      : 'Upgrade to Pro'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handlePortal}
                    disabled={busy || billing?.stripeEnabled === false}
                  >
                    Manage billing
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Widgets */}
          {tab === 'widgets' && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Dashboard widgets</h2>
                  <p className="text-xs text-slate-500">
                    Configure the cards shown on your overview dashboard and their order.
                  </p>
                </div>
                <Button onClick={openCreateWidget} disabled={!org}>
                  + Add widget
                </Button>
              </CardHeader>
              <CardBody className="p-0">
                {sortedWidgets.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No widgets configured"
                      description="Add widgets to tailor the overview dashboard to what matters to your treasury team."
                      action={
                        <Button onClick={openCreateWidget} disabled={!org}>
                          Add your first widget
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-16">Order</TH>
                        <TH>Title</TH>
                        <TH>Kind</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {sortedWidgets.map((w, i) => (
                        <TR key={w.id}>
                          <TD>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => moveWidget(w, -1)}
                                disabled={busy || i === 0}
                                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                aria-label="Move up"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => moveWidget(w, 1)}
                                disabled={busy || i === sortedWidgets.length - 1}
                                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-30"
                                aria-label="Move down"
                              >
                                ▼
                              </button>
                            </div>
                          </TD>
                          <TD className="font-medium text-white">{w.title}</TD>
                          <TD>
                            <Badge tone="teal">{widgetKindLabel(w.kind)}</Badge>
                          </TD>
                          <TD>
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" onClick={() => openEditWidget(w)} disabled={busy}>
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                className="text-rose-400 hover:text-rose-300"
                                onClick={() => removeWidget(w)}
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
          )}

          {/* Add member modal */}
          <Modal
            open={memberOpen}
            onClose={() => setMemberOpen(false)}
            title="Add member"
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMemberOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={addMember} disabled={busy}>
                  {busy ? 'Adding…' : 'Add member'}
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  User ID
                </label>
                <input
                  value={memberForm.user_id}
                  onChange={(e) => setMemberForm({ ...memberForm, user_id: e.target.value })}
                  placeholder="auth user id"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Role
                </label>
                <select
                  value={memberForm.role}
                  onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>
          </Modal>

          {/* Widget modal */}
          <Modal
            open={widgetOpen}
            onClose={() => setWidgetOpen(false)}
            title={editingWidget ? 'Edit widget' : 'Add widget'}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setWidgetOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={submitWidget} disabled={busy}>
                  {busy ? 'Saving…' : editingWidget ? 'Save changes' : 'Add widget'}
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Title
                </label>
                <input
                  value={widgetForm.title}
                  onChange={(e) => setWidgetForm({ ...widgetForm, title: e.target.value })}
                  placeholder="e.g. Annualized leakage"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Kind
                  </label>
                  <select
                    value={widgetForm.kind}
                    onChange={(e) => setWidgetForm({ ...widgetForm, kind: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
                  >
                    {WIDGET_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Position
                  </label>
                  <input
                    type="number"
                    value={widgetForm.position}
                    onChange={(e) => setWidgetForm({ ...widgetForm, position: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </DashboardLayout>
  )
}
