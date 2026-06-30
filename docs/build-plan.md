# FxMarkupTransparencyTracker — Build Contract (Single Source of Truth)

This document is BINDING. Every filename, mount path, api method name, and page file declared here must be implemented exactly. Backend uses Hono + drizzle, mounts every domain router under `/api/v1` via a child `api` Hono router. Backend trusts the `X-User-Id` header and uses `getUserId(c)` everywhere. Public reads / auth-gated writes with zod validation and ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. Auth via `@neondatabase/auth@0.4.2-beta`; web uses `proxy.ts` only. Landing page is purely static.

All amounts in cents (integer). Rates and bps as `real`. Ownership scoping via `org_id` + `user_id` (creator) with `getUserId(c)` checks on writes.

---

## (a) Tables (columns)

- **organizations** — id, name, base_currency, owner_id, created_at
- **org_members** — id, org_id->organizations, user_id, role, created_at; UNIQUE(org_id,user_id)
- **providers** — id, org_id->organizations, user_id, name, tier, home_currency, swift_bic, is_active, created_at
- **provider_fee_schedules** — id, provider_id->providers, user_id, wire_fee_cents, stated_fx_fee_pct, lifting_charge_cents, lifting_policy, effective_date, is_current, created_at
- **corridors** — id, org_id->organizations, user_id, base_currency, quote_currency, label, is_active, created_at; UNIQUE(org_id,base_currency,quote_currency)
- **rate_sources** — id, org_id->organizations, user_id, name, kind, confidence, created_at
- **benchmark_rates** — id, org_id->organizations, user_id, source_id->rate_sources, base_currency, quote_currency, mid_rate, captured_at, created_at
- **payments** — id, org_id->organizations, user_id, provider_id->providers, corridor_id->corridors, reference, base_currency, quote_currency, notional_base, applied_rate, disclosed_fee_cents, value_date, benchmark_rate_id->benchmark_rates, status, created_at
- **payment_markups** — id, payment_id->payments (UNIQUE), user_id, mid_rate, applied_rate, markup_bps, hidden_spread_cents, disclosed_fee_cents, wire_fee_cents, total_cost_cents, effective_cost_pct, created_at
- **wire_fees** — id, payment_id->payments, user_id, kind, description, amount_cents, intermediary_bank, created_at
- **fee_reconciliations** — id, payment_id->payments (UNIQUE), user_id, expected_fee_cents, observed_fee_cents, variance_cents, status, notes, created_at
- **import_batches** — id, org_id->organizations, user_id, provider_id->providers, filename, format, status, row_count, error_count, created_at
- **import_rows** — id, batch_id->import_batches, user_id, raw(jsonb), normalized(jsonb), status, error, created_at
- **provider_mappings** — id, org_id->organizations, user_id, provider_id->providers, name, field_map(jsonb), created_at
- **corridor_leaderboard_snapshots** — id, org_id->organizations, user_id, period, rankings(jsonb), created_at
- **provider_leaderboard_snapshots** — id, org_id->organizations, user_id, period, rankings(jsonb), created_at
- **cost_ledgers** — id, org_id->organizations, user_id, period, total_notional_cents, total_markup_cents, total_fees_cents, annualized_leakage_cents, breakdown(jsonb), created_at
- **savings_scenarios** — id, org_id->organizations, user_id, name, description, target_markup_bps, current_leakage_cents, modeled_leakage_cents, projected_savings_cents, created_at
- **scenario_legs** — id, scenario_id->savings_scenarios, user_id, corridor_id->corridors, from_provider_id->providers, to_provider_id->providers, notional_cents, current_markup_bps, modeled_markup_bps, leg_savings_cents, created_at
- **benchmarks_targets** — id, org_id->organizations, user_id, corridor_id->corridors, target_markup_bps, created_at
- **alert_rules** — id, org_id->organizations, user_id, name, metric, comparator, threshold, is_enabled, created_at
- **alerts** — id, org_id->organizations, user_id, rule_id->alert_rules, payment_id->payments, message, severity, status, created_at
- **reports** — id, org_id->organizations, user_id, name, kind, config(jsonb), result(jsonb), created_at
- **report_schedules** — id, report_id->reports, user_id, cadence, recipient_email, is_enabled, created_at
- **tags** — id, org_id->organizations, user_id, name, color, created_at; UNIQUE(org_id,name)
- **payment_tags** — id, payment_id->payments, tag_id->tags, user_id, created_at; UNIQUE(payment_id,tag_id)
- **audit_events** — id, org_id->organizations, user_id, entity_type, entity_id, action, detail(jsonb), created_at
- **notes** — id, org_id->organizations, user_id, entity_type, entity_id, body, created_at
- **dashboards_widgets** — id, org_id->organizations, user_id, kind, title, config(jsonb), position, created_at
- **plans** — id(text 'free'/'pro'), name, price_cents, created_at
- **subscriptions** — id, user_id(UNIQUE), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

