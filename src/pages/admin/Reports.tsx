import { Fragment, useState } from 'react';
import { Ban, CalendarCheck, ChevronDown, Clock, Download, Percent, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ErrorState, Skeleton, useToast } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/Form';
import { Card, CardHeader, DataTable, PageHeader, Segmented, Stat, Td, Th } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { WEEKDAYS, addDays, fmtDuration, fmtHours, fmtMoney, todayStr, weekdayOf } from '../../lib/format';
import { api } from '../../services/api';
import { RoomInsights, roomHighlights, type HeatCapacity, type RoomReport } from './RoomInsights';

interface Report {
  from: string;
  to: string;
  totals: { bookings: number; cancelled: number; no_show: number; minutes: number; revenue_cents: number; paid_cents: number; included_minutes: number; occupancy: number };
  by_room: RoomReport[];
  heat_capacity: HeatCapacity;
  by_client: { id: number; name: string; bookings: number; minutes: number; revenue_cents: number }[];
  by_weekday: { weekday: number; bookings: number; minutes: number }[];
  by_hour: { hour: number; minutes: number }[];
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last' | '30' | 'custom';

function range(preset: Preset): { from: string; to: string } {
  const today = todayStr();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  // Semana de segunda-feira até hoje.
  if (preset === 'week') return { from: addDays(today, -((weekdayOf(today) + 6) % 7)), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === '30') return { from: addDays(today, -29), to: today };
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCDate(0);
  const last = d.toISOString().slice(0, 10);
  return { from: `${last.slice(0, 7)}-01`, to: last };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Cores das salas (na ordem da lista). Distintas entre si e no tom do sistema. */
const ROOM_COLORS = ['#566b4f', '#c2703d', '#d9a441', '#5b8fa8', '#9a5b7a', '#7aa874', '#b5524d', '#8f7ac2', '#3f8f8b', '#a68a64', '#4d5f8a', '#c9a0a0'];
const OTHER_COLOR = '#b9b7ab';
const roomColor = (index: number) => ROOM_COLORS[index % ROOM_COLORS.length];

interface Slice { key: string; name: string; color: string; minutes: number }
const sumOf = (slices: Slice[]) => slices.reduce((a, s) => a + s.minutes, 0);

/** Dados do balão que aparece ao passar o mouse (ou focar com o teclado) numa barra. */
interface Tip { x: number; y: number; title: string; sub: string; slices: Slice[] }

/** Balão com as salas da barra: cor, horas e a parte de cada uma. Segue o mouse e nunca sai da tela. */
function ChartTip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const width = 264;
  const sorted = [...tip.slices].sort((a, b) => b.minutes - a.minutes);
  const total = sumOf(sorted) || 1;
  const height = 78 + Math.max(1, sorted.length) * 36;
  let left = tip.x + 18;
  if (left + width > window.innerWidth - 8) left = tip.x - width - 18;
  left = Math.max(8, left);
  const top = Math.min(Math.max(8, tip.y - height / 2), window.innerHeight - height - 8);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-2xl border border-ink/8 bg-cream p-4 shadow-[0_22px_48px_-14px_rgba(44,54,39,0.42)]"
      style={{ left, top, width }}
    >
      <p className="font-display text-[16px] leading-tight font-medium text-ink">{tip.title}</p>
      <p className="mt-0.5 text-[12px] text-stone">{tip.sub}</p>
      <ul className="mt-3 flex flex-col gap-2.5 border-t border-ink/8 pt-3">
        {sorted.length === 0 && <li className="text-[12.5px] text-stone-light">Sem reservas</li>}
        {sorted.map((s) => (
          <li key={s.key}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
              <span className="shrink-0 font-semibold text-ink">{fmtDuration(s.minutes)}</span>
              <span className="w-9 shrink-0 text-right text-stone-light">{pct(s.minutes / total)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full" style={{ width: `${(s.minutes / total) * 100}%`, background: s.color }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barra dividida por sala: a primeira sala fica embaixo; a altura total vem de `heightPct`. */
function StackedBar({ segments, heightPct, className }: { segments: Slice[]; heightPct: number; className?: string }) {
  const total = sumOf(segments) || 1;
  return (
    <div className={cn('flex w-full flex-col-reverse overflow-hidden', className)} style={{ height: `${heightPct}%` }}>
      {segments.length === 0 && <div className="h-full w-full bg-sage-dim" />}
      {segments.map((s) => (
        <div key={s.key} style={{ height: `${(s.minutes / total) * 100}%`, minHeight: 2, background: s.color, boxShadow: 'inset 0 1px 0 rgba(255,253,247,0.45)' }} />
      ))}
    </div>
  );
}

export default function AdminReports() {
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(range('month'));
  const [openRoom, setOpenRoom] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /** Propriedades que ligam o balão a uma barra: mouse e teclado (Tab). */
  const tipProps = (title: string, sub: string, slices: Slice[]) => ({
    tabIndex: 0,
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, title, sub, slices }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const b = e.currentTarget.getBoundingClientRect();
      setTip({ x: b.left + b.width / 2, y: b.top + b.height / 2, title, sub, slices });
    },
    onBlur: () => setTip(null),
  });
  const { from, to } = preset === 'custom' ? custom : range(preset);
  const q = useApi(() => api.get<Report>('/admin/reports', { from, to }), [from, to]);
  const r = q.data;

  // Cada sala tem a sua cor, a mesma nos gráficos e na lista "Desempenho por sala".
  const colorOf = (roomId: number) => roomColor(Math.max(0, r?.by_room.findIndex((x) => x.id === roomId) ?? 0));
  /** Fatias de uma barra: minutos de cada sala; o que sobra (salas desativadas) vira "Outras". */
  const stackFor = (total: number, pick: (room: RoomReport) => number): Slice[] => {
    const parts: Slice[] = (r?.by_room ?? []).map((room) => ({ key: String(room.id), name: room.name, color: colorOf(room.id), minutes: pick(room) })).filter((s) => s.minutes > 0);
    const rest = total - sumOf(parts);
    return rest > 0 ? [...parts, { key: 'rest', name: 'Outras salas', color: OTHER_COLOR, minutes: rest }] : parts;
  };
  const maxWeekday = Math.max(1, ...(r?.by_weekday.flatMap((w) => [w.minutes, sumOf(stackFor(w.minutes, (room) => room.by_weekday.find((d) => d.weekday === w.weekday)?.minutes ?? 0))]) ?? [1]));
  const maxHour = Math.max(1, ...(r?.by_hour.flatMap((h) => [h.minutes, sumOf(stackFor(h.minutes, (room) => room.by_hour.find((x) => x.hour === h.hour)?.minutes ?? 0))]) ?? [1]));

  return (
    <>
      <PageHeader
        eyebrow="Gestão"
        title="Relatórios"
        description="Ocupação, receita e uso das salas no período."
        actions={<Button variant="secondary" icon={<Download size={16} />} onClick={() => api.download('/admin/reports/export', `reservas-${from}_${to}.csv`, { from, to }).catch((e) => toast.error(e.message))}>Exportar CSV</Button>}
      />

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Segmented value={preset} onChange={setPreset} options={[{ value: 'today', label: 'Hoje' }, { value: 'yesterday', label: 'Ontem' }, { value: 'week', label: 'Esta semana' }, { value: 'month', label: 'Este mês' }, { value: 'last', label: 'Mês passado' }, { value: '30', label: '30 dias' }, { value: 'custom', label: 'Personalizado' }]} />
        {preset === 'custom' && (
          <div className="flex gap-3">
            <Input aria-label="De" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <Input aria-label="Até" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <ChartTip tip={tip} />

      {!r ? <Skeleton className="h-[400px] rounded-[22px]" /> : (
        <div className={cn('flex flex-col gap-6 transition-opacity', q.loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
            <Stat label="Reservas" value={r.totals.bookings} icon={<CalendarCheck />} hint={`${r.totals.cancelled} canceladas`} />
            <Stat label="Horas" value={fmtHours(r.totals.minutes)} icon={<Clock />} hint={`${fmtHours(r.totals.included_minutes)} em planos`} />
            <Stat label="Ocupação" value={pct(r.totals.occupancy)} icon={<Percent />} hint="das horas disponíveis" />
            <Stat label="Receita" value={fmtMoney(r.totals.revenue_cents)} icon={<Wallet />} tone="clay" hint={`${fmtMoney(r.totals.paid_cents)} recebido`} />
            <Stat label="Faltas" value={r.totals.no_show} icon={<Ban />} tone="amber" hint="não compareceram" />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Por dia da semana" subtitle="Horas reservadas" />
              <div className="group/chart flex h-[180px] items-end gap-3">
                {r.by_weekday.map((w) => {
                  const stack = stackFor(w.minutes, (room) => room.by_weekday.find((d) => d.weekday === w.weekday)?.minutes ?? 0);
                  return (
                    <div
                      key={w.weekday}
                      className="flex h-full flex-1 cursor-default flex-col items-center justify-end gap-2 rounded-lg outline-none transition-opacity group-hover/chart:opacity-45 hover:opacity-100! focus-visible:ring-2 focus-visible:ring-sage/40"
                      {...tipProps(WEEKDAYS[w.weekday], `${fmtDuration(w.minutes)} · ${w.bookings} reserva${w.bookings === 1 ? '' : 's'}`, stack)}
                    >
                      <span className="text-[11px] font-semibold text-stone">{w.minutes ? fmtHours(w.minutes) : ''}</span>
                      <div className="flex w-full flex-1 items-end"><StackedBar segments={stack} heightPct={Math.max(3, (Math.max(w.minutes, sumOf(stack)) / maxWeekday) * 100)} className="rounded-t-[10px]" /></div>
                      <span className="text-[11px] font-medium text-stone-light">{WEEKDAYS[w.weekday].slice(0, 3)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title="Por horário" subtitle="Onde está a demanda ao longo do dia" />
              <div className="group/chart flex h-[180px] items-end gap-1.5">
                {r.by_hour.map((h) => {
                  const stack = stackFor(h.minutes, (room) => room.by_hour.find((x) => x.hour === h.hour)?.minutes ?? 0);
                  const count = r.by_room.reduce((a, room) => a + (room.by_hour.find((x) => x.hour === h.hour)?.bookings ?? 0), 0);
                  return (
                    <div
                      key={h.hour}
                      className="flex h-full flex-1 cursor-default flex-col items-center justify-end gap-2 rounded-md outline-none transition-opacity group-hover/chart:opacity-45 hover:opacity-100! focus-visible:ring-2 focus-visible:ring-sage/40"
                      {...tipProps(`${h.hour}h às ${h.hour + 1}h`, `${fmtDuration(h.minutes)} · ${count} reserva${count === 1 ? '' : 's'}`, stack)}
                    >
                      <div className="flex w-full flex-1 items-end"><StackedBar segments={stack} heightPct={Math.max(3, (Math.max(h.minutes, sumOf(stack)) / maxHour) * 100)} className="rounded-t-md" /></div>
                      <span className="text-[10.5px] text-stone-light">{h.hour}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div>
            <h2 className="font-display text-[19px] font-medium text-ink">Desempenho por sala</h2>
            <p className="mt-1 mb-3 text-[13px] text-stone">Cada sala tem uma cor, a mesma das barras dos gráficos acima. Clique em uma sala para ver em que horários e dias ela mais enche (e quando fica vazia).</p>
            <DataTable>
              <thead>
                <tr>
                  <Th>Sala</Th><Th>Reservas</Th><Th>Horas</Th><Th className="min-w-[160px]">Ocupação</Th>
                  <Th>Horário de pico</Th><Th>Dia mais cheio</Th><Th className="text-right">Receita</Th>
                </tr>
              </thead>
              <tbody>
                {r.by_room.map((room) => {
                  const open = openRoom === room.id;
                  const { peakHour, peakDay } = roomHighlights(room);
                  return (
                    <Fragment key={room.id}>
                      <tr onClick={() => setOpenRoom(open ? null : room.id)} className={cn('cursor-pointer transition-colors hover:bg-sage-dim/50', open && 'bg-sage-dim/40')}>
                        <Td className="font-medium">
                          <button type="button" aria-expanded={open} className="flex cursor-pointer items-center gap-2 text-left">
                            <ChevronDown size={16} className={cn('shrink-0 text-stone transition-transform', open && 'rotate-180 text-sage-700')} />
                            <span className="h-3.5 w-3.5 shrink-0 rounded-[5px]" style={{ background: colorOf(room.id) }} aria-hidden />
                            {room.name}
                          </button>
                        </Td>
                        <Td>{room.bookings}</Td>
                        <Td>{fmtDuration(room.minutes)}</Td>
                        <Td>
                          <div className="flex items-center gap-3">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-sage-dim"><div className="h-full rounded-full bg-sage-700" style={{ width: `${Math.min(100, room.occupancy * 100)}%` }} /></div>
                            <span className="w-9 text-right text-[12px] text-stone">{pct(room.occupancy)}</span>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap">{peakHour ? <>{peakHour.hour}h às {peakHour.hour + 1}h <span className="text-[12px] text-stone-light">· {peakHour.bookings}</span></> : <span className="text-stone-light">—</span>}</Td>
                        <Td className="whitespace-nowrap">{peakDay ? <>{WEEKDAYS[peakDay.weekday]} <span className="text-[12px] text-stone-light">· {peakDay.bookings}</span></> : <span className="text-stone-light">—</span>}</Td>
                        <Td className="text-right font-medium">{fmtMoney(room.revenue_cents)}</Td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="border-b border-ink/6 p-0"><RoomInsights room={room} capacity={r.heat_capacity} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </DataTable>
          </div>

          <div>
            <h2 className="mb-3 font-display text-[19px] font-medium text-ink">Clientes que mais usam</h2>
            {r.by_client.length === 0 ? <p className="text-[13.5px] text-stone">Sem reservas no período.</p> : (
              <DataTable>
                <thead><tr><Th>Cliente</Th><Th>Reservas</Th><Th>Horas</Th><Th className="text-right">Valor</Th></tr></thead>
                <tbody>
                  {r.by_client.map((c) => (
                    <tr key={c.id}><Td className="font-medium">{c.name}</Td><Td>{c.bookings}</Td><Td>{fmtDuration(c.minutes)}</Td><Td className="text-right font-medium">{fmtMoney(c.revenue_cents)}</Td></tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        </div>
      )}
    </>
  );
}
