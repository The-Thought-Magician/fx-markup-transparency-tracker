import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FxMarkupTransparencyTracker',
  description: 'Expose hidden FX markups, wire fees, and the true cost of every cross-border payment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
