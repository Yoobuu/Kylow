import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const getFocusableElements = (root) => {
  if (!root) return []
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden')
  )
}

export default function Modal({
  isOpen,
  title,
  description,
  children,
  onClose,
  closeOnOverlay = true,
  primaryAction,
  secondaryAction,
}) {
  const overlayRef = useRef(null)
  const dialogRef = useRef(null)
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 8)}`).current
  const descId = useRef(`modal-desc-${Math.random().toString(36).slice(2, 8)}`).current

  useEffect(() => {
    if (!isOpen) return undefined

    const previouslyFocused = document.activeElement
    const dialog = dialogRef.current
    const focusables = getFocusableElements(dialog)
    const first = focusables[0] || dialog
    first?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
        return
      }
      if (event.key === 'Tab') {
        const elements = getFocusableElements(dialogRef.current)
        if (!elements.length) {
          event.preventDefault()
          dialogRef.current?.focus()
          return
        }
        const firstEl = elements[0]
        const lastEl = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault()
          lastEl.focus()
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault()
          firstEl.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleOverlayClick = (event) => {
    if (!closeOnOverlay) return
    if (event.target === overlayRef.current) {
      onClose?.()
    }
  }

  const PrimaryButton = () =>
    primaryAction ? (
      <button
        type="button"
        onClick={primaryAction.onClick}
        className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2"
      >
        {primaryAction.label}
      </button>
    ) : null

  const SecondaryButton = () =>
    secondaryAction ? (
      <button
        type="button"
        onClick={secondaryAction.onClick}
        className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-text-base shadow-sm hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2"
      >
        {secondaryAction.label}
      </button>
    ) : null

  const content = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onMouseDown={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded-card bg-surface.card shadow-modal focus:outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-border px-6 py-4">
          {title && (
            <h2 id={titleId} className="text-lg font-semibold text-text-base">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-2 text-text-muted hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2"
          >
            ×
          </button>
        </div>
        {description && (
          <div id={descId} className="px-6 pt-3 text-sm text-text-muted">
            {description}
          </div>
        )}
        <div className="px-6 py-4 text-text-base">{children}</div>
        {(primaryAction || secondaryAction) && (
          <div className="flex items-center justify-end gap-2 border-t border-surface-border px-6 py-4">
            <SecondaryButton />
            <PrimaryButton />
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
