interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
      {label && <span className="text-sm text-slate-400">{label}</span>}
    </div>
  )
}

export default Spinner
