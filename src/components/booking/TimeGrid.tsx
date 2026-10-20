import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { eventColors } from '../../lib/clientColor';
import { fromMin, nowLocal, toMin } from '../../lib/format';

export interface GridColumn {
  key: string;
  title: ReactNode;
  subtitle?: ReactNode;
  today?: boolean;
  /** Janela de funcionamento da coluna; fora dela fica sombreada e não aceita clique. */
  open?: string;
  close?: string;
  closed?: boolean;
  /** Mostra a linha de "agora" nesta coluna. */
  nowLine?: boolean;
}

export interface GridEvent {
  id: string;
  column: string;
  start: string;
  end: string;
  title: ReactNode;
  subtitle?: ReactNode;
  tone: 'confirmed' | 'pending' | 'done' | 'noshow' | 'block';
  onClick?: () => void;
  label?: string;
  /** Cliente dono da reserva: define a cor do balão. Sem isso, usa a cor padrão do tipo. */
  colorKey?: number;
  /** Selo curto no balão (ex.: Pendente, Faltou, Em uso). */
  badge?: string;
}

interface Props {
  columns: GridColumn[];
  events: GridEvent[];
  step: number;
  onEmptyClick?: (column: string, time: string) => void;
}

const PX_PER_HOUR = 60;

const toneClass: Record<GridEvent['tone'], string> = {
  confirmed: 'bg-sage-700 text-cream border-sage-900/20 hover:bg-sage-800',
  pending: 'bg-amber-dim text-amber border-amber/50 border-dashed hover:bg-amber/20',
  done: 'bg-sage-dim text-sage-800 border-sage/40 hover:bg-sage/25',
  noshow: 'bg-clay-dim text-clay border-clay/40 hover:bg-clay/20',
  block: 'bg-hatch bg-clay-dim text-clay border-clay/30 cursor-default',
};