Common: list/get are public reads; POST/PUT/PATCH/DELETE require `authMiddleware` + zod + ownership check via `getUserId(c)`.

### 1. `organizations.ts` — mount `organizations`
- `GET /` — public — list orgs for header user (via membership) — Organization[]
- `GET /current` — auth — current/first org for user — Organization
- `GET /:id` — public — one org — Organization
- `POST /` — auth — create org (creator becomes owner + member) — Organization
- `PUT /:id` — auth(owner) — update org — Organization
- `GET /:id/members` — public — members of org — OrgMember[]
- `POST /:id/members` — auth(owner) — add member — OrgMember
- `DELETE /:id/members/:memberId` — auth(owner) — remove member — {success}

### 2. `providers.ts` — mount `providers`
- `GET /` — public — list providers (filter ?org_id) — Provider[]
- `GET /:id` — public — provider + current fee schedule — Provider
- `POST /` — auth — create provider — Provider
- `PUT /:id` — auth — update provider — Provider
- `DELETE /:id` — auth — delete provider — {success}
- `GET /:id/fee-schedules` — public — fee schedule history — FeeSchedule[]
- `POST /:id/fee-schedules` — auth — add fee schedule (marks prior not current) — FeeSchedule
- `GET /:id/stats` — public — aggregate markup/leakage for provider — ProviderStats

### 3. `corridors.ts` — mount `corridors`
- `GET /` — public — list corridors (?org_id) — Corridor[]
- `GET /:id` — public — corridor + stats — Corridor
- `POST /` — auth — create corridor — Corridor
- `PUT /:id` — auth — update corridor — Corridor
- `DELETE /:id` — auth — delete corridor — {success}
- `GET /:id/stats` — public — volume/leakage/avg markup — CorridorStats

### 4. `benchmarks.ts` — mount `benchmarks`
- `GET /` — public — list benchmark rates (?base&quote) — BenchmarkRate[]
- `GET /lookup` — public — nearest rate at time (?base&quote&at) — BenchmarkRate
- `POST /` — auth — capture a benchmark rate — BenchmarkRate
- `DELETE /:id` — auth — delete rate — {success}
- `POST /backfill` — auth — attach nearest benchmark to payments lacking one — {updated}

### 5. `rate-sources.ts` — mount `rate-sources`
- `GET /` — public — list sources (?org_id) — RateSource[]
- `POST /` — auth — create source — RateSource
- `PUT /:id` — auth — update source — RateSource
- `DELETE /:id` — auth — delete source — {success}

### 6. `payments.ts` — mount `payments`
- `GET /` — public — list payments (?org_id&provider_id&corridor_id) — Payment[]
- `GET /:id` — public — payment + markup + wire fees + reconciliation — PaymentDetail
- `POST /` — auth — create payment (auto-attach nearest benchmark, compute markup) — Payment
- `POST /bulk` — auth — create many payments — {created}
- `PUT /:id` — auth — update payment (recompute markup) — Payment
- `DELETE /:id` — auth — delete payment — {success}
- `POST /:id/decompose` — auth — recompute markup decomposition — PaymentMarkup
- `GET /:id/markup` — public — decomposition for a payment — PaymentMarkup

