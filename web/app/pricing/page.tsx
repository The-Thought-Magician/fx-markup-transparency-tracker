'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Mid-market benchmark capture & point-in-time lookup',
  'Hidden-spread decomposition on every payment',
  'Corridor & provider markup leaderboards',
  'Wire & SWIFT fee reconciliation',
  'Annualized FX-cost ledger',
  'Re-routing savings scenarios',
  'Targets, alerts & scheduled reports',
  'Statement imports & provider mappings',
  'Tags, notes, activity log & dashboard widgets',
  'One-click realistic sample-data seeder',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    // Billing plan is auth-gated; this is best-effort and silently ignored when signed out.
    api
      .getBillingPlan()
      .then((d) => setStripeEnabled(Boolean(d?.stripeEnabled)))
      .catch(() => setStripeEnabled(false))
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500/20 text-sm font-black text-teal-300">
            Fx
          </span>
          <span className="text-base font-bold tracking-tight text-white">FxMarkupTransparencyTracker</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-5">
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

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight text-white">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
          Every feature is free for signed-in users. Billing is wired but optional — the Pro tier is available when
          Stripe is configured by the operator.
        </p>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="rounded-2xl border border-teal-500/40 bg-slate-900 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Free</h2>
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-0.5 text-xs font-medium text-teal-300">
                Current
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-slate-500">/ forever</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">All features included. No credit card required.</p>
            <ul className="mt-6 space-y-2">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-0.5 text-teal-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg bg-teal-500 py-3 text-center font-semibold text-slate-950 transition-colors hover:bg-teal-400"
            >
              Start free
            </Link>
          </div>

          {/* Pro plan */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-left">
            <h2 className="text-xl font-bold text-white">Pro</h2>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-black text-slate-300">Contact</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Optional paid tier for organizations that want managed billing and priority support.
            </p>
            <ul className="mt-6 space-y-2">
              <li className="flex items-start gap-2 text-sm text-slate-300">
                <span className="mt-0.5 text-teal-400">✓</span>
                <span>Everything in Free</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-slate-300">
                <span className="mt-0.5 text-teal-400">✓</span>
                <span>Managed billing via Stripe</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-slate-300">
                <span className="mt-0.5 text-teal-400">✓</span>
                <span>Priority support</span>
              </li>
            </ul>
            <div className="mt-8 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-center text-sm text-slate-400">
              {stripeEnabled === null
                ? 'Checking billing availability...'
                : stripeEnabled
                  ? 'Billing is configured — upgrade from Settings.'
                  : 'Billing is not configured on this deployment.'}
            </div>
          </div>
        </div>

        <p className="mt-12 text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-teal-400 hover:text-teal-300">
            Sign in
          </Link>
        </p>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>FxMarkupTransparencyTracker — treasury FX cost transparency</p>
      </footer>
    </main>
  )
}
