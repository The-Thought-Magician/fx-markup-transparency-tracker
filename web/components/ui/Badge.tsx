import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'teal' | 'green' | 'amber' | 'rose' | 'slate' | 'blue'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-slate-800 text-slate-300 border-slate-700',
  teal: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  slate: 'bg-slate-800 text-slate-400 border-slate-700',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
