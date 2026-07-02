import Link from 'next/link'

const features = [
  {
    title: 'Mid-Market Benchmark Capture',
    body: 'We store the mid-market rate at the moment of each transaction, per currency pair. Source is logged. History is backfillable.',
  },
  {
    title: 'Hidden-Spread Calculator',
    body: 'Every payment gets split into disclosed fee and embedded rate markup. Basis points, dollars, all-in cost, percent of notional. No estimates.',
  },
  {
    title: 'Corridor & Provider Leaderboards',
    body: 'Corridors and providers ranked by average markup bps and total leakage. Volume-weighted. Filter by period. See who is worst.',
  },
  {
    title: 'Wire & SWIFT Fee Reconciliation',
    body: 'Wire fees itemized, including correspondent-bank lifting charges. Disclosed schedule checked against what actually got charged. Overcharges flagged.',
  },
  {
    title: 'Annualized FX-Cost Ledger',
    body: 'Markup and fees projected to an annualized leakage number, broken down line by line. Bring it to the renegotiation.',
  },
  {
    title: 'Re-Routing Savings Scenarios',
    body: 'Model a switch to a cheaper provider or corridor, leg by leg. Get a savings number before you switch anything.',
  },
  {
    title: 'Targets, Alerts & Reports',
    body: 'Set a target markup bps per corridor. Get alerted when a payment breaches it. Schedule decomposition and savings reports.',
  },
  {
    title: 'Imports & Provider Mappings',
    body: 'Upload bank confirmations and processor statements. Map each provider format once. Rows land straight in payments.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/20 text-sm font-black text-orange-300">
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
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-orange-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
          FX cost tracking
        </div>
        <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
          Your bank marks up the rate.
          <br />
          <span className="text-orange-400">We put a number on it.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          FxMarkupTransparencyTracker splits every cross-border payment into the mid-market rate, the disclosed fee,
          and the markup your bank buries in the exchange rate. It never shows up on the confirmation. We put it on
          the screen.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-orange-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-orange-400"
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
            A treasury team pays a EUR vendor. The confirmation says 1.0820 EUR/USD. The mid-market rate that minute
            was 1.0905. That is a 0.78 percent hidden spread, on top of the stated wire fee. Do that on hundreds of
            payments a year and it adds up to a six- or seven-figure cost. It does not show up in spend analytics. It
            does not get attributed to a provider. Nobody brings it up in a renegotiation, because nobody can see it.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-orange-400">1-3%</div>
              <div className="mt-1 text-sm text-slate-400">Typical hidden markup on notional</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-orange-400">Per payment</div>
              <div className="mt-1 text-sm text-slate-400">Decomposed by corridor and provider</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-3xl font-black text-orange-400">Annualized</div>
              <div className="mt-1 text-sm text-slate-400">Projected recoverable leakage</div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">What it does</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Runs a deterministic analysis over your bank confirmations and processor statements. Seed sample data in
          one click if you want to look before you upload anything real.
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
        <div className="mx-auto max-w-3xl rounded-2xl border border-orange-500/30 bg-orange-500/5 p-10 text-center">
          <h2 className="text-2xl font-bold text-white">Get the number, then go negotiate</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Sign in and seed sample data in one click, or upload your own statements. All features are free.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-orange-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-orange-400"
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
        <p>FxMarkupTransparencyTracker — FX cost tracking for cross-border payments</p>
      </footer>
    </main>
  )
}
