import { CalendarDays, Clock, Flame, Snowflake } from 'lucide-react';
import { cn } from '../../lib/cn';
import { WEEKDAYS, fmtDuration } from '../../lib/format';

export interface RoomReport {
  id: number;
  name: string;
  bookings: number;
  minutes: number;
  revenue_cents: number;
  occupancy: number;
  by_weekday: { weekday: number; bookings: number; minutes: number; capacity_minutes: number }[];
  by_hour: { hour: number; bookings: number; minutes: number; capacity_minutes: number }[];
  /** minutos reservados: [dia da semana 0..6][hora - hour_from] */
  heat: number[][];
}

export interface HeatCapacity { hour_from: number; matrix: number[][] }

const occ = (x: { minutes: number; capacity_minutes: number }) => (x.capacity_minutes > 0 ? x.minutes / x.capacity_minutes : 0);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hourRange = (h: number) => `${h}h às ${h + 1}h`;

/** Os destaques de uma sala: quando ela mais enche e quando mais fica vazia. */
export function roomHighlights(room: RoomReport) {
  const withBookings = <T extends { bookings: number; minutes: number }>(list: T[]) =>
    list.filter((x) => x.bookings > 0).sort((a, b) => b.bookings - a.bookings || b.minutes - a.minutes);
  const peakHour = withBookings(room.by_hour)[0];
  const peakDay = withBookings(room.by_weekday)[0];
  const openDays = room.by_weekday.filter((d) => d.capacity_minutes > 0);
  const openHours = room.by_hour.filter((h) => h.capacity_minutes > 0);
  const quietDay = [...openDays].sort((a, b) => occ(a) - occ(b) || a.bookings - b.bookings)[0];
  const quietHour = [...openHours].sort((a, b) => occ(a) - occ(b) || a.bookings - b.bookings)[0];
  return { peakHour, peakDay, quietDay, quietHour };
}

function Tile({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: 'hot' | 'cold'; label: string; value: string; sub: string }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone === 'hot' ? 'border-clay/25 bg-clay-dim' : 'border-sage/30 bg-sage-dim')}>
      <p className={cn('flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] uppercase', tone === 'hot' ? 'text-clay' : 'text-sage-700')}>{icon}{label}</p>
      <p className="mt-2 font-display text-[22px] leading-tight font-medium text-ink">{value}</p>
      <p className="mt-0.5 text-[12.5px] text-stone">{sub}</p>
    </div>
  );
}

