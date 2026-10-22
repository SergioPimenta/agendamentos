import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

export const Card = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
  <section className={cn('rounded-[22px] border border-ink/8 bg-cream', padded && 'p-5 sm:p-6', className)}>{children}</section>
);

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-[19px] leading-tight font-medium text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-stone">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="animate-fade-up mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] text-sage-700 uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-sage" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sage-700" />
            </span>
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[clamp(1.7rem,3vw,2.4rem)] leading-[1.1] font-medium tracking-[-0.015em] text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-stone">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint, icon, tone = 'sage' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'sage' | 'clay' | 'amber' }) {
  const toneClass = { sage: 'bg-sage-dim text-sage-700', clay: 'bg-clay-dim text-clay', amber: 'bg-amber-dim text-amber' }[tone];
  return (
    <div className="rounded-[22px] border border-ink/8 bg-cream p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">{label}</span>
        {icon && <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px]', toneClass)}>{icon}</span>}
      </div>
      <div className="mt-3 font-display text-[30px] leading-none font-medium text-ink">{value}</div>
      {hint && <div className="mt-2 text-[12.5px] text-stone">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-full border border-ink/10 bg-cream p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-4 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors duration-300',
            value === o.value ? 'bg-sage-700 text-cream' : 'text-stone hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-sage-700 font-display font-medium text-cream', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function ProgressBar({ value, max, tone = 'sage', className }: { value: number; max: number; tone?: 'sage' | 'clay'; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-sage-dim', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-700', tone === 'clay' ? 'bg-clay' : 'bg-sage-700')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** `fit`: a tabela se ajusta à largura da tela (colunas quebram linha) em vez de criar rolagem lateral. */
export function DataTable({ children, className, fit }: { children: ReactNode; className?: string; fit?: boolean }) {
  return (
    <div className={cn('rounded-[22px] border border-ink/8 bg-cream', fit ? 'overflow-hidden' : 'overflow-x-auto', className)}>
      <table className={cn('w-full border-collapse text-left text-[13.5px]', fit ? 'table-fixed' : 'min-w-[640px]')}>{children}</table>
    </div>
  );
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cn('border-b border-ink/8 bg-sand/60 px-5 py-3 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap text-stone uppercase', className)}>{children}</th>
);

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('border-b border-ink/6 px-5 py-3.5 align-middle text-ink', className)}>{children}</td>
);