### 7. `wire-fees.ts` — mount `wire-fees`
- `GET /` — public — wire fees (?payment_id) — WireFee[]
- `POST /` — auth — add wire/lifting fee line — WireFee
- `PUT /:id` — auth — update fee line — WireFee
- `DELETE /:id` — auth — delete fee line — {success}

### 8. `reconciliation.ts` — mount `reconciliation`
- `GET /` — public — reconciliations (?org_id&status) — FeeReconciliation[]
- `GET /:paymentId` — public — reconciliation for a payment — FeeReconciliation
- `POST /run` — auth — run reconciliation for payments (compare schedule vs observed) — {reconciled}
- `PUT /:id` — auth — update reconciliation status/notes — FeeReconciliation
- `GET /variance/by-provider` — public — aggregate variance per provider (?org_id) — ProviderVariance[]

### 9. `imports.ts` — mount `imports`
- `GET /` — public — import batches (?org_id) — ImportBatch[]
- `GET /:id` — public — batch + rows — ImportBatchDetail
- `POST /` — auth — create batch + parse rows from payload — ImportBatch
- `POST /:id/commit` — auth — commit normalized rows into payments — {committed}
- `DELETE /:id` — auth — delete batch — {success}
- `GET /:id/rows` — public — import rows for batch — ImportRow[]

### 10. `mappings.ts` — mount `mappings`
- `GET /` — public — provider mappings (?org_id&provider_id) — ProviderMapping[]
- `POST /` — auth — create mapping — ProviderMapping
- `PUT /:id` — auth — update mapping — ProviderMapping
- `DELETE /:id` — auth — delete mapping — {success}

### 11. `leaderboard.ts` — mount `leaderboard`
- `GET /corridors` — public — live corridor markup ranking (?org_id&period) — CorridorRanking[]
- `GET /providers` — public — live provider markup ranking (?org_id&period) — ProviderRanking[]
- `POST /snapshots` — auth — persist a leaderboard snapshot (both) — {corridor,provider}
- `GET /snapshots` — public — saved snapshots (?org_id&kind) — LeaderboardSnapshot[]
- `GET /movers` — public — best/worst movers between latest two snapshots (?org_id&kind) — Movers

### 12. `ledger.ts` — mount `ledger`
- `GET /` — public — saved cost-ledger entries (?org_id) — CostLedger[]
- `GET /summary` — public — live annualized projection (?org_id&period) — LedgerSummary
- `POST /` — auth — compute + persist a ledger entry for a period — CostLedger
- `DELETE /:id` — auth — delete ledger entry — {success}

### 13. `scenarios.ts` — mount `scenarios`
- `GET /` — public — savings scenarios (?org_id) — SavingsScenario[]
- `GET /:id` — public — scenario + legs — ScenarioDetail
- `POST /` — auth — create scenario — SavingsScenario
- `PUT /:id` — auth — update scenario (recompute totals) — SavingsScenario
- `DELETE /:id` — auth — delete scenario + legs — {success}
- `POST /:id/legs` — auth — add leg (compute leg savings + scenario totals) — ScenarioLeg
- `PUT /:id/legs/:legId` — auth — update leg — ScenarioLeg
- `DELETE /:id/legs/:legId` — auth — delete leg — {success}

### 14. `targets.ts` — mount `targets`
- `GET /` — public — markup targets (?org_id) — Target[]
- `POST /` — auth — set target for corridor — Target
- `PUT /:id` — auth — update target — Target
- `DELETE /:id` — auth — delete target — {success}
- `GET /variance` — public — payments/corridors over target (?org_id) — TargetVariance[]

### 15. `alerts.ts` — mount `alerts`
- `GET /` — public — alerts (?org_id&status) — Alert[]
- `POST /evaluate` — auth — evaluate enabled rules, generate alerts — {generated}
- `PUT /:id` — auth — acknowledge/resolve alert — Alert
- `DELETE /:id` — auth — delete alert — {success}
- `GET /rules` — public — alert rules (?org_id) — AlertRule[]
- `POST /rules` — auth — create rule — AlertRule
- `PUT /rules/:id` — auth — update rule (toggle enable) — AlertRule
- `DELETE /rules/:id` — auth — delete rule — {success}