function Bars({ items, max, color }: { items: { key: string | number; label: string; value: number; hint: string; muted?: boolean }[]; max: number; color: string }) {
  return (
    <div className="flex h-[150px] items-end gap-1.5 sm:gap-2" role="img">
      {items.map((it) => (
        <div key={it.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={it.hint}>
          <span className="text-[10.5px] font-semibold text-stone">{it.value > 0 ? it.value : ''}</span>
          <div className="flex w-full flex-1 items-end">
            <div className={cn('w-full rounded-t-[8px]', color, it.muted && 'opacity-30')} style={{ height: `${Math.max(it.value > 0 ? 4 : 2, (it.value / max) * 100)}%` }} />
          </div>
          <span className="text-[10.5px] font-medium text-stone-light">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Detalhe de uma sala: horário de pico, dias mais cheios e vazios, gráficos e mapa de calor (dia x horário). */
export function RoomInsights({ room, capacity }: { room: RoomReport; capacity: HeatCapacity }) {
  const { peakHour, peakDay, quietDay, quietHour } = roomHighlights(room);
  const hasData = room.bookings > 0;

  const days = room.by_weekday.filter((d) => d.capacity_minutes > 0 || d.bookings > 0);
  const hours = room.by_hour.filter((h) => h.capacity_minutes > 0 || h.bookings > 0);
  const maxDay = Math.max(1, ...days.map((d) => d.bookings));
  const maxHour = Math.max(1, ...hours.map((h) => h.bookings));
  const hourIdx = hours.map((h) => h.hour - capacity.hour_from);

  return (
    <div className="flex flex-col gap-6 bg-sand/40 px-5 py-6">
      {!hasData ? (
        <p className="text-[13.5px] text-stone">Esta sala não teve reservas no período escolhido.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            tone="hot" icon={<Flame size={14} />} label="Horário de pico"
            value={peakHour ? hourRange(peakHour.hour) : '—'}
            sub={peakHour ? `${plural(peakHour.bookings, 'reserva', 'reservas')} · ${pct(occ(peakHour))} ocupada` : 'Sem reservas'}
          />
          <Tile
            tone="hot" icon={<CalendarDays size={14} />} label="Dia mais cheio"
            value={peakDay ? WEEKDAYS[peakDay.weekday] : '—'}
            sub={peakDay ? `${plural(peakDay.bookings, 'reserva', 'reservas')} · ${pct(occ(peakDay))} ocupada` : 'Sem reservas'}
          />
          <Tile
            tone="cold" icon={<Snowflake size={14} />} label="Dia mais vazio"
            value={quietDay ? WEEKDAYS[quietDay.weekday] : '—'}
            sub={quietDay ? `${plural(quietDay.bookings, 'reserva', 'reservas')} · só ${pct(occ(quietDay))} ocupada` : 'Sem dados'}
          />
          <Tile
            tone="cold" icon={<Clock size={14} />} label="Horário mais vazio"
            value={quietHour ? hourRange(quietHour.hour) : '—'}
            sub={quietHour ? `${plural(quietHour.bookings, 'reserva', 'reservas')} · só ${pct(occ(quietHour))} ocupada` : 'Sem dados'}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-[13px] font-semibold text-ink">Reservas por dia da semana</p>
          <Bars
            color="bg-sage-700"
            max={maxDay}
            items={days.map((d) => ({ key: d.weekday, label: WEEKDAYS[d.weekday].slice(0, 3), value: d.bookings, hint: `${WEEKDAYS[d.weekday]} · ${plural(d.bookings, 'reserva', 'reservas')} · ${fmtDuration(d.minutes)} · ${pct(occ(d))} de ocupação`, muted: d.capacity_minutes === 0 }))}
          />
        </div>
        <div>
          <p className="mb-3 text-[13px] font-semibold text-ink">Reservas por horário</p>
          <Bars
            color="bg-sage"
            max={maxHour}
            items={hours.map((h) => ({ key: h.hour, label: String(h.hour), value: h.bookings, hint: `${hourRange(h.hour)} · ${plural(h.bookings, 'reserva', 'reservas')} · ${pct(occ(h))} de ocupação` }))}
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">Mapa de calor: dia da semana × horário</p>
          <p className="flex items-center gap-2 text-[11.5px] text-stone">
            vazio
            <span className="flex overflow-hidden rounded">
              {[0.08, 0.3, 0.5, 0.75, 1].map((a) => <i key={a} className="h-3 w-6" style={{ backgroundColor: `rgba(86, 107, 79, ${a})` }} />)}
            </span>
            lotado
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[520px] gap-[3px]" style={{ gridTemplateColumns: `64px repeat(${hours.length}, minmax(0, 1fr))` }}>
            <div />
            {hours.map((h) => <div key={h.hour} className="text-center text-[10.5px] text-stone-light">{h.hour}h</div>)}
            {days.map((d) => (
              <div key={d.weekday} className="contents">
                <div className="flex items-center text-[12px] font-medium text-stone">{WEEKDAYS[d.weekday].slice(0, 3)}</div>
                {hourIdx.map((i, k) => {
                  const cap = capacity.matrix[d.weekday][i];
                  const minutes = room.heat[d.weekday][i];
                  const o = cap > 0 ? Math.min(1, minutes / cap) : 0;
                  return (
                    <div
                      key={k}
                      title={cap > 0 ? `${WEEKDAYS[d.weekday]}, ${hourRange(hours[k].hour)} · ${pct(o)} ocupada (${fmtDuration(minutes)} reservados)` : `${WEEKDAYS[d.weekday]}, ${hourRange(hours[k].hour)} · fechado`}
                      className={cn('h-7 rounded-[5px]', cap === 0 && 'bg-hatch bg-sand-deep/70')}
                      style={cap > 0 ? { backgroundColor: `rgba(86, 107, 79, ${Math.max(0.06, o)})` } : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-stone-light">Quanto mais escuro, mais ocupada a sala estava naquele dia e horário. Quadrados listrados: o espaço estava fechado.</p>
      </div>
    </div>
  );
}