export function TimeGrid({ columns, events, step, onEmptyClick }: Props) {
  const { startMin, endMin } = useMemo(() => {
    let s = 24 * 60;
    let e = 0;
    for (const c of columns) {
      if (c.closed || !c.open || !c.close) continue;
      s = Math.min(s, toMin(c.open));
      e = Math.max(e, toMin(c.close));
    }
    if (e <= s) return { startMin: 8 * 60, endMin: 20 * 60 };
    return { startMin: Math.floor(s / 60) * 60, endMin: Math.ceil(e / 60) * 60 };
  }, [columns]);

  const ppm = PX_PER_HOUR / 60;
  const height = (endMin - startMin) * ppm;
  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin + i * 60);

  const [now, setNow] = useState(nowLocal());
  useEffect(() => {
    const t = setInterval(() => setNow(nowLocal()), 60_000);
    return () => clearInterval(t);
  }, []);

  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ column: string; top: number } | null>(null);

  const minuteAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = startMin + (e.clientY - rect.top) / ppm;
    return Math.floor(raw / step) * step;
  };

  const isOpenAt = (c: GridColumn, m: number) => !c.closed && c.open && c.close && m >= toMin(c.open) && m + step <= toMin(c.close);

  const nowMin = toMin(now.time);
  const cols = `56px repeat(${columns.length}, minmax(${columns.length > 4 ? 148 : 170}px, 1fr))`;

  return (
    <div ref={scroller} className="overflow-x-auto rounded-[22px] border border-ink/8 bg-cream">
      <div className="min-w-max" style={{ minWidth: columns.length > 4 ? 56 + columns.length * 148 : undefined }}>
        <div className="sticky top-0 z-20 grid border-b border-ink/8 bg-cream" style={{ gridTemplateColumns: cols }}>
          <div />
          {columns.map((c) => (
            <div key={c.key} className={cn('border-l border-ink/6 px-3 py-3 text-center', c.today && 'bg-sage-dim')}>
              <div className={cn('font-display text-[15px] leading-tight font-medium', c.today ? 'text-sage-700' : 'text-ink')}>{c.title}</div>
              {c.subtitle && <div className="mt-0.5 text-[11.5px] text-stone">{c.subtitle}</div>}
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-stone-light" style={{ top: i * PX_PER_HOUR, display: i === 0 ? 'none' : undefined }}>
                {fromMin(h)}
              </div>
            ))}
          </div>

          {columns.map((c) => {
            const colEvents = events.filter((ev) => ev.column === c.key);
            const openTop = c.open && !c.closed ? (toMin(c.open) - startMin) * ppm : 0;
            const openBottom = c.close && !c.closed ? (toMin(c.close) - startMin) * ppm : 0;
            return (
              <div
                key={c.key}
                className={cn('relative border-l border-ink/6', c.today && 'bg-sage-dim/30', !c.closed && onEmptyClick && 'cursor-cell')}
                style={{
                  height,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, rgb(38 42 34 / 0.07) ${PX_PER_HOUR - 1}px, rgb(38 42 34 / 0.07) ${PX_PER_HOUR}px)`,
                }}
                onMouseMove={(e) => {
                  if (!onEmptyClick || (e.target as HTMLElement).closest('[data-event]')) return setHover(null);
                  const m = minuteAt(e);
                  setHover(isOpenAt(c, m) ? { column: c.key, top: (m - startMin) * ppm } : null);
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  if (!onEmptyClick || (e.target as HTMLElement).closest('[data-event]')) return;
                  const m = minuteAt(e);
                  if (isOpenAt(c, m)) onEmptyClick(c.key, fromMin(m));
                }}
              >
                {c.closed ? (
                  <div className="bg-hatch absolute inset-0 flex items-start justify-center bg-sand-deep/60 pt-6 text-[11px] font-semibold tracking-[0.14em] text-stone-light uppercase">Fechado</div>
                ) : (
                  <>
                    {openTop > 0 && <div className="pointer-events-none absolute inset-x-0 top-0 bg-sand-deep/70" style={{ height: openTop }} />}
                    {openBottom < height && <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-sand-deep/70" style={{ top: openBottom }} />}
                  </>
                )}

                {hover?.column === c.key && (
                  <div className="pointer-events-none absolute inset-x-1 rounded-lg border border-dashed border-sage-700/50 bg-sage-700/10" style={{ top: hover.top, height: step * ppm }} />
                )}

                {c.nowLine && nowMin >= startMin && nowMin <= endMin && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMin - startMin) * ppm }}>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-clay" />
                    <span className="h-px flex-1 bg-clay" />
                  </div>
                )}

                {colEvents.map((ev) => {
                  const top = (toMin(ev.start) - startMin) * ppm;
                  const h = Math.max((toMin(ev.end) - toMin(ev.start)) * ppm - 2, 18);
                  const Tag = ev.onClick ? 'button' : 'div';
                  const colors = ev.colorKey != null && ev.tone !== 'block' ? eventColors(ev.colorKey, ev.tone) : null;
                  return (
                    <Tag
                      key={ev.id}
                      data-event
                      type={ev.onClick ? 'button' : undefined}
                      onClick={ev.onClick}
                      aria-label={ev.label}
                      title={ev.label}
                      className={cn(
                        'absolute inset-x-1 overflow-hidden rounded-xl border px-2.5 py-1.5 text-left transition-[filter,box-shadow]',
                        ev.tone === 'block' ? 'z-[1]' : 'z-[2]',
                        colors ? 'hover:shadow-[0_6px_16px_-8px_rgba(38,42,34,0.5)] hover:brightness-[0.97]' : toneClass[ev.tone],
                        ev.tone === 'noshow' && colors && 'bg-hatch',
                      )}
                      style={{
                        top: top + 1,
                        height: h,
                        ...(colors && {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          borderStyle: colors.dashed ? 'dashed' : 'solid',
                          borderLeftWidth: 4,
                          borderLeftColor: colors.accent,
                          borderLeftStyle: 'solid',
                          color: colors.text,
                        }),
                      }}
                    >
                      <span className={cn('flex items-center gap-1.5 text-[12px] leading-tight font-semibold', ev.tone === 'noshow' && 'line-through decoration-1')}>
                        <span className="truncate">{ev.title}</span>
                        {ev.badge && <span className="shrink-0 rounded-full bg-white/60 px-1.5 py-px text-[9.5px] font-bold tracking-wide uppercase no-underline">{ev.badge}</span>}
                      </span>
                      {h > 34 && ev.subtitle && <span className="mt-0.5 block truncate text-[11px] leading-tight opacity-80">{ev.subtitle}</span>}
                    </Tag>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
