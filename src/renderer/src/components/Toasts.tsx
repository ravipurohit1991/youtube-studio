import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { ToastItem } from '../lib/types'

export default function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: number) => void
}): ReactNode {
  if (!items.length) return null
  return (
    <div className="toasts">
      {items.map((toast) => (
        <div key={toast.id} className={'toast ' + toast.tone}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
