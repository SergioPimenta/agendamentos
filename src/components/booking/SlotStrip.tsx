import { cn } from '../../lib/cn';
import { fmtDuration } from '../../lib/format';
import type { Slot } from '../../types';

interface Props {
  slots: Slot[];
  step: number;
  onPick: (time: string) => void;
  /** Janela escolhida (início inclusivo, fim exclusivo), destacada na faixa. */
  selected?: { start: string; end: string } | null;
}

const LABEL: Record<Slot['state'], string> = {
  free: 'Livre',
  booked: 'Ocupado',
  blocked: 'Indisponível',
  past: 'Horário passado',
};

/** Faixa horizontal com um botão por intervalo (ex.: 30 min) do dia. */
export function SlotStrip({ slots, step, onPick, selected }: Props) {
  if (!slots.length) return null;
  const perHour = Math.max(1, Math.round(60 / step));

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="min-w-max sm:min-w-0">
        <div className="mb-1.5 flex gap-[3px]">
          {slots.map((s, i) => (
            <div key={s.time} className="min-w-6 flex-1 text-[10.5px] font-medium text-stone-light">
              {i % perHour === 0 ? s.time.slice(0, 2) + 'h' : ''}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]" role="group" aria-label="Horários do dia">
          {slots.map((s) => {
            const free = s.state === 'free';
            const chosen = free && !!selected && s.time >= selected.start && s.time < selected.end;
            return (
              <button
                key={s.time}
                type="button"
                disabled={!free}
                onClick={() => onPick(s.time)}
                title={`${s.time} · ${s.mine ? 'Sua reserva' : LABEL[s.state]}${free ? ` · ${fmtDuration(step)}` : ''}`}
                aria-label={`${s.time} ${s.mine ? 'sua reserva' : LABEL[s.state]}`}
                className={cn(
                  'h-11 min-w-6 flex-1 rounded-[9px] text-[9px] font-semibold tracking-tighter transition-all duration-200',
                  free && !chosen && 'border border-sage/30 bg-sage/15 text-transparent hover:-translate-y-0.5 hover:bg-sage-700 hover:text-cream hover:shadow-[0_10px_18px_-10px_rgba(44,54,39,0.6)] focus-visible:bg-sage-700 focus-visible:text-cream',
                  chosen && 'border border-sage-700 bg-sage-700 text-cream shadow-[0_10px_18px_-10px_rgba(44,54,39,0.6)]',
                  s.state === 'booked' && !s.mine && 'bg-hatch bg-mist-light',
                  s.mine && 'bg-sage-700 text-cream',
                  s.state === 'blocked' && 'bg-hatch bg-clay-dim',
                  s.state === 'past' && 'bg-sand-deep/70',
                )}
              >
                {(free || s.mine) && s.time.slice(0, 5)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
