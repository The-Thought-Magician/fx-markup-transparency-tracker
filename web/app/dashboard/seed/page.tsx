'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'

interface SeedStatus {
  seeded: boolean
  counts?: Record<string, number>
}

const COUNT_LABELS: Record<string, string> = {
  providers: 'Providers',
  corridors: 'Corridors',
  rate_sources: 'Rate sources',
  benchmark_rates: 'Benchmark rates',
  benchmarks: 'Benchmark rates',
  payments: 'Payments',
  wire_fees: 'Wire fees',
  reconciliations: 'Reconciliations',
  fee_reconciliations: 'Reconciliations',
  scenarios: 'Scenarios',
  targets: 'Targets',
  alerts: 'Alerts',
  alert_rules: 'Alert rules',
  reports: 'Reports',
  tags: 'Tags',
  ledgers: 'Ledger entries',
  cost_ledgers: 'Ledger entries',
}

function labelFor(key: string): string {
  return COUNT_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function SeedPage() {
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [orgName, setOrgName] = useState<string>('')
  const [status, setStatus] = useState<SeedStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const org = await api.getCurrentOrg()
      const oid = org?.id as string | undefined
      setOrgId(oid)
      setOrgName((org?.name as string) ?? '')
      const st = await api.getSeedStatus(oid)
      setStatus(st && typeof st === 'object' ? (st as SeedStatus) : { seeded: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load seed status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refreshStatus = useCallback(async () => {
    try {
      const st = await api.getSeedStatus(orgId)
      setStatus(st && typeof st === 'object' ? (st as SeedStatus) : { seeded: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh status')
    }
  }, [orgId])

  const counts = useMemo(() => {
    const c = status?.counts ?? {}
    return Object.entries(c).filter(([, v]) => typeof v === 'number')
  }, [status])

  const totalRecords = useMemo(() => counts.reduce((sum, [, v]) => sum + v, 0), [counts])

  async function handleSeed() {
    setSeeding(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.seedSampleData({ org_id: orgId })
      const seededCount =
        (res && (res.seeded ?? res.count ?? res.created)) != null
          ? (res.seeded ?? res.count ?? res.created)
          : null
      setNotice(
        seededCount != null
          ? `Sample data seeded — ${typeof seededCount === 'number' ? `${seededCount} records` : 'done'}.`
          : 'Sample data seeded successfully.',
      )
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    setError(null)
    setNotice(null)
    try {
      await api.resetSampleData({ org_id: orgId })
      setNotice('Sample data cleared.')
      setConfirmReset(false)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset sample data')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading seed status…" />
      </div>
    )
  }

  const isSeeded = !!status?.seeded || totalRecords > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Sample data</h1>
          <p className="mt-1 text-sm text-slate-400">
            Populate {orgName ? <span className="text-slate-200">{orgName}</span> : 'your organization'} with a
            realistic FX-payment dataset so every dashboard, leaderboard, and reconciliation view comes alive.
          </p>
        </div>
        <Button variant="secondary" onClick={refreshStatus} disabled={seeding || resetting}>
          Refresh status
        </Button>
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Status"
          value={isSeeded ? 'Seeded' : 'Empty'}
          tone={isSeeded ? 'green' : 'default'}
          hint={isSeeded ? 'Sample data present' : 'No sample data yet'}
        />
        <Stat label="Total records" value={totalRecords} tone={totalRecords > 0 ? 'teal' : 'default'} />
        <Stat label="Entity types" value={counts.length} />
        <Stat
          label="Organization"
          value={<span className="text-base">{orgName || '—'}</span>}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Seeder controls */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Seeder controls</h2>
            <p className="text-xs text-slate-500">Generate or clear the sample dataset for this org.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Current state:</span>
              <Badge tone={isSeeded ? 'green' : 'slate'}>{isSeeded ? 'Seeded' : 'Empty'}</Badge>
            </div>

            <div className="space-y-2">
              <Button onClick={handleSeed} disabled={seeding || resetting} className="w-full">
                {seeding ? 'Seeding…' : isSeeded ? 'Re-seed sample data' : 'Seed sample data'}
              </Button>
              <p className="text-xs text-slate-500">
                Creates providers, corridors, rate sources, benchmark rates, and payments with computed markups.
              </p>
            </div>

            <div className="border-t border-slate-800 pt-4">
              {!confirmReset ? (
                <Button
                  variant="danger"
                  onClick={() => setConfirmReset(true)}
                  disabled={resetting || seeding || !isSeeded}
                  className="w-full"
                >
                  Reset sample data
                </Button>
              ) : (
                <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                  <p className="text-sm text-rose-200">
                    This permanently deletes all sample records for this org. Continue?
                  </p>
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={handleReset} disabled={resetting} className="flex-1">
                      {resetting ? 'Resetting…' : 'Yes, delete'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Reset is disabled when there is no sample data to clear.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Dataset breakdown</h2>
            <p className="text-xs text-slate-500">Record counts per entity in the current sample dataset.</p>
          </CardHeader>
          <CardBody>
            {counts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-10 text-center">
                <div className="mb-2 text-3xl text-slate-600">∅</div>
                <h3 className="text-sm font-semibold text-slate-200">No sample data present</h3>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Use the seeder to generate a complete FX dataset and explore the full platform instantly.
                </p>
                <div className="mt-4">
                  <Button onClick={handleSeed} disabled={seeding}>
                    {seeding ? 'Seeding…' : 'Seed now'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {counts
                  .slice()
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3"
                    >
                      <div className="text-2xl font-bold tabular-nums text-orange-300">{value}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{labelFor(key)}</div>
                    </div>
                  ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">What gets created</h2>
        </CardHeader>
        <CardBody>
          <ul className="grid grid-cols-1 gap-2 text-sm text-slate-400 sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              Multiple FX providers across tiers, each with current fee schedules.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              Common currency corridors (USD/EUR, GBP/USD, USD/INR, and more).
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              Rate sources and time-stamped benchmark mid-rates.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              Payments with applied rates, disclosed fees, and computed hidden-spread markups.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}
