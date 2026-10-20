import type { ReactNode } from 'react';
import { CalendarClock, Check, Clock, DoorOpen } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtDuration, fmtMoney } from '../../lib/format';
import type { HourPackage } from '../../types';
import { PlanIcon } from './PlanCard';

/** Texto da validade do pacote ("Vale por 60 dias" / "Sem validade"). */
export const validityText = (days: number) => (days > 0 ? `Vale por ${days} dia${days === 1 ? '' : 's'}` : 'Sem validade');

/** Cartão de pacote de horas, no mesmo estilo dos planos. `badges` e `footer` ficam por conta de quem usa. */
export function PackageCard({ pkg, badges, footer, className }: { pkg: HourPackage; badges?: ReactNode; footer?: ReactNode; className?: string }) {
  const dark = pkg.featured;
  const perHour = pkg.minutes > 0 && pkg.price_cents > 0 ? Math.round((pkg.price_cents * 60) / pkg.minutes) : 0;

  return (
    <article className={cn('flex flex-col rounded-[24px] border p-7', dark ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/8 bg-cream text-ink', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', dark ? 'bg-cream/15 text-cream' : 'bg-sage-dim text-sage-700')}>
          <PlanIcon icon={pkg.icon || 'sun'} />
        </span>
        {badges && <div className="flex flex-wrap justify-end gap-1.5">{badges}</div>}
      </div>

      <h3 className="mt-5 font-display text-[22px] leading-tight font-medium">{pkg.name}</h3>
      {pkg.subtitle && <p className={cn('mt-1 text-[14px]', dark ? 'text-cream/70' : 'text-stone-light')}>{pkg.subtitle}</p>}
      {pkg.description && <p className={cn('mt-4 text-[14px] leading-relaxed', dark ? 'text-cream/85' : 'text-stone')}>{pkg.description}</p>}

      <div className={cn('mt-5 border-t pt-5', dark ? 'border-cream/20' : 'border-ink/8')}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-[28px] leading-tight font-medium">{pkg.price_cents > 0 ? fmtMoney(pkg.price_cents) : 'Sob consulta'}</span>
          {perHour > 0 && <span className={cn('text-[13px]', dark ? 'text-cream/70' : 'text-stone-light')}>a hora sai por {fmtMoney(perHour)}</span>}
        </p>
      </div>

      <ul className="mt-5 flex flex-col gap-3.5">
        <li className={cn('flex items-center gap-3 text-[14px] font-semibold', dark ? 'text-cream' : 'text-ink')}>
          <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', dark ? 'bg-cream/15' : 'bg-sage-dim text-sage-700')}><Clock size={13} /></span>
          {fmtDuration(pkg.minutes)} de sala
        </li>
        <li className={cn('flex items-center gap-3 text-[14px]', dark ? 'text-cream/90' : 'text-stone')}>
          <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', dark ? 'bg-cream/15' : 'bg-sand text-stone')}><CalendarClock size={13} /></span>
          {validityText(pkg.validity_days)}
        </li>
        <li className={cn('flex items-start gap-3 text-[14px] leading-snug', dark ? 'text-cream/90' : 'text-stone')}>
          <span className={cn('mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', dark ? 'bg-cream/15' : 'bg-sand text-stone')}><DoorOpen size={13} /></span>
          <span>{pkg.rooms.length > 0 ? `Vale em: ${pkg.rooms.join(', ')}` : 'Vale em todas as salas'}</span>
        </li>
        {pkg.features.map((f, i) => (
          <li key={i} className={cn('flex items-start gap-3 text-[14px] leading-snug', dark ? 'text-cream/90' : 'text-stone')}>
            <span className={cn('mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', dark ? 'bg-cream/15 text-cream' : 'bg-sand text-stone')}><Check size={13} strokeWidth={2.4} /></span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {footer && <div className="mt-auto pt-6">{footer}</div>}
    </article>
  );
}
