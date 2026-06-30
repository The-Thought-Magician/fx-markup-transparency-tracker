// Same-origin relative calls to /api/proxy/... — the proxy route resolves the
// session and injects X-User-Id before forwarding to the backend /api/v1/...
// Every path after /api/proxy/ maps 1:1 to the backend path after /api/v1/.

type Query = Record<string, string | number | boolean | undefined | null>

function qs(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => req(path)
const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const put = (path: string, body?: unknown) =>
  req(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => req(path, { method: 'DELETE' })

const api = {
  // Organizations
  getOrgs: () => get('organizations'),
  getCurrentOrg: () => get('organizations/current'),
  getOrg: (id: string) => get(`organizations/${id}`),
  createOrg: (body: unknown) => post('organizations', body),
  updateOrg: (id: string, body: unknown) => put(`organizations/${id}`, body),
  getOrgMembers: (id: string) => get(`organizations/${id}/members`),
  addOrgMember: (id: string, body: unknown) => post(`organizations/${id}/members`, body),
  removeOrgMember: (id: string, memberId: string) => del(`organizations/${id}/members/${memberId}`),

  // Providers
  getProviders: (orgId?: string) => get(`providers${qs({ org_id: orgId })}`),
  getProvider: (id: string) => get(`providers/${id}`),
  createProvider: (body: unknown) => post('providers', body),
  updateProvider: (id: string, body: unknown) => put(`providers/${id}`, body),
  deleteProvider: (id: string) => del(`providers/${id}`),
  getFeeSchedules: (id: string) => get(`providers/${id}/fee-schedules`),
  addFeeSchedule: (id: string, body: unknown) => post(`providers/${id}/fee-schedules`, body),
  getProviderStats: (id: string) => get(`providers/${id}/stats`),

  // Corridors
  getCorridors: (orgId?: string) => get(`corridors${qs({ org_id: orgId })}`),
  getCorridor: (id: string) => get(`corridors/${id}`),
  createCorridor: (body: unknown) => post('corridors', body),
  updateCorridor: (id: string, body: unknown) => put(`corridors/${id}`, body),
  deleteCorridor: (id: string) => del(`corridors/${id}`),
  getCorridorStats: (id: string) => get(`corridors/${id}/stats`),

  // Benchmarks
  getBenchmarks: (base?: string, quote?: string) => get(`benchmarks${qs({ base, quote })}`),
  lookupBenchmark: (base: string, quote: string, at: string) => get(`benchmarks/lookup${qs({ base, quote, at })}`),
  createBenchmark: (body: unknown) => post('benchmarks', body),
  deleteBenchmark: (id: string) => del(`benchmarks/${id}`),
  backfillBenchmarks: (body: unknown) => post('benchmarks/backfill', body),

  // Rate sources
  getRateSources: (orgId?: string) => get(`rate-sources${qs({ org_id: orgId })}`),
  createRateSource: (body: unknown) => post('rate-sources', body),
  updateRateSource: (id: string, body: unknown) => put(`rate-sources/${id}`, body),
  deleteRateSource: (id: string) => del(`rate-sources/${id}`),

  // Payments
  getPayments: (query?: Query) => get(`payments${qs(query)}`),
  getPayment: (id: string) => get(`payments/${id}`),
  createPayment: (body: unknown) => post('payments', body),
  bulkCreatePayments: (body: unknown) => post('payments/bulk', body),
  updatePayment: (id: string, body: unknown) => put(`payments/${id}`, body),
  deletePayment: (id: string) => del(`payments/${id}`),
  decomposePayment: (id: string) => post(`payments/${id}/decompose`),
  getPaymentMarkup: (id: string) => get(`payments/${id}/markup`),

  // Wire fees
  getWireFees: (paymentId: string) => get(`wire-fees${qs({ payment_id: paymentId })}`),
  createWireFee: (body: unknown) => post('wire-fees', body),
  updateWireFee: (id: string, body: unknown) => put(`wire-fees/${id}`, body),
  deleteWireFee: (id: string) => del(`wire-fees/${id}`),

  // Reconciliation
  getReconciliations: (query?: Query) => get(`reconciliation${qs(query)}`),
  getReconciliation: (paymentId: string) => get(`reconciliation/${paymentId}`),
  runReconciliation: (body: unknown) => post('reconciliation/run', body),
  updateReconciliation: (id: string, body: unknown) => put(`reconciliation/${id}`, body),
  getReconVarianceByProvider: (orgId?: string) => get(`reconciliation/variance/by-provider${qs({ org_id: orgId })}`),

  // Imports
  getImports: (orgId?: string) => get(`imports${qs({ org_id: orgId })}`),
  getImport: (id: string) => get(`imports/${id}`),
  createImport: (body: unknown) => post('imports', body),
  commitImport: (id: string, body: unknown) => post(`imports/${id}/commit`, body),
  deleteImport: (id: string) => del(`imports/${id}`),
  getImportRows: (id: string) => get(`imports/${id}/rows`),

  // Mappings
  getMappings: (query?: Query) => get(`mappings${qs(query)}`),
  createMapping: (body: unknown) => post('mappings', body),
  updateMapping: (id: string, body: unknown) => put(`mappings/${id}`, body),
  deleteMapping: (id: string) => del(`mappings/${id}`),

  // Leaderboard
  getCorridorLeaderboard: (query?: Query) => get(`leaderboard/corridors${qs(query)}`),
  getProviderLeaderboard: (query?: Query) => get(`leaderboard/providers${qs(query)}`),
  createLeaderboardSnapshot: (body: unknown) => post('leaderboard/snapshots', body),
  getLeaderboardSnapshots: (query?: Query) => get(`leaderboard/snapshots${qs(query)}`),
  getLeaderboardMovers: (query?: Query) => get(`leaderboard/movers${qs(query)}`),

  // Ledger
  getLedgers: (orgId?: string) => get(`ledger${qs({ org_id: orgId })}`),
  getLedgerSummary: (query?: Query) => get(`ledger/summary${qs(query)}`),
  createLedger: (body: unknown) => post('ledger', body),
  deleteLedger: (id: string) => del(`ledger/${id}`),

  // Scenarios
  getScenarios: (orgId?: string) => get(`scenarios${qs({ org_id: orgId })}`),
  getScenario: (id: string) => get(`scenarios/${id}`),
  createScenario: (body: unknown) => post('scenarios', body),
  updateScenario: (id: string, body: unknown) => put(`scenarios/${id}`, body),
  deleteScenario: (id: string) => del(`scenarios/${id}`),
  addScenarioLeg: (id: string, body: unknown) => post(`scenarios/${id}/legs`, body),
  updateScenarioLeg: (id: string, legId: string, body: unknown) => put(`scenarios/${id}/legs/${legId}`, body),
  deleteScenarioLeg: (id: string, legId: string) => del(`scenarios/${id}/legs/${legId}`),

  // Targets
  getTargets: (orgId?: string) => get(`targets${qs({ org_id: orgId })}`),
  createTarget: (body: unknown) => post('targets', body),
  updateTarget: (id: string, body: unknown) => put(`targets/${id}`, body),
  deleteTarget: (id: string) => del(`targets/${id}`),
  getTargetVariance: (orgId?: string) => get(`targets/variance${qs({ org_id: orgId })}`),

  // Alerts
  getAlerts: (query?: Query) => get(`alerts${qs(query)}`),
  evaluateAlerts: (body: unknown) => post('alerts/evaluate', body),
  updateAlert: (id: string, body: unknown) => put(`alerts/${id}`, body),
  deleteAlert: (id: string) => del(`alerts/${id}`),
  getAlertRules: (orgId?: string) => get(`alerts/rules${qs({ org_id: orgId })}`),
  createAlertRule: (body: unknown) => post('alerts/rules', body),
  updateAlertRule: (id: string, body: unknown) => put(`alerts/rules/${id}`, body),
  deleteAlertRule: (id: string) => del(`alerts/rules/${id}`),

  // Reports
  getReports: (orgId?: string) => get(`reports${qs({ org_id: orgId })}`),
  getReport: (id: string) => get(`reports/${id}`),
  createReport: (body: unknown) => post('reports', body),
  generateReport: (id: string) => post(`reports/${id}/generate`),
  deleteReport: (id: string) => del(`reports/${id}`),
  getReportSchedules: (id: string) => get(`reports/${id}/schedules`),
  createReportSchedule: (id: string, body: unknown) => post(`reports/${id}/schedules`, body),
  deleteReportSchedule: (id: string, scheduleId: string) => del(`reports/${id}/schedules/${scheduleId}`),

  // Tags
  getTags: (orgId?: string) => get(`tags${qs({ org_id: orgId })}`),
  createTag: (body: unknown) => post('tags', body),
  deleteTag: (id: string) => del(`tags/${id}`),
  assignTag: (body: unknown) => post('tags/assign', body),
  unassignTag: (body: unknown) => post('tags/unassign', body),
  getTagRollups: (orgId?: string) => get(`tags/rollups${qs({ org_id: orgId })}`),

  // Activity
  getActivity: (query?: Query) => get(`activity${qs(query)}`),
  recordActivity: (body: unknown) => post('activity', body),

  // Notes
  getNotes: (entityType: string, entityId: string) => get(`notes${qs({ entity_type: entityType, entity_id: entityId })}`),
  createNote: (body: unknown) => post('notes', body),
  deleteNote: (id: string) => del(`notes/${id}`),

  // Widgets
  getWidgets: (orgId?: string) => get(`widgets${qs({ org_id: orgId })}`),
  createWidget: (body: unknown) => post('widgets', body),
  updateWidget: (id: string, body: unknown) => put(`widgets/${id}`, body),
  deleteWidget: (id: string) => del(`widgets/${id}`),

  // Dashboard
  getDashboardSummary: (orgId?: string) => get(`dashboard/summary${qs({ org_id: orgId })}`),
  getDashboardTrends: (query?: Query) => get(`dashboard/trends${qs(query)}`),
  getTopOffenders: (orgId?: string) => get(`dashboard/top-offenders${qs({ org_id: orgId })}`),

  // Seed
  seedSampleData: (body: unknown) => post('seed', body),
  resetSampleData: (body: unknown) => post('seed/reset', body),
  getSeedStatus: (orgId?: string) => get(`seed/status${qs({ org_id: orgId })}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => post('billing/checkout'),
  openBillingPortal: () => post('billing/portal'),
}

export default api
