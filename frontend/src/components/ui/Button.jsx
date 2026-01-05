/**
 * Reusable button with Tailwind tokens.
 *
 * Variants: primary, secondary, danger
 * Sizes: sm, md
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  className,
  children,
  ...props
}) {
  const baseClasses =
    'inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-button shadow-soft disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none'

  const sizeClasses =
    size === 'sm'
      ? 'text-label px-3 py-2'
      : 'text-body px-4 py-2.5'

  const variantClasses = {
    primary:
      'bg-accent-600 text-white hover:bg-accent-700 focus-visible:ring-accent-500 focus-visible:ring-offset-surface-base',
    secondary:
      'bg-surface-card text-text-base border border-surface-border hover:bg-surface-muted focus-visible:ring-accent-500 focus-visible:ring-offset-surface-base',
    danger:
      'bg-surface-contrast text-surface-card border border-text-base hover:bg-text-base focus-visible:ring-accent-500 focus-visible:ring-offset-surface-base',
  }

  const classes = [baseClasses, sizeClasses, variantClasses[variant] || variantClasses.primary, className]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      {...props}
    >
      {children}
    </button>
  )
}
