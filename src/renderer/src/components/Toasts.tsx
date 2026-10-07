import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
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
    <div className="toasts" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={'toast ' + toast.tone}>
          <span className="toast-icon">
            {toast.tone === 'success' ? <CircleCheck size={17} /> : toast.tone === 'error' ? <CircleAlert size={17} /> : <Info size={17} />}
          </span>
          <div className="toast-body">
            <span>{toast.message}</span>
            {toast.actions?.length ? (
              <div className="toast-actions">
                {toast.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="btn small"
                    onClick={() => {
                      action.onClick()
                      onDismiss(toast.id)
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
