import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addMonths, fmtMonth, todayStr, weekdayOf } from '../../lib/format';
import type { MonthDay } from '../../types';
import { IconButton } from '../ui/Button';

interface Props {
  month: string;
  onMonthChange: (m: string) => void;
  days: MonthDay[] | undefined;
  value: string;
  onChange: (date: string) => void;
  /** Admin pode navegar para o passado. */
  allowPast?: boolean;
}

const HEAD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function MiniCalendar({ month, onMonthChange, days, value, onChange, allowPast }: Props) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const first = `${month}-01`;
  const lead = weekdayOf(first);
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const today = todayStr();
  const canGoBack = allowPast || month > today.slice(0, 7);

  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-[18px] font-medium text-ink">{fmtMonth(month)}</h3>
        <div className="flex gap-1">
          <IconButton label="Mês anterior" disabled={!canGoBack} onClick={() => onMonthChange(addMonths(month, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Próximo mês" onClick={() => onMonthChange(addMonths(month, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center" role="grid" aria-label={fmtMonth(month)}>
        {HEAD.map((h, i) => (
          <span key={i} className="pb-2 text-[10.5px] font-semibold tracking-[0.12em] text-stone-light">{h}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const info = byDate.get(date);
          const disabled = !allowPast
            ? !info || info.state === 'past' || info.state === 'beyond' || info.state === 'closed'
            : info?.state === 'beyond';
          const selected = date === value;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onChange(date)}
              aria-pressed={selected}
              aria-label={date.split('-').reverse().join('/')}
              className={cn(
                'relative mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-full text-[13.5px] font-medium transition-all duration-200',
                selected ? 'bg-sage-700 text-cream shadow-[0_8px_18px_-8px_rgba(44,54,39,0.6)]' : 'text-ink hover:bg-sage-dim',
                disabled && !selected && 'pointer-events-none text-stone-light/50',
                !selected && isToday && 'ring-1 ring-sage-700/50',
              )}
            >
              {Number(date.slice(8))}
              {!disabled && info?.state === 'available' && !selected && (
                <span className={cn('absolute bottom-1 h-1 w-1 rounded-full', info.mine ? 'bg-clay' : 'bg-sage')} />
              )}
              {info?.state === 'full' && !selected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-rose/60" />}
              {selected && info?.mine && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-cream" />}
            </button>
          );
        })}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-stone">
        <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-sage" />Com horários livres</li>
        <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose/60" />Lotado</li>
        <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-clay" />Você reservou</li>
      </ul>
    </div>
  );
}
