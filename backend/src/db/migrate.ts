import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id text PRIMARY KEY,
    name text NOT NULL,
    base_currency text NOT NULL DEFAULT 'USD',
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS org_members (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS providers (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    tier text NOT NULL DEFAULT 'bank',
    home_currency text NOT NULL DEFAULT 'USD',
    swift_bic text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS provider_fee_schedules (
    id text PRIMARY KEY,
    provider_id text NOT NULL REFERENCES providers(id),
    user_id text NOT NULL,
    wire_fee_cents integer NOT NULL DEFAULT 0,
    stated_fx_fee_pct real NOT NULL DEFAULT 0,
    lifting_charge_cents integer NOT NULL DEFAULT 0,
    lifting_policy text NOT NULL DEFAULT 'shared',
    effective_date timestamptz NOT NULL DEFAULT now(),
    is_current boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS corridors (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    base_currency text NOT NULL,
    quote_currency text NOT NULL,
    label text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, base_currency, quote_currency)
  )`,

  `CREATE TABLE IF NOT EXISTS rate_sources (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'manual',
    confidence real NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS benchmark_rates (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    source_id text REFERENCES rate_sources(id),
    base_currency text NOT NULL,
    quote_currency text NOT NULL,
    mid_rate real NOT NULL,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS payments (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    provider_id text REFERENCES providers(id),
    corridor_id text REFERENCES corridors(id),
    reference text,
    base_currency text NOT NULL,
    quote_currency text NOT NULL,
    notional_base real NOT NULL,
    applied_rate real NOT NULL,
    disclosed_fee_cents integer NOT NULL DEFAULT 0,
    value_date timestamptz NOT NULL,
    benchmark_rate_id text REFERENCES benchmark_rates(id),
    status text NOT NULL DEFAULT 'recorded',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS payment_markups (
    id text PRIMARY KEY,
    payment_id text NOT NULL UNIQUE REFERENCES payments(id),
    user_id text NOT NULL,
    mid_rate real NOT NULL,
    applied_rate real NOT NULL,
    markup_bps real NOT NULL,
    hidden_spread_cents integer NOT NULL DEFAULT 0,
    disclosed_fee_cents integer NOT NULL DEFAULT 0,
    wire_fee_cents integer NOT NULL DEFAULT 0,
    total_cost_cents integer NOT NULL DEFAULT 0,
    effective_cost_pct real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS wire_fees (
    id text PRIMARY KEY,
    payment_id text NOT NULL REFERENCES payments(id),
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'wire',
    description text,
    amount_cents integer NOT NULL DEFAULT 0,
    intermediary_bank text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS fee_reconciliations (
    id text PRIMARY KEY,
    payment_id text NOT NULL UNIQUE REFERENCES payments(id),
    user_id text NOT NULL,
    expected_fee_cents integer NOT NULL DEFAULT 0,
    observed_fee_cents integer NOT NULL DEFAULT 0,
    variance_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_batches (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    provider_id text REFERENCES providers(id),
    filename text NOT NULL,
    format text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'uploaded',
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_rows (
    id text PRIMARY KEY,
    batch_id text NOT NULL REFERENCES import_batches(id),
    user_id text NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb,
    normalized jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'parsed',
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS provider_mappings (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    provider_id text REFERENCES providers(id),
    name text NOT NULL,
    field_map jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS corridor_leaderboard_snapshots (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    period text NOT NULL,
    rankings jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS provider_leaderboard_snapshots (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    period text NOT NULL,
    rankings jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cost_ledgers (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    period text NOT NULL,
    total_notional_cents integer NOT NULL DEFAULT 0,
    total_markup_cents integer NOT NULL DEFAULT 0,
    total_fees_cents integer NOT NULL DEFAULT 0,
    annualized_leakage_cents integer NOT NULL DEFAULT 0,
    breakdown jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS savings_scenarios (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    description text,
    target_markup_bps real NOT NULL DEFAULT 0,
    current_leakage_cents integer NOT NULL DEFAULT 0,
    modeled_leakage_cents integer NOT NULL DEFAULT 0,
    projected_savings_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scenario_legs (
    id text PRIMARY KEY,
    scenario_id text NOT NULL REFERENCES savings_scenarios(id),
    user_id text NOT NULL,
    corridor_id text REFERENCES corridors(id),
    from_provider_id text REFERENCES providers(id),
    to_provider_id text REFERENCES providers(id),
    notional_cents integer NOT NULL DEFAULT 0,
    current_markup_bps real NOT NULL DEFAULT 0,
    modeled_markup_bps real NOT NULL DEFAULT 0,
    leg_savings_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS benchmarks_targets (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    corridor_id text REFERENCES corridors(id),
    target_markup_bps real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    metric text NOT NULL DEFAULT 'markup_bps',
    comparator text NOT NULL DEFAULT 'gt',
    threshold real NOT NULL DEFAULT 0,
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    rule_id text REFERENCES alert_rules(id),
    payment_id text REFERENCES payments(id),
    message text NOT NULL,
    severity text NOT NULL DEFAULT 'warning',
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'decomposition',
    config jsonb DEFAULT '{}'::jsonb,
    result jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS report_schedules (
    id text PRIMARY KEY,
    report_id text NOT NULL REFERENCES reports(id),
    user_id text NOT NULL,
    cadence text NOT NULL DEFAULT 'monthly',
    recipient_email text,
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    name text NOT NULL,
    color text NOT NULL DEFAULT 'gray',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS payment_tags (
    id text PRIMARY KEY,
    payment_id text NOT NULL REFERENCES payments(id),
    tag_id text NOT NULL REFERENCES tags(id),
    user_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (payment_id, tag_id)
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notes (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS dashboards_widgets (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_providers_org_id ON providers(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_fee_schedules_provider_id ON provider_fee_schedules(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_corridors_org_id ON corridors(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rate_sources_org_id ON rate_sources(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_rates_org_id ON benchmark_rates(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_rates_source_id ON benchmark_rates(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_rates_pair ON benchmark_rates(base_currency, quote_currency, captured_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_org_id ON payments(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_corridor_id ON payments(corridor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_markups_payment_id ON payment_markups(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wire_fees_payment_id ON wire_fees(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fee_reconciliations_payment_id ON fee_reconciliations(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_batches_org_id ON import_batches(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_rows_batch_id ON import_rows(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_mappings_org_id ON provider_mappings(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_corridor_lb_org_id ON corridor_leaderboard_snapshots(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_lb_org_id ON provider_leaderboard_snapshots(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_ledgers_org_id ON cost_ledgers(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_scenarios_org_id ON savings_scenarios(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenario_legs_scenario_id ON scenario_legs(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmarks_targets_org_id ON benchmarks_targets(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_org_id ON alert_rules(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_org_id ON alerts(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_org_id ON reports(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_schedules_report_id ON report_schedules(report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_org_id ON tags(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_tags_payment_id ON payment_tags(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_tags_tag_id ON payment_tags(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_org_id ON audit_events(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_org_id ON notes(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dashboards_widgets_org_id ON dashboards_widgets(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete')
}
