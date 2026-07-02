'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import CommandPalette, { type CommandRoute } from '@/components/CommandPalette'

interface NavItem {
  label: string
  href: string
  icon: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: 'D' }],
  },
  {
    title: 'Payments',
    items: [
      { label: 'Payments', href: '/dashboard/payments', icon: 'P' },
      { label: 'Reconciliation', href: '/dashboard/reconciliation', icon: 'R' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Leaderboard', href: '/dashboard/leaderboard', icon: 'L' },
      { label: 'Cost Ledger', href: '/dashboard/ledger', icon: 'C' },
      { label: 'Scenarios', href: '/dashboard/scenarios', icon: 'S' },
      { label: 'Targets', href: '/dashboard/targets', icon: 'T' },
    ],
  },
  {
    title: 'Reference Data',
    items: [
      { label: 'Providers', href: '/dashboard/providers', icon: 'V' },
      { label: 'Corridors', href: '/dashboard/corridors', icon: 'X' },
      { label: 'Benchmarks', href: '/dashboard/benchmarks', icon: 'B' },
    ],
  },
  {
    title: 'Data & Imports',
    items: [
      { label: 'Imports', href: '/dashboard/imports', icon: 'I' },
      { label: 'Sample Data', href: '/dashboard/seed', icon: '#' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'Alerts', href: '/dashboard/alerts', icon: 'A' },
      { label: 'Reports', href: '/dashboard/reports', icon: 'E' },
      { label: 'Tags', href: '/dashboard/tags', icon: 'G' },
      { label: 'Activity', href: '/dashboard/activity', icon: 'Y' },
    ],
  },
]

// Top-level items always pinned in the slim sidebar. Every other route lives in the palette.
const pinned = ['/dashboard', '/dashboard/payments', '/dashboard/leaderboard', '/dashboard/reports']

const commandRoutes: CommandRoute[] = sections.flatMap((section) =>
  section.items.map((item) => ({ label: item.label, href: item.href, group: section.title })),
)
commandRoutes.push({ label: 'Settings', href: '/settings', group: 'Account' })

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [workspace, setWorkspace] = useState('Workspace')

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
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-orange-400" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const pinnedItems = sections.flatMap((s) => s.items).filter((item) => pinned.includes(item.href))

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Minimal chrome sidebar: logo + a handful of top-level links. Everything else is in Cmd+K. */}
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-slate-800 bg-slate-900 py-4 lg:flex">
        <Link
          href="/dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/20 text-sm font-black text-orange-300"
        >
          Fx
        </Link>
        <nav className="mt-6 flex flex-1 flex-col items-center gap-1">
          {pinnedItems.map((item) => {
            const activeLink = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                  activeLink
                    ? 'bg-orange-500/15 text-orange-300'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
              </Link>
            )
          })}
        </nav>
        <Link
          href="/settings"
          title="Settings"
          aria-label="Settings"
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
            isActive(pathname, '/settings')
              ? 'bg-orange-500/15 text-orange-300'
              : 'text-slate-500 hover:bg-slate-800 hover:text-white'
          }`}
        >
          &#9881;
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tracking-tight text-white lg:hidden">FxMarkupTransparencyTracker</span>
            <CommandPalette routes={commandRoutes} />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</span>
              <span className="text-sm font-semibold text-white">{workspace}</span>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
