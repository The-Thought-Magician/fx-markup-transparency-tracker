# FxMarkupTransparencyTracker

## Overview

FxMarkupTransparencyTracker decomposes every cross-border payment a company makes into its true component parts: the mid-market reference rate at transaction time, the disclosed FX fee, and — critically — the **embedded rate markup** the bank or processor silently baked into the exchange rate. That hidden spread, typically 1-3% of notional, is invisible on the wire confirmation and recurring on every payment. The platform surfaces it as a quantified, recoverable cost, then arms treasury teams with per-corridor and per-provider leaderboards, annualized cost projections, and re-routing scenarios they can take into bank renegotiations.

The product is a deterministic analysis engine over uploaded bank confirmations, connected processor FX statements, and a built-in realistic sample-data seeder for instant demoability. Every payment is benchmarked against the captured mid-market rate to compute the implied all-in cost, the markup in basis points, and the dollar leakage. All features are free for signed-in users; Stripe billing is wired but optional (returns 503 when unconfigured).

## Problem

Cross-border payments quote a single exchange rate. Inside that rate sits a markup the provider never itemizes. A treasury team paying a EUR vendor sees "1.0820 EUR/USD" on the confirmation, but the mid-market rate that minute was 1.0905 — an 0.78% hidden spread on top of the $25 stated wire fee. Across hundreds of payments a year this compounds into six- and seven-figure recoverable cost. Because it is buried in the rate, it never shows up in spend analytics, never gets attributed to a provider, and never enters a renegotiation conversation. There is no tooling that captures the reference rate at transaction time and decomposes the spread per payment, per corridor, per provider.

## Target Users

- **Treasury managers** at companies making frequent cross-border vendor, payroll, and contractor payments, with budget authority over banking and processor relationships.
- **Finance-ops leads** running cost reviews who need defensible, transaction-level evidence of FX leakage.
- **Controllers and FP&A** building annualized cost models and re-routing business cases.
- **Procurement / vendor-relations** teams renegotiating banking contracts who need a quantified spread lever.

## Why This Is NOT an Existing Project

Near-neighbors and why this is distinct:

- **multi-currency-accounting / exchange-rate-api**: those store rates and do bookkeeping (booking transactions in multiple currencies, fetching spot rates). They do not decompose the *markup* on actual executed transactions versus the mid-market benchmark captured at transaction time. We treat the embedded spread as a recoverable cost line item.
- **sla-credit-recovery-desk / discount-leakage-ledger**: base siblings that recover SLA credits and contractual discount leakage. Different cost category entirely — ours is FX rate spread on wires.
- **interchange-leakage-auditor**: audits card interchange fees. Card rails, not cross-border wire/SWIFT FX spread.
- **settlement-funding-reconciler**: reconciles card settlement funding timing. Settlement timing, not FX markup decomposition.

The unique core: capturing the **mid-market reference rate at transaction time** and decomposing the **embedded FX markup** on each real cross-border payment into disclosed fee vs. hidden spread, attributed by corridor and provider, projected to annualized recoverable dollars. No sibling does rate-time benchmark capture plus per-payment spread decomposition plus re-routing savings modeling.

## Data Model (tables)

- **organizations** — tenant/company record (workspace).
- **org_members** — user-to-organization membership and role.
- **providers** — banks and payment processors used for cross-border payments.
- **provider_fee_schedules** — disclosed fee terms per provider (wire fee, stated FX fee %, lifting charge policy).
- **corridors** — currency-pair routes (e.g. USD->EUR) with base and quote currency.
- **benchmark_rates** — captured mid-market reference rates by currency pair and timestamp.
- **rate_sources** — origins of benchmark rates (manual, sample feed, imported).
- **payments** — individual cross-border payments with notional, rate applied, fees, provider, corridor.
- **payment_markups** — computed decomposition per payment (mid rate, implied rate, markup bps, hidden spread $, total cost).
- **wire_fees** — itemized wire/SWIFT charges incl. correspondent-bank lifting charges per payment.
- **fee_reconciliations** — reconciliation status of disclosed vs. observed fees per payment.
- **import_batches** — uploaded statement/confirmation files and parse status.
- **import_rows** — normalized rows extracted from an import batch.
- **provider_mappings** — column/field mappings normalizing each provider's statement format.
- **corridor_leaderboard_snapshots** — periodic aggregated markup rankings by corridor.
- **provider_leaderboard_snapshots** — periodic aggregated markup rankings by provider.
- **cost_ledgers** — annualized FX-cost ledger entries projecting spend and leakage.
- **savings_scenarios** — re-routing scenarios modeling savings from moving volume.
- **scenario_legs** — per-corridor/provider legs within a savings scenario.
- **benchmarks_targets** — target markup bps per corridor used for variance flagging.
- **alerts** — markup threshold breach and anomaly alerts.
- **alert_rules** — user-defined alert thresholds.
- **reports** — saved/generated decomposition and savings reports.
- **report_schedules** — scheduled report deliveries.
- **tags** — labels applied to payments/corridors for grouping.
- **payment_tags** — join of payments to tags.
- **audit_events** — activity log of imports, edits, and computations.
- **notes** — free-text annotations on payments, providers, corridors.
- **dashboards_widgets** — saved dashboard widget configs.
- **plans** — billing plans (free/pro).
- **subscriptions** — per-user subscription state.

