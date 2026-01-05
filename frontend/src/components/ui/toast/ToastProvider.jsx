import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ToastContext = createContext(null)

const TONE_CLASSES = {
  success: {
    container:
      'border border-accent-700 bg-accent-600 text-surface-card shadow-soft',
    badge: 'bg-accent-50 text-accent-700',
    role: 'status',
  },
  error: {
    container:
      'border border-text-base bg-surface-contrast text-surface-card shadow-soft',
    badge: 'bg-surface-card text-surface-contrast',
    role: 'alert',
  },
  warning: {
    container:
      'border border-surface-border bg-surface-muted text-text-base shadow-soft',
    badge: 'bg-surface-card text-text-base',
    role: 'alert',
  },
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ToastProvider({ children, defaultDuration = 4000, maxToasts = 5 }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    ({ type = 'success', message = '', duration } = {}) => {
      const id = generateId()
      const lifespan = typeof duration === 'number' ? duration : defaultDuration
      setToasts((prev) => {
        const next = [...prev, { id, type, message, duration: lifespan }]
        return next.slice(-maxToasts)
      })
      const timer = setTimeout(() => removeToast(id), lifespan)
      timersRef.current.set(id, timer)
      return id
    },
    [defaultDuration, maxToasts, removeToast]
  )

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    },
    []
  )

  const value = useMemo(() => ({ showToast, removeToast }), [removeToast, showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

function ToastViewport({ toasts, onDismiss }) {
  if (!toasts.length || typeof document === 'undefined') return null

  return createPortal(
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  )
}

function ToastItem({ toast, onDismiss }) {
  const tone = TONE_CLASSES[toast.type] || TONE_CLASSES.success
  const ariaRole = tone.role || 'status'

  return (
    <div
      role={ariaRole}
      aria-live={ariaRole === 'alert' ? 'assertive' : 'polite'}
      className={`pointer-events-auto flex items-start gap-3 rounded-card px-4 py-3 text-body ${tone.container}`}
    >
      <span className={`mt-0.5 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-pill px-2 text-label font-semibold ${tone.badge}`}>
        {toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : '⚠'}
      </span>
      <div className="flex-1 text-sm leading-5 text-inherit">{toast.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar notificación"
        className="rounded-full p-1 text-inherit hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
      >
        ×
      </button>
    </div>
  )
}