### 16. `reports.ts` — mount `reports`
- `GET /` — public — saved reports (?org_id) — Report[]
- `GET /:id` — public — one report — Report
- `POST /` — auth — create + generate report — Report
- `POST /:id/generate` — auth — regenerate report result — Report
- `DELETE /:id` — auth — delete report — {success}
- `GET /:id/schedules` — public — schedules for report — ReportSchedule[]
- `POST /:id/schedules` — auth — create schedule — ReportSchedule
- `DELETE /:id/schedules/:scheduleId` — auth — delete schedule — {success}

### 17. `tags.ts` — mount `tags`
- `GET /` — public — tags (?org_id) — Tag[]
- `POST /` — auth — create tag — Tag
- `DELETE /:id` — auth — delete tag — {success}
- `POST /assign` — auth — assign tag to payment — PaymentTag
- `POST /unassign` — auth — remove tag from payment — {success}
- `GET /rollups` — public — leakage per tag (?org_id) — TagRollup[]

### 18. `activity.ts` — mount `activity`
- `GET /` — public — audit events feed (?org_id&entity_type) — AuditEvent[]
- `POST /` — auth — record an audit event — AuditEvent

### 19. `notes.ts` — mount `notes`
- `GET /` — public — notes for an entity (?entity_type&entity_id) — Note[]
- `POST /` — auth — create note — Note
- `DELETE /:id` — auth — delete note — {success}

### 20. `widgets.ts` — mount `widgets`
- `GET /` — public — dashboard widgets (?org_id) — Widget[]
- `POST /` — auth — create widget — Widget
- `PUT /:id` — auth — update widget — Widget
- `DELETE /:id` — auth — delete widget — {success}

### 21. `dashboard.ts` — mount `dashboard`
- `GET /summary` — public — headline KPIs: total leakage, avg markup bps, annualized projection, payment count (?org_id) — DashboardSummary
- `GET /trends` — public — markup-over-time series (?org_id&period) — TrendPoint[]
- `GET /top-offenders` — public — top corridors/providers by leakage (?org_id) — TopOffenders

### 22. `seed.ts` — mount `seed`
- `POST /` — auth — seed sample org/providers/corridors/rates/payments for the user — {seeded}
- `POST /reset` — auth — clear seeded data for the user's org — {cleared}
- `GET /status` — public — whether sample data exists (?org_id) — {seeded:boolean,counts}

### 23. `billing.ts` — mount `billing`
- `GET /plan` — auth — subscription + plan + stripeEnabled — {subscription,plan,stripeEnabled}
- `POST /checkout` — auth — Stripe checkout (503 if unconfigured) — {url}
- `POST /portal` — auth — Stripe billing portal (503 if unconfigured) — {url}
- `POST /webhook` — public — Stripe webhook (503 if unconfigured) — {received}

---

## (c) `web/lib/api.ts` method list (relative `/api/proxy/...`)

Organizations:
- `getOrgs()` GET `/api/proxy/organizations`
- `getCurrentOrg()` GET `/api/proxy/organizations/current`
- `getOrg(id)` GET `/api/proxy/organizations/:id`
- `createOrg(body)` POST `/api/proxy/organizations`
- `updateOrg(id, body)` PUT `/api/proxy/organizations/:id`
- `getOrgMembers(id)` GET `/api/proxy/organizations/:id/members`
- `addOrgMember(id, body)` POST `/api/proxy/organizations/:id/members`
- `removeOrgMember(id, memberId)` DELETE `/api/proxy/organizations/:id/members/:memberId`

Providers:
- `getProviders(orgId?)` GET `/api/proxy/providers`
- `getProvider(id)` GET `/api/proxy/providers/:id`
- `createProvider(body)` POST `/api/proxy/providers`
- `updateProvider(id, body)` PUT `/api/proxy/providers/:id`
- `deleteProvider(id)` DELETE `/api/proxy/providers/:id`
- `getFeeSchedules(id)` GET `/api/proxy/providers/:id/fee-schedules`
- `addFeeSchedule(id, body)` POST `/api/proxy/providers/:id/fee-schedules`
- `getProviderStats(id)` GET `/api/proxy/providers/:id/stats`

