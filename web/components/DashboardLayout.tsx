'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Payments',
    items: [
      { label: 'Payments', href: '/dashboard/payments' },
      { label: 'Reconciliation', href: '/dashboard/reconciliation' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Leaderboard', href: '/dashboard/leaderboard' },
      { label: 'Cost Ledger', href: '/dashboard/ledger' },
      { label: 'Scenarios', href: '/dashboard/scenarios' },
      { label: 'Targets', href: '/dashboard/targets' },
    ],
  },
  {
    title: 'Reference Data',
    items: [
      { label: 'Providers', href: '/dashboard/providers' },
      { label: 'Corridors', href: '/dashboard/corridors' },
      { label: 'Benchmarks', href: '/dashboard/benchmarks' },
    ],
  },
  {
    title: 'Data & Imports',
    items: [
      { label: 'Imports', href: '/dashboard/imports' },
      { label: 'Sample Data', href: '/dashboard/seed' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'Alerts', href: '/dashboard/alerts' },
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Tags', href: '/dashboard/tags' },
      { label: 'Activity', href: '/dashboard/activity' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [workspace, setWorkspace] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await authClient.getSession()
      const user = (s as any)?.data?.user ?? (s as any)?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      if (active) {
        setWorkspace(user.name || user.email || 'Workspace')
        setChecking(false)
      }
    })()
    return () => {
      active = false
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            {section.title}
          </div>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const activeLink = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    activeLink
                      ? 'bg-teal-500/15 text-teal-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  const sidebarFooter = (
    <div className="border-t border-slate-800 px-3 py-4">
      <Link
        href="/settings"
        onClick={() => setMobileOpen(false)}
        className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive(pathname, '/settings')
            ? 'bg-teal-500/15 text-teal-300'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
      >
        Settings
      </Link>
      <button
        onClick={signOut}
        className="mt-0.5 block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Sign out
      </button>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500/20 text-sm font-black text-teal-300">
            Fx
          </span>
          <span className="text-sm font-bold tracking-tight text-white">FxMarkupTransparencyTracker</span>
        </div>
        {nav}
        {sidebarFooter}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500/20 text-sm font-black text-teal-300">
                Fx
              </span>
              <span className="text-sm font-bold tracking-tight text-white">FxMarkupTransparencyTracker</span>
            </div>
            {nav}
            {sidebarFooter}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</span>
              <span className="text-sm font-semibold text-white">{workspace}</span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
