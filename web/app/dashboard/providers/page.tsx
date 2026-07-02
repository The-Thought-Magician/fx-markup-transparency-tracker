'use client'

import { useEffect, useMemo, useState } from 'react'
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

interface Provider {
  id: string
  org_id: string
  name: string
  tier?: string | null
  home_currency?: string | null
  swift_bic?: string | null
  is_active?: boolean | null
  created_at?: string | null
}

const TIERS = ['bank', 'fintech', 'broker', 'fx_specialist', 'other']

function tierTone(tier?: string | null): 'teal' | 'blue' | 'amber' | 'slate' {
  switch (tier) {
    case 'bank':
      return 'blue'
    case 'fintech':
      return 'teal'
    case 'broker':
      return 'amber'
    default:
      return 'slate'
  }
}

export default function ProvidersPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    tier: 'bank',
    home_currency: 'USD',
    swift_bic: '',
    is_active: true,
  })

  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      let resolvedOrg = orgId
      if (!resolvedOrg) {
        try {
          const org = await api.getCurrentOrg()
          resolvedOrg = org?.id
          setOrgId(resolvedOrg)
        } catch {
          // current org may require auth; fall back to unfiltered list
        }
      }
      const data = await api.getProviders(resolvedOrg)
      setProviders(Array.isArray(data) ? data : data?.providers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return providers.filter((p) => {
      if (search && !`${p.name} ${p.swift_bic ?? ''} ${p.home_currency ?? ''}`.toLowerCase().includes(search.toLowerCase()))
        return false
      if (tierFilter !== 'all' && p.tier !== tierFilter) return false
      if (activeFilter === 'active' && !p.is_active) return false
      if (activeFilter === 'inactive' && p.is_active) return false
      return true
    })
  }, [providers, search, tierFilter, activeFilter])

  const activeCount = providers.filter((p) => p.is_active).length
  const tierCount = new Set(providers.map((p) => p.tier).filter(Boolean)).size

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const body = {
        org_id: orgId,
        name: form.name.trim(),
        tier: form.tier,
        home_currency: form.home_currency.trim().toUpperCase() || null,
        swift_bic: form.swift_bic.trim().toUpperCase() || null,
        is_active: form.is_active,
      }
      await api.createProvider(body)
      setCreateOpen(false)
      setForm({ name: '', tier: 'bank', home_currency: 'USD', swift_bic: '', is_active: true })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create provider')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProvider(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete provider')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="mt-1 text-sm text-slate-400">
            Banks, fintechs and FX specialists routing your cross-border payments.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New provider</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total providers" value={providers.length} tone="teal" />
        <Stat label="Active" value={activeCount} hint={`${providers.length - activeCount} inactive`} />
        <Stat label="Distinct tiers" value={tierCount} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SWIFT/BIC, currency…"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <Spinner className="py-16" label="Loading providers…" />
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              className="m-5"
              title={providers.length === 0 ? 'No providers yet' : 'No providers match your filters'}
              description={
                providers.length === 0
                  ? 'Add the banks and fintechs you send FX payments through to start tracking their markups.'
                  : 'Try clearing the search or filters above.'
              }
              action={
                providers.length === 0 ? (
                  <Button onClick={() => setCreateOpen(true)}>+ New provider</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Tier</TH>
                  <TH>Home currency</TH>
                  <TH>SWIFT / BIC</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/dashboard/providers/${p.id}`} className="font-medium text-orange-300 hover:text-orange-200">
                        {p.name}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={tierTone(p.tier)}>{p.tier ?? '—'}</Badge>
                    </TD>
                    <TD className="tabular-nums">{p.home_currency ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{p.swift_bic ?? '—'}</TD>
                    <TD>
                      {p.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/providers/${p.id}`}>
                          <Button variant="ghost" className="px-3 py-1.5">
                            View
                          </Button>
                        </Link>
                        <Button variant="ghost" className="px-3 py-1.5 text-rose-300 hover:text-rose-200" onClick={() => setDeleteTarget(p)}>
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
        open={createOpen}
        onClose={() => (submitting ? null : setCreateOpen(false))}
        title="New provider"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="provider-create-form" disabled={submitting || !form.name.trim()}>
              {submitting ? 'Creating…' : 'Create provider'}
            </Button>
          </div>
        }
      >
        <form id="provider-create-form" onSubmit={handleCreate} className="space-y-4">
          {formError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Acme Bank"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Tier</label>
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
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
                value={form.home_currency}
                onChange={(e) => setForm({ ...form, home_currency: e.target.value })}
                placeholder="USD"
                maxLength={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">SWIFT / BIC</label>
            <input
              value={form.swift_bic}
              onChange={(e) => setForm({ ...form, swift_bic: e.target.value })}
              placeholder="ACMEUS33"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-orange-500 focus:ring-orange-500"
            />
            Active
          </label>
        </form>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title="Delete provider"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{deleteTarget?.name}</span>? This removes the provider and may affect
          payments and reconciliations referencing it.
        </p>
      </Modal>
    </div>
  )
}
