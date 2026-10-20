import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'soft' | 'danger' | 'ghost' | 'light' | 'outline-light';
type Size = 'sm' | 'md' | 'lg';

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', className?: string) =>
  cn(
    'group inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-wide whitespace-nowrap no-underline transition-all duration-300',
    'disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' && 'px-4 py-2 text-[12.5px]',
    size === 'md' && 'px-6 py-3 text-[13.5px]',
    size === 'lg' && 'px-8 py-3.5 text-[14px]',
    variant === 'primary' &&
      'bg-sage-700 text-cream hover:-translate-y-0.5 hover:bg-sage-900 hover:shadow-[0_16px_32px_-12px_rgba(44,54,39,0.45)]',
    variant === 'light' &&
      'bg-cream text-sage-900 hover:-translate-y-0.5 hover:bg-cream/90 hover:shadow-[0_16px_32px_-12px_rgba(0,0,0,0.3)]',
    variant === 'outline-light' && 'border border-cream/30 text-cream hover:border-cream/70 hover:bg-cream/10',
    variant === 'secondary' && 'border border-ink/15 bg-transparent text-ink hover:border-sage-700 hover:bg-sage-dim',
    variant === 'soft' && 'bg-sage-dim text-sage-700 hover:bg-sage/25',
    variant === 'ghost' && 'text-stone hover:bg-sage-dim hover:text-ink',
    variant === 'danger' && 'border border-rose/30 bg-rose-dim text-rose hover:bg-rose hover:text-cream',
    className,
  );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone transition-colors hover:bg-sage-dim hover:text-ink disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