## API Surface (high level)

- Organizations & members CRUD, current-org context.
- Providers CRUD + fee schedules.
- Corridors CRUD.
- Benchmark rates ingest/list/lookup-at-time; rate sources.
- Payments CRUD + bulk; per-payment markup decomposition.
- Wire fee itemization incl. lifting charges.
- Fee reconciliation run + status.
- Import batches upload/parse/commit; import rows; provider mappings.
- Corridor leaderboard; provider leaderboard.
- Cost ledger (annualized projection).
- Savings scenarios + legs (re-routing modeling).
- Markup targets; alerts + alert rules.
- Reports + schedules.
- Tags + payment tagging.
- Audit events; notes.
- Dashboard widgets / summary stats.
- Sample-data seeder.
- Billing (plan, checkout, portal, webhook).

## Major Features

### 1. Mid-Market Benchmark Capture
- Store the reference mid-market rate at transaction time per currency pair.
- Multiple rate sources (manual entry, sample feed, imported snapshots).
- Point-in-time rate lookup: given a pair and timestamp, return the nearest captured benchmark.
- Rate history timeline per currency pair.
- Source provenance and confidence flag on each captured rate.
- Backfill captured rates for historical payments lacking a benchmark.

### 2. Hidden-Spread Calculator
- Separate the disclosed FX fee from the embedded rate markup on each payment.
- Compute implied all-in rate = applied rate vs. mid rate.
- Markup in basis points and as a dollar amount on notional.
- All-in cost = disclosed fee + hidden spread + wire/lifting charges.
- Effective cost percentage of notional.
- Recompute decomposition when a benchmark is added or corrected.

### 3. Per-Corridor & Per-Provider Markup Leaderboard
- Rank corridors by average markup bps and total leakage.
- Rank providers by average markup bps and total leakage.
- Volume-weighted vs. simple-average views.
- Period filters (month, quarter, year).
- Snapshot persistence for trend comparison.
- Best/worst movers between snapshots.

### 4. Wire & SWIFT Fee Reconciliation
- Itemize wire fees including correspondent-bank lifting charges.
- Reconcile disclosed fee schedule vs. observed charges per payment.
- Flag overcharges and undisclosed deductions.
- Lifting-charge attribution across intermediary banks.
- Reconciliation status workflow (open, matched, disputed, resolved).
- Aggregate reconciliation variance by provider.

### 5. Annualized FX-Cost Ledger
- Project annualized FX cost from observed payment cadence.
- Total notional, total markup, total fees per period.
- Per-corridor and per-provider annualized leakage.
- Trailing-twelve-month and run-rate projections.
- Ledger export.
- Variance vs. target markup bps.

### 6. Re-Routing Savings Scenarios
- Model moving volume from one provider/corridor to another.
- Per-leg notional reallocation.
- Projected savings = current leakage minus modeled leakage.
- Scenario comparison and ranking.
- Sensitivity to assumed target markup.
- Save and share scenarios.

### 7. Multi-Provider Import & Normalization
- Upload bank confirmations and processor FX statements (CSV/JSON).
- Provider-specific column/field mappings.
- Parse into normalized import rows.
- Preview, validate, and commit imports to payments.
- Re-runnable mappings; mapping templates per provider.
- Import batch status and error reporting.