Corridors:
- `getCorridors(orgId?)` GET `/api/proxy/corridors`
- `getCorridor(id)` GET `/api/proxy/corridors/:id`
- `createCorridor(body)` POST `/api/proxy/corridors`
- `updateCorridor(id, body)` PUT `/api/proxy/corridors/:id`
- `deleteCorridor(id)` DELETE `/api/proxy/corridors/:id`
- `getCorridorStats(id)` GET `/api/proxy/corridors/:id/stats`

Benchmarks:
- `getBenchmarks(base?, quote?)` GET `/api/proxy/benchmarks`
- `lookupBenchmark(base, quote, at)` GET `/api/proxy/benchmarks/lookup`
- `createBenchmark(body)` POST `/api/proxy/benchmarks`
- `deleteBenchmark(id)` DELETE `/api/proxy/benchmarks/:id`
- `backfillBenchmarks(body)` POST `/api/proxy/benchmarks/backfill`

Rate sources:
- `getRateSources(orgId?)` GET `/api/proxy/rate-sources`
- `createRateSource(body)` POST `/api/proxy/rate-sources`
- `updateRateSource(id, body)` PUT `/api/proxy/rate-sources/:id`
- `deleteRateSource(id)` DELETE `/api/proxy/rate-sources/:id`

Payments:
- `getPayments(query?)` GET `/api/proxy/payments`
- `getPayment(id)` GET `/api/proxy/payments/:id`
- `createPayment(body)` POST `/api/proxy/payments`
- `bulkCreatePayments(body)` POST `/api/proxy/payments/bulk`
- `updatePayment(id, body)` PUT `/api/proxy/payments/:id`
- `deletePayment(id)` DELETE `/api/proxy/payments/:id`
- `decomposePayment(id)` POST `/api/proxy/payments/:id/decompose`
- `getPaymentMarkup(id)` GET `/api/proxy/payments/:id/markup`

Wire fees:
- `getWireFees(paymentId)` GET `/api/proxy/wire-fees`
- `createWireFee(body)` POST `/api/proxy/wire-fees`
- `updateWireFee(id, body)` PUT `/api/proxy/wire-fees/:id`
- `deleteWireFee(id)` DELETE `/api/proxy/wire-fees/:id`

Reconciliation:
- `getReconciliations(query?)` GET `/api/proxy/reconciliation`
- `getReconciliation(paymentId)` GET `/api/proxy/reconciliation/:paymentId`
- `runReconciliation(body)` POST `/api/proxy/reconciliation/run`
- `updateReconciliation(id, body)` PUT `/api/proxy/reconciliation/:id`
- `getReconVarianceByProvider(orgId?)` GET `/api/proxy/reconciliation/variance/by-provider`

Imports:
- `getImports(orgId?)` GET `/api/proxy/imports`
- `getImport(id)` GET `/api/proxy/imports/:id`
- `createImport(body)` POST `/api/proxy/imports`
- `commitImport(id, body)` POST `/api/proxy/imports/:id/commit`
- `deleteImport(id)` DELETE `/api/proxy/imports/:id`
- `getImportRows(id)` GET `/api/proxy/imports/:id/rows`

Mappings:
- `getMappings(query?)` GET `/api/proxy/mappings`
- `createMapping(body)` POST `/api/proxy/mappings`
- `updateMapping(id, body)` PUT `/api/proxy/mappings/:id`
- `deleteMapping(id)` DELETE `/api/proxy/mappings/:id`

Leaderboard:
- `getCorridorLeaderboard(query?)` GET `/api/proxy/leaderboard/corridors`
- `getProviderLeaderboard(query?)` GET `/api/proxy/leaderboard/providers`
- `createLeaderboardSnapshot(body)` POST `/api/proxy/leaderboard/snapshots`
- `getLeaderboardSnapshots(query?)` GET `/api/proxy/leaderboard/snapshots`
- `getLeaderboardMovers(query?)` GET `/api/proxy/leaderboard/movers`

