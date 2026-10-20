import { ChevronRight, Repeat } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtDateShort, fmtDuration, fmtMoney, fmtWeekdayShort, relativeDay } from '../../lib/format';
import type { Booking } from '../../types';
import { SessionBadge, StatusBadge } from '../ui/Feedback';

export function BookingRow({ booking: b, onClick, showClient }: { booking: Booking; onClick?: () => void; showClient?: boolean }) {
  const dim = b.status === 'cancelled' || b.display_status === 'completed' || b.status === 'no_show';
  const rel = relativeDay(b.date);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-[20px] border border-ink/8 bg-cream p-3.5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-sage-700/30 hover:shadow-[0_22px_40px_-24px_rgba(44,54,39,0.4)] sm:gap-5 sm:p-4"
    >
      <div className={cn('flex h-[68px] w-[68px] shrink-0 flex-col items-center justify-center rounded-2xl', dim ? 'bg-mist-light text-stone' : 'bg-sage-dim text-sage-700')}>
        <span className="text-[10.5px] font-semibold tracking-[0.12em] uppercase">{fmtWeekdayShort(b.date)}</span>
        <span className="font-display text-[24px] leading-none font-medium">{b.date.slice(8)}</span>
        <span className="text-[10.5px] font-medium uppercase">{fmtDateShort(b.date).split(' ').pop()}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className={cn('font-display text-[17px] font-medium', b.status === 'cancelled' ? 'text-stone line-through' : 'text-ink')}>{b.room.name}</h3>
          <span className="sm:hidden"><StatusBadge status={b.display_status} awaitingPayment={b.awaiting_payment} /></span>
          {b.session.state && b.session.state !== 'done' && b.session.state !== 'upcoming' && <SessionBadge state={b.session.state} />}
        </div>
        <p className="mt-0.5 text-[13.5px] text-stone">
          {rel && <strong className="font-semibold text-ink">{rel} · </strong>}
          {b.start_time} às {b.end_time} <span className="text-stone-light">({fmtDuration(b.total_minutes)})</span>
        </p>
        <p className="mt-0.5 flex items-center gap-2 truncate text-[12.5px] text-stone-light">
          {showClient && b.user ? <span className="truncate">{b.user.name}{b.title ? ` · ${b.title}` : ''}</span> : <span className="truncate">{b.title || `Código ${b.code}`}</span>}
          {b.series_id && <Repeat size={12} className="shrink-0" aria-label="Recorrente" />}
        </p>
      </div>

      <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
        <StatusBadge status={b.display_status} awaitingPayment={b.awaiting_payment} />
        <span className="text-[12.5px] font-medium text-stone">{b.price_cents > 0 ? fmtMoney(b.price_cents) : b.included_minutes > 0 ? 'No plano' : b.package_minutes > 0 ? 'No pacote' : 'Sem cobrança'}</span>
        {b.overtime_cents > 0 && <span className="text-[11.5px] font-medium text-rose">+ {fmtMoney(b.overtime_cents)} de excedente</span>}
      </div>
      <ChevronRight size={18} className="shrink-0 text-stone-light transition-transform group-hover:translate-x-1" />
    </button>
  );
}
