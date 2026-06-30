import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Organizations & membership
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  base_currency: text('base_currency').notNull().default('USD'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const org_members = pgTable('org_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.user_id)])

// ---------------------------------------------------------------------------
// Providers & fee schedules
// ---------------------------------------------------------------------------

export const providers = pgTable('providers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  tier: text('tier').notNull().default('bank'),
  home_currency: text('home_currency').notNull().default('USD'),
  swift_bic: text('swift_bic'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const provider_fee_schedules = pgTable('provider_fee_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider_id: text('provider_id').notNull().references(() => providers.id),
  user_id: text('user_id').notNull(),
  wire_fee_cents: integer('wire_fee_cents').notNull().default(0),
  stated_fx_fee_pct: real('stated_fx_fee_pct').notNull().default(0),
  lifting_charge_cents: integer('lifting_charge_cents').notNull().default(0),
  lifting_policy: text('lifting_policy').notNull().default('shared'),
  effective_date: timestamp('effective_date').defaultNow().notNull(),
  is_current: boolean('is_current').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Corridors
// ---------------------------------------------------------------------------

export const corridors = pgTable('corridors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  base_currency: text('base_currency').notNull(),
  quote_currency: text('quote_currency').notNull(),
  label: text('label').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.base_currency, t.quote_currency)])

// ---------------------------------------------------------------------------
// Rate sources & benchmark rates
// ---------------------------------------------------------------------------

export const rate_sources = pgTable('rate_sources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('manual'),
  confidence: real('confidence').notNull().default(1),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const benchmark_rates = pgTable('benchmark_rates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  source_id: text('source_id').references(() => rate_sources.id),
  base_currency: text('base_currency').notNull(),
  quote_currency: text('quote_currency').notNull(),
  mid_rate: real('mid_rate').notNull(),
  captured_at: timestamp('captured_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Payments & markup decomposition
// ---------------------------------------------------------------------------

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  provider_id: text('provider_id').references(() => providers.id),
  corridor_id: text('corridor_id').references(() => corridors.id),
  reference: text('reference'),
  base_currency: text('base_currency').notNull(),
  quote_currency: text('quote_currency').notNull(),
  notional_base: real('notional_base').notNull(),
  applied_rate: real('applied_rate').notNull(),
  disclosed_fee_cents: integer('disclosed_fee_cents').notNull().default(0),
  value_date: timestamp('value_date').notNull(),
  benchmark_rate_id: text('benchmark_rate_id').references(() => benchmark_rates.id),
  status: text('status').notNull().default('recorded'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const payment_markups = pgTable('payment_markups', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payment_id: text('payment_id').notNull().references(() => payments.id).unique(),
  user_id: text('user_id').notNull(),
  mid_rate: real('mid_rate').notNull(),
  applied_rate: real('applied_rate').notNull(),
  markup_bps: real('markup_bps').notNull(),
  hidden_spread_cents: integer('hidden_spread_cents').notNull().default(0),
  disclosed_fee_cents: integer('disclosed_fee_cents').notNull().default(0),
  wire_fee_cents: integer('wire_fee_cents').notNull().default(0),
  total_cost_cents: integer('total_cost_cents').notNull().default(0),
  effective_cost_pct: real('effective_cost_pct').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Wire fees & reconciliation
// ---------------------------------------------------------------------------

export const wire_fees = pgTable('wire_fees', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payment_id: text('payment_id').notNull().references(() => payments.id),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull().default('wire'),
  description: text('description'),
  amount_cents: integer('amount_cents').notNull().default(0),
  intermediary_bank: text('intermediary_bank'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const fee_reconciliations = pgTable('fee_reconciliations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payment_id: text('payment_id').notNull().references(() => payments.id).unique(),
  user_id: text('user_id').notNull(),
  expected_fee_cents: integer('expected_fee_cents').notNull().default(0),
  observed_fee_cents: integer('observed_fee_cents').notNull().default(0),
  variance_cents: integer('variance_cents').notNull().default(0),
  status: text('status').notNull().default('open'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export const import_batches = pgTable('import_batches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  provider_id: text('provider_id').references(() => providers.id),
  filename: text('filename').notNull(),
  format: text('format').notNull().default('csv'),
  status: text('status').notNull().default('uploaded'),
  row_count: integer('row_count').notNull().default(0),
  error_count: integer('error_count').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const import_rows = pgTable('import_rows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  batch_id: text('batch_id').notNull().references(() => import_batches.id),
  user_id: text('user_id').notNull(),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  normalized: jsonb('normalized').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('parsed'),
  error: text('error'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const provider_mappings = pgTable('provider_mappings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  provider_id: text('provider_id').references(() => providers.id),
  name: text('name').notNull(),
  field_map: jsonb('field_map').$type<Record<string, string>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export const corridor_leaderboard_snapshots = pgTable('corridor_leaderboard_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  period: text('period').notNull(),
  rankings: jsonb('rankings').$type<Array<Record<string, unknown>>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const provider_leaderboard_snapshots = pgTable('provider_leaderboard_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  period: text('period').notNull(),
  rankings: jsonb('rankings').$type<Array<Record<string, unknown>>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Cost ledger & savings scenarios
// ---------------------------------------------------------------------------

export const cost_ledgers = pgTable('cost_ledgers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  period: text('period').notNull(),
  total_notional_cents: integer('total_notional_cents').notNull().default(0),
  total_markup_cents: integer('total_markup_cents').notNull().default(0),
  total_fees_cents: integer('total_fees_cents').notNull().default(0),
  annualized_leakage_cents: integer('annualized_leakage_cents').notNull().default(0),
  breakdown: jsonb('breakdown').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const savings_scenarios = pgTable('savings_scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  target_markup_bps: real('target_markup_bps').notNull().default(0),
  current_leakage_cents: integer('current_leakage_cents').notNull().default(0),
  modeled_leakage_cents: integer('modeled_leakage_cents').notNull().default(0),
  projected_savings_cents: integer('projected_savings_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const scenario_legs = pgTable('scenario_legs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scenario_id: text('scenario_id').notNull().references(() => savings_scenarios.id),
  user_id: text('user_id').notNull(),
  corridor_id: text('corridor_id').references(() => corridors.id),
  from_provider_id: text('from_provider_id').references(() => providers.id),
  to_provider_id: text('to_provider_id').references(() => providers.id),
  notional_cents: integer('notional_cents').notNull().default(0),
  current_markup_bps: real('current_markup_bps').notNull().default(0),
  modeled_markup_bps: real('modeled_markup_bps').notNull().default(0),
  leg_savings_cents: integer('leg_savings_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Targets, alerts, rules
// ---------------------------------------------------------------------------

export const benchmarks_targets = pgTable('benchmarks_targets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  corridor_id: text('corridor_id').references(() => corridors.id),
  target_markup_bps: real('target_markup_bps').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  metric: text('metric').notNull().default('markup_bps'),
  comparator: text('comparator').notNull().default('gt'),
  threshold: real('threshold').notNull().default(0),
  is_enabled: boolean('is_enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  rule_id: text('rule_id').references(() => alert_rules.id),
  payment_id: text('payment_id').references(() => payments.id),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('warning'),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reports & schedules
// ---------------------------------------------------------------------------

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('decomposition'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  result: jsonb('result').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const report_schedules = pgTable('report_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  report_id: text('report_id').notNull().references(() => reports.id),
  user_id: text('user_id').notNull(),
  cadence: text('cadence').notNull().default('monthly'),
  recipient_email: text('recipient_email'),
  is_enabled: boolean('is_enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const tags = pgTable('tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('gray'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.name)])

export const payment_tags = pgTable('payment_tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payment_id: text('payment_id').notNull().references(() => payments.id),
  tag_id: text('tag_id').notNull().references(() => tags.id),
  user_id: text('user_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.payment_id, t.tag_id)])

// ---------------------------------------------------------------------------
// Audit, notes, dashboard widgets
// ---------------------------------------------------------------------------

export const audit_events = pgTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notes = pgTable('notes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  body: text('body').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const dashboards_widgets = pgTable('dashboards_widgets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  org_id: text('org_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  position: integer('position').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