Ledger:
- `getLedgers(orgId?)` GET `/api/proxy/ledger`
- `getLedgerSummary(query?)` GET `/api/proxy/ledger/summary`
- `createLedger(body)` POST `/api/proxy/ledger`
- `deleteLedger(id)` DELETE `/api/proxy/ledger/:id`

Scenarios:
- `getScenarios(orgId?)` GET `/api/proxy/scenarios`
- `getScenario(id)` GET `/api/proxy/scenarios/:id`
- `createScenario(body)` POST `/api/proxy/scenarios`
- `updateScenario(id, body)` PUT `/api/proxy/scenarios/:id`
- `deleteScenario(id)` DELETE `/api/proxy/scenarios/:id`
- `addScenarioLeg(id, body)` POST `/api/proxy/scenarios/:id/legs`
- `updateScenarioLeg(id, legId, body)` PUT `/api/proxy/scenarios/:id/legs/:legId`
- `deleteScenarioLeg(id, legId)` DELETE `/api/proxy/scenarios/:id/legs/:legId`

Targets:
- `getTargets(orgId?)` GET `/api/proxy/targets`
- `createTarget(body)` POST `/api/proxy/targets`
- `updateTarget(id, body)` PUT `/api/proxy/targets/:id`
- `deleteTarget(id)` DELETE `/api/proxy/targets/:id`
- `getTargetVariance(orgId?)` GET `/api/proxy/targets/variance`

Alerts:
- `getAlerts(query?)` GET `/api/proxy/alerts`
- `evaluateAlerts(body)` POST `/api/proxy/alerts/evaluate`
- `updateAlert(id, body)` PUT `/api/proxy/alerts/:id`
- `deleteAlert(id)` DELETE `/api/proxy/alerts/:id`
- `getAlertRules(orgId?)` GET `/api/proxy/alerts/rules`
- `createAlertRule(body)` POST `/api/proxy/alerts/rules`
- `updateAlertRule(id, body)` PUT `/api/proxy/alerts/rules/:id`
- `deleteAlertRule(id)` DELETE `/api/proxy/alerts/rules/:id`

Reports:
- `getReports(orgId?)` GET `/api/proxy/reports`
- `getReport(id)` GET `/api/proxy/reports/:id`
- `createReport(body)` POST `/api/proxy/reports`
- `generateReport(id)` POST `/api/proxy/reports/:id/generate`
- `deleteReport(id)` DELETE `/api/proxy/reports/:id`
- `getReportSchedules(id)` GET `/api/proxy/reports/:id/schedules`
- `createReportSchedule(id, body)` POST `/api/proxy/reports/:id/schedules`
- `deleteReportSchedule(id, scheduleId)` DELETE `/api/proxy/reports/:id/schedules/:scheduleId`

Tags:
- `getTags(orgId?)` GET `/api/proxy/tags`
- `createTag(body)` POST `/api/proxy/tags`
- `deleteTag(id)` DELETE `/api/proxy/tags/:id`
- `assignTag(body)` POST `/api/proxy/tags/assign`
- `unassignTag(body)` POST `/api/proxy/tags/unassign`
- `getTagRollups(orgId?)` GET `/api/proxy/tags/rollups`

Activity:
- `getActivity(query?)` GET `/api/proxy/activity`
- `recordActivity(body)` POST `/api/proxy/activity`

Notes:
- `getNotes(entityType, entityId)` GET `/api/proxy/notes`
- `createNote(body)` POST `/api/proxy/notes`
- `deleteNote(id)` DELETE `/api/proxy/notes/:id`

Widgets:
- `getWidgets(orgId?)` GET `/api/proxy/widgets`
- `createWidget(body)` POST `/api/proxy/widgets`
- `updateWidget(id, body)` PUT `/api/proxy/widgets/:id`
- `deleteWidget(id)` DELETE `/api/proxy/widgets/:id`

Dashboard:
- `getDashboardSummary(orgId?)` GET `/api/proxy/dashboard/summary`
- `getDashboardTrends(query?)` GET `/api/proxy/dashboard/trends`
- `getTopOffenders(orgId?)` GET `/api/proxy/dashboard/top-offenders`