### 8. Cross-Border Payment Seeder
- Generate realistic sample payments across multiple corridors.
- Realistic markup distributions per provider tier.
- Seed benchmark rates and providers for instant demo.
- Configurable volume and date range.
- Idempotent seeding (only when empty).
- Reset/clear seeded data.

### 9. Providers Registry
- CRUD banks and processors.
- Provider tier (tier-1 bank, fintech, neobank) and home currency.
- Disclosed fee schedule per provider.
- Provider notes and tags.
- Provider-level aggregate stats.

### 10. Corridors Registry
- CRUD currency-pair corridors.
- Base/quote currency, direction.
- Expected vs. observed markup per corridor.
- Corridor-level volume and leakage stats.

### 11. Payments Ledger
- CRUD individual cross-border payments.
- Fields: notional, applied rate, disclosed fee, provider, corridor, value date.
- Attach captured benchmark and computed markup.
- Bulk operations and filtering.
- Per-payment decomposition view.

### 12. Markup Targets & Variance
- Set target markup bps per corridor.
- Flag payments and corridors exceeding target.
- Variance reporting.
- Target vs. actual trend.

### 13. Alerts & Alert Rules
- Threshold rules on markup bps, leakage $, reconciliation variance.
- Generate alerts when breached.
- Alert acknowledgment and resolution.
- Per-rule enable/disable.

### 14. Reports
- Generate decomposition, leaderboard, ledger, and savings reports.
- Save report definitions.
- Export.
- Scheduled report deliveries.

### 15. Tagging & Grouping
- Create tags; apply to payments and corridors.
- Filter and group analytics by tag.
- Tag-level leakage rollups.

### 16. Fee Schedules
- Define disclosed fee terms per provider (wire fee, stated FX %, lifting policy).
- Versioned schedules with effective dates.
- Used in reconciliation to detect deviation.

### 17. Rate Sources & Provenance
- Register rate sources.
- Track which source supplied each benchmark.
- Confidence and freshness indicators.

### 18. Audit & Activity Log
- Record imports, edits, recomputations, and seeder runs.
- Per-entity activity history.
- Filterable activity feed.

### 19. Notes & Annotations
- Attach notes to payments, providers, corridors.
- Markdown notes for renegotiation talking points.

### 20. Dashboards & Summary Analytics
- Headline KPIs: total leakage, avg markup bps, annualized projection.
- Configurable widgets.
- Recent alerts and top offenders.
- Trend charts of markup over time.

### 21. Organization & Membership
- Organization (workspace) context.
- Member roles within an organization.
- Per-org scoping of all data.

### 22. Billing (optional Stripe)
- Free and Pro plans.
- Stripe checkout/portal/webhook; 503 when unconfigured.
- All features free for signed-in users.

## Frontend Pages (~24)

1. `/` — Landing (static marketing).
2. `/auth/sign-in` — Sign in.
3. `/auth/sign-up` — Sign up.
4. `/pricing` — Pricing (static).
5. `/dashboard` — Overview KPIs and trends.
6. `/dashboard/payments` — Payments ledger list + create.
7. `/dashboard/payments/[id]` — Payment decomposition detail.
8. `/dashboard/providers` — Providers registry.
9. `/dashboard/providers/[id]` — Provider detail + fee schedule.
10. `/dashboard/corridors` — Corridors registry + detail.
11. `/dashboard/benchmarks` — Benchmark rates and rate sources.
12. `/dashboard/leaderboard` — Corridor & provider markup leaderboard.
13. `/dashboard/reconciliation` — Wire/SWIFT fee reconciliation.
14. `/dashboard/ledger` — Annualized FX-cost ledger.
15. `/dashboard/scenarios` — Re-routing savings scenarios.
16. `/dashboard/scenarios/[id]` — Scenario detail + legs.
17. `/dashboard/imports` — Import batches + upload.
18. `/dashboard/imports/[id]` — Import rows + mapping + commit.
19. `/dashboard/targets` — Markup targets & variance.
20. `/dashboard/alerts` — Alerts & alert rules.
21. `/dashboard/reports` — Reports & schedules.
22. `/dashboard/tags` — Tags management.
23. `/dashboard/activity` — Audit/activity log.
24. `/dashboard/seed` — Sample-data seeder.
25. `/settings` — Org, members, billing.
