import Link from 'next/link'

const features = [
  {
    title: 'Mid-Market Benchmark Capture',
    body: 'Store the reference mid-market rate at transaction time per currency pair, with source provenance, point-in-time lookup, and backfill for historical payments.',
  },
  {
    title: 'Hidden-Spread Calculator',
    body: 'Separate the disclosed FX fee from the embedded rate markup on every payment. Markup in basis points and dollars, all-in cost, and effective cost percentage of notional.',
  },
  {
    title: 'Corridor & Provider Leaderboards',
    body: 'Rank corridors and providers by average markup bps and total leakage. Volume-weighted views, period filters, snapshots, and best/worst movers.',
  },
  {
    title: 'Wire & SWIFT Fee Reconciliation',
    body: 'Itemize wire fees including correspondent-bank lifting charges. Reconcile disclosed schedules against observed charges and flag overcharges per provider.',
  },
  {
    title: 'Annualized FX-Cost Ledger',
    body: 'Project per-period markup and fees into an annualized leakage figure with a full breakdown you can take into a renegotiation.',
  },
  {
    title: 'Re-Routing Savings Scenarios',
    body: 'Model moving volume to a cheaper provider or corridor, leg by leg, and quantify projected savings against current leakage.',
  },
  {
    title: 'Targets, Alerts & Reports',
    body: 'Set target markup bps per corridor, raise alerts on threshold breaches, and generate saved decomposition and savings reports on a schedule.',
  },
  {
    title: 'Imports & Provider Mappings',
    body: 'Upload bank confirmations and processor statements, normalize each provider format with field mappings, then commit rows straight into payments.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500/20 text-sm font-black text-teal-300">
            Fx
          </span>
          <span className="text-base font-bold tracking-tight text-white">FxMarkupTransparencyTracker</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
          Treasury FX cost transparency
        </div>
        <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
          The exchange rate hides a fee.
          <br />
          <span className="text-teal-400">We make it a recoverable line item.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          FxMarkupTransparencyTracker decomposes every cross-border payment into the mid-market reference rate, the
          disclosed fee, and the embedded rate markup your bank never itemizes — typically 1 to 3 percent of notional,
          recurring on every wire.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-teal-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-teal-400"
          >
            Start tracking free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-white">The spread is buried in the rate</h2>
          <p className="mt-4 text-slate-400">
            A treasury team paying a EUR vendor sees &ldquo;1.0820 EUR/USD&rdquo; on the confirmation, but the
            mid-market rate that minute was 1.0905 — an 0.78 percent hidden spread on top of the stated wire fee.
            Across hundreds of payments a year this compounds into six- and seven-figure recoverable cost. Because it
            is buried in the rate, it never shows up in spend analytics, never gets attributed to a provider, and never
            enters a renegotiation conversation.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-teal-400">1-3%</div>
              <div className="mt-1 text-sm text-slate-400">Typical hidden markup on notional</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-teal-400">Per payment</div>
              <div className="mt-1 text-sm text-slate-400">Decomposed by corridor and provider</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-teal-400">Annualized</div>
              <div className="mt-1 text-sm text-slate-400">Projected recoverable leakage</div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">Everything to quantify and recover FX leakage</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          A deterministic analysis engine over your bank confirmations and processor statements, with a built-in
          sample-data seeder for instant demoability.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-teal-500/30 bg-teal-500/5 p-10 text-center">
          <h2 className="text-2xl font-bold text-white">Turn the hidden spread into a negotiation lever</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Sign in and seed realistic sample data in one click, or upload your own statements. All features are free.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-teal-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-teal-400"
            >
              Create free account
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>FxMarkupTransparencyTracker — treasury FX cost transparency</p>
      </footer>
    </main>
  )
}