Seed:
- `seedSampleData(body)` POST `/api/proxy/seed`
- `resetSampleData(body)` POST `/api/proxy/seed/reset`
- `getSeedStatus(orgId?)` GET `/api/proxy/seed/status`

Billing:
- `getBillingPlan()` GET `/api/proxy/billing/plan`
- `startCheckout()` POST `/api/proxy/billing/checkout`
- `openBillingPortal()` POST `/api/proxy/billing/portal`

---

## (d) Pages

| URL | File (under web/) | Kind | API methods used | Renders |
|-----|-------------------|------|------------------|---------|
| `/` | `app/page.tsx` | public | (none) | Static landing: hero, problem, feature grid, CTAs |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | Sign-in form |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | Sign-up form |
| `/pricing` | `app/pricing/page.tsx` | public | (none) | Static Free/Pro plan cards |
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | getCurrentOrg, getDashboardSummary, getDashboardTrends, getTopOffenders, getAlerts | KPI cards, trend chart, top offenders, recent alerts |
| `/dashboard/payments` | `app/dashboard/payments/page.tsx` | dashboard | getPayments, createPayment, deletePayment, getProviders, getCorridors | Payments table + create form + filters |
| `/dashboard/payments/[id]` | `app/dashboard/payments/[id]/page.tsx` | dashboard | getPayment, decomposePayment, getWireFees, createWireFee, deleteWireFee, getReconciliation, getNotes, createNote | Decomposition breakdown, wire fees, reconciliation, notes |
| `/dashboard/providers` | `app/dashboard/providers/page.tsx` | dashboard | getProviders, createProvider, deleteProvider | Providers list + create |
| `/dashboard/providers/[id]` | `app/dashboard/providers/[id]/page.tsx` | dashboard | getProvider, updateProvider, getFeeSchedules, addFeeSchedule, getProviderStats, getNotes, createNote | Provider detail, fee schedules, stats, notes |
| `/dashboard/corridors` | `app/dashboard/corridors/page.tsx` | dashboard | getCorridors, createCorridor, updateCorridor, deleteCorridor, getCorridorStats | Corridors list + create + per-corridor stats |
| `/dashboard/benchmarks` | `app/dashboard/benchmarks/page.tsx` | dashboard | getBenchmarks, createBenchmark, deleteBenchmark, lookupBenchmark, backfillBenchmarks, getRateSources, createRateSource, updateRateSource, deleteRateSource | Benchmark rates table, capture form, lookup, sources panel |
| `/dashboard/leaderboard` | `app/dashboard/leaderboard/page.tsx` | dashboard | getCorridorLeaderboard, getProviderLeaderboard, createLeaderboardSnapshot, getLeaderboardSnapshots, getLeaderboardMovers | Corridor & provider rankings, snapshot, movers |
| `/dashboard/reconciliation` | `app/dashboard/reconciliation/page.tsx` | dashboard | getReconciliations, runReconciliation, updateReconciliation, getReconVarianceByProvider | Reconciliation list, run, status workflow, provider variance |
| `/dashboard/ledger` | `app/dashboard/ledger/page.tsx` | dashboard | getLedgers, getLedgerSummary, createLedger, deleteLedger | Annualized projection summary + saved ledger entries |
| `/dashboard/scenarios` | `app/dashboard/scenarios/page.tsx` | dashboard | getScenarios, createScenario, deleteScenario | Scenarios list + create |
| `/dashboard/scenarios/[id]` | `app/dashboard/scenarios/[id]/page.tsx` | dashboard | getScenario, updateScenario, addScenarioLeg, updateScenarioLeg, deleteScenarioLeg, getCorridors, getProviders | Scenario detail, legs editor, projected savings |
| `/dashboard/imports` | `app/dashboard/imports/page.tsx` | dashboard | getImports, createImport, deleteImport, getProviders | Import batches list + upload form |
| `/dashboard/imports/[id]` | `app/dashboard/imports/[id]/page.tsx` | dashboard | getImport, getImportRows, commitImport, getMappings, createMapping, updateMapping, deleteMapping | Import rows preview, mapping editor, commit |
| `/dashboard/targets` | `app/dashboard/targets/page.tsx` | dashboard | getTargets, createTarget, updateTarget, deleteTarget, getTargetVariance, getCorridors | Targets per corridor + variance flags |
| `/dashboard/alerts` | `app/dashboard/alerts/page.tsx` | dashboard | getAlerts, evaluateAlerts, updateAlert, deleteAlert, getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule | Alerts feed + rules editor + evaluate |
| `/dashboard/reports` | `app/dashboard/reports/page.tsx` | dashboard | getReports, createReport, generateReport, deleteReport, getReportSchedules, createReportSchedule, deleteReportSchedule | Reports list, generate, schedules |
| `/dashboard/tags` | `app/dashboard/tags/page.tsx` | dashboard | getTags, createTag, deleteTag, getTagRollups | Tags management + leakage rollups |
| `/dashboard/activity` | `app/dashboard/activity/page.tsx` | dashboard | getActivity | Activity/audit feed with filters |
| `/dashboard/seed` | `app/dashboard/seed/page.tsx` | dashboard | getSeedStatus, seedSampleData, resetSampleData | Seeder controls + status |
| `/settings` | `app/settings/page.tsx` | dashboard | getCurrentOrg, updateOrg, getOrgMembers, addOrgMember, removeOrgMember, getBillingPlan, startCheckout, openBillingPortal, getWidgets, createWidget, updateWidget, deleteWidget | Org settings, members, billing, dashboard widgets |

