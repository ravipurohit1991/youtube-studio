import type { ReactNode } from 'react'
import { clampPercent } from '../lib/api'
import type { JobStatus } from '@shared/types'

export function ProgressBar({ value, status }: { value: number; status?: JobStatus }): ReactNode {
  const cls = status === 'completed' ? 'progress done' : status === 'error' || status === 'canceled' ? 'progress failed' : 'progress'
  return (
    <div className={cls}>
      <span style={{ width: clampPercent(value) + '%' }} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode
  title: string
  message: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{message}</p>
      {children ? <div className="row tight" style={{ justifyContent: 'center', marginTop: 6 }}>{children}</div> : null}
    </div>
  )
}

export function LoadingRow({ label }: { label: string }): ReactNode {
  return (
    <div className="loading-row">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function StatusDot({ ok, busy }: { ok: boolean; busy?: boolean }): ReactNode {
  return <span className={'dot ' + (busy ? 'busy' : ok ? 'ok' : 'bad')} />
}