Note: `recordActivity` is called server-side from write handlers and also available; it is consumed by the activity surface indirectly. The `getDashboardSummary`/widgets coverage is satisfied above. Every other api method maps to exactly one endpoint and is consumed by at least one page.

---

## (e) DashboardLayout sidebar nav sections

`web/app/dashboard/layout.tsx` wraps all `/dashboard/*` in `components/DashboardLayout.tsx` (client, `<aside>` sidebar, active state via `usePathname()`). `/settings` is reachable from the sidebar footer. Sections:

- **Overview**
  - Dashboard → `/dashboard`
- **Payments**
  - Payments → `/dashboard/payments`
  - Reconciliation → `/dashboard/reconciliation`
- **Analysis**
  - Leaderboard → `/dashboard/leaderboard`
  - Cost Ledger → `/dashboard/ledger`
  - Scenarios → `/dashboard/scenarios`
  - Targets → `/dashboard/targets`
- **Reference Data**
  - Providers → `/dashboard/providers`
  - Corridors → `/dashboard/corridors`
  - Benchmarks → `/dashboard/benchmarks`
- **Data & Imports**
  - Imports → `/dashboard/imports`
  - Sample Data → `/dashboard/seed`
- **Monitoring**
  - Alerts → `/dashboard/alerts`
  - Reports → `/dashboard/reports`
  - Tags → `/dashboard/tags`
  - Activity → `/dashboard/activity`
- **Footer**
  - Settings → `/settings`
  - Sign out (authClient.signOut)

---

## Markup math (canonical, deterministic)

Given a payment with `notional_base`, `applied_rate`, `disclosed_fee_cents`, and a benchmark `mid_rate` for the same pair near `value_date`:
- `markup_bps = ((mid_rate - applied_rate) / mid_rate) * 10000` (positive = customer received fewer quote units than mid).
- `quote_received_applied = notional_base * applied_rate`; `quote_at_mid = notional_base * mid_rate`.
- `hidden_spread_quote = quote_at_mid - quote_received_applied`; convert to base via `/ mid_rate`, then `hidden_spread_cents = round(hidden_spread_base * 100)`.
- `wire_fee_cents` = sum of `wire_fees.amount_cents` for the payment (incl. lifting charges).
- `total_cost_cents = disclosed_fee_cents + hidden_spread_cents + wire_fee_cents`.
- `effective_cost_pct = total_cost_cents / (notional_base * 100) * 100`.
Reconciliation: `expected_fee_cents` from provider current fee schedule (wire_fee + lifting + stated_fx_fee_pct*notional), `observed_fee_cents` = disclosed_fee + summed wire fees; `variance_cents = observed - expected`.
