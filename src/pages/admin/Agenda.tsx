import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingFormModal, type BookingFormInitial } from '../../components/booking/BookingFormModal';
import { TimeGrid, type GridColumn, type GridEvent } from '../../components/booking/TimeGrid';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/Form';
import { PageHeader, Segmented } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { clientSwatch } from '../../lib/clientColor';
import { addDays, firstName, fmtDateLong, fmtDateShort, fmtWeekdayShort, relativeDay, startOfWeek, todayStr, weekdayOf } from '../../lib/format';
import { api } from '../../services/api';
import type { Block, Booking, BusinessHours, PublicSettings, Room } from '../../types';

interface AgendaData {
  from: string;
  to: string;
  step: number;
  hours: BusinessHours[];
  rooms: Room[];
  blocks: Block[];
  bookings: Booking[];
}

export default function Agenda() {
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(todayStr());
  const [roomId, setRoomId] = useState(0);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [form, setForm] = useState<{ initial?: BookingFormInitial; booking?: Booking | null } | null>(null);

  const from = view === 'day' ? date : startOfWeek(date);
  const to = view === 'day' ? date : addDays(from, 6);
  const q = useApi(() => api.get<AgendaData>('/admin/agenda', { from, to }), [from, to]);
  const settingsQ = useApi(() => api.get<{ settings: PublicSettings }>('/admin/settings'), []);

  const data = q.data;
  const activeRoom = data ? (data.rooms.find((r) => r.id === roomId) ?? data.rooms[0]) : undefined;

  const hoursOn = (d: string) => data?.hours.find((h) => h.weekday === weekdayOf(d));

  const { columns, events } = useMemo(() => {
    if (!data) return { columns: [] as GridColumn[], events: [] as GridEvent[] };
    const today = todayStr();
    const cols: GridColumn[] = [];
    const evs: GridEvent[] = [];

    const bookingEvent = (b: Booking, column: string): GridEvent => ({
      id: `b${b.id}`,
      column,
      start: b.start_time,
      end: b.end_time,
      title: b.user?.name ?? b.title,
      subtitle: view === 'week' ? b.title || b.code : `${b.start_time}–${b.end_time}${b.title ? ` · ${b.title}` : ''}`,
      tone: b.status === 'pending' ? 'pending' : b.status === 'no_show' ? 'noshow' : b.display_status === 'completed' ? 'done' : 'confirmed',
      label: `${b.user?.name ?? ''} · ${b.room.name} · ${b.start_time}–${b.end_time}`,
      colorKey: b.user?.id,
      badge: b.awaiting_payment ? 'Aguardando pag.' : b.status === 'pending' ? 'Pendente' : b.status === 'no_show' ? 'Faltou' : b.session.state === 'overtime' ? 'Excedendo' : b.session.state === 'in_use' ? 'Em uso' : b.session.state === 'awaiting_checkin' ? 'Chegou?' : undefined,
      onClick: () => setSelected(b),
    });

    const blockEvents = (columnKey: string, day: string, roomFilter: number | null) => {
      for (const blk of data.blocks) {
        if (blk.room_id != null && roomFilter != null && blk.room_id !== roomFilter) continue;
        const dayStart = `${day} 00:00`;
        const dayEnd = `${addDays(day, 1)} 00:00`;
        if (blk.end_at <= dayStart || blk.start_at >= dayEnd) continue;
        const s = blk.start_at < dayStart ? '00:00' : blk.start_at.slice(11);
        const e = blk.end_at > dayEnd ? '23:59' : blk.end_at.slice(11);
        evs.push({ id: `k${blk.id}-${columnKey}`, column: columnKey, start: s, end: e, title: blk.reason || 'Bloqueado', subtitle: blk.room_id == null ? 'Todas as salas' : undefined, tone: 'block', label: `Bloqueio: ${blk.reason}` });
      }
    };

    if (view === 'day') {
      const h = hoursOn(date);
      for (const room of data.rooms) {
        cols.push({ key: String(room.id), title: room.name.replace(/^Sala /, ''), subtitle: `até ${room.capacity} pessoas`, today: false, open: h?.open_time, close: h?.close_time, closed: !h?.is_open, nowLine: date === today });
        for (const b of data.bookings) if (b.room.id === room.id) evs.push(bookingEvent(b, String(room.id)));
        blockEvents(String(room.id), date, room.id);
      }
    } else if (activeRoom) {
      for (let i = 0; i < 7; i++) {
        const d = addDays(from, i);
        const h = hoursOn(d);
        cols.push({ key: d, title: fmtWeekdayShort(d).replace(/^./, (c) => c.toUpperCase()), subtitle: fmtDateShort(d), today: d === today, open: h?.open_time, close: h?.close_time, closed: !h?.is_open, nowLine: d === today });
        for (const b of data.bookings) if (b.room.id === activeRoom.id && b.date === d) evs.push(bookingEvent(b, d));
        blockEvents(d, d, activeRoom.id);
      }
    }
    return { columns: cols, events: evs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view, date, activeRoom?.id]);

  // Legenda: quem aparece na agenda agora (no dia ou na semana/sala exibidos), com a cor de cada um.
  const legend = useMemo(() => {
    if (!data) return [];
    const seen = new Map<number, { id: number; name: string; count: number }>();
    for (const b of data.bookings) {
      if (!b.user || (view === 'week' && activeRoom && b.room.id !== activeRoom.id)) continue;
      const e = seen.get(b.user.id) ?? { id: b.user.id, name: b.user.name, count: 0 };
      e.count += 1;
      seen.set(b.user.id, e);
    }
    return [...seen.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  }, [data, view, activeRoom?.id]);

  const shift = (n: number) => setDate(addDays(date, view === 'day' ? n : n * 7));
  const pendingCount = data?.bookings.filter((b) => b.status === 'pending').length ?? 0;

  const openNew = (column?: string, time?: string) => {
    if (!data) return;
    const initial: BookingFormInitial = view === 'day'
      ? { date, room_id: column ? Number(column) : data.rooms[0]?.id, start_time: time }
      : { date: column ?? date, room_id: activeRoom?.id, start_time: time };
    setForm({ initial });
  };

  const title = view === 'day'
    ? fmtDateLong(date)
    : `${fmtDateShort(from)} – ${fmtDateShort(to)}`;

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Agenda"
        description="Clique em um horário vazio para criar uma reserva, ou em uma reserva para gerenciá-la."
        actions={<Button icon={<Plus size={16} />} onClick={() => openNew()}>Nova reserva</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-ink/10 bg-cream p-1">
          <IconButton label="Anterior" onClick={() => shift(-1)}><ChevronLeft size={18} /></IconButton>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayStr())}>Hoje</Button>
          <IconButton label="Próximo" onClick={() => shift(1)}><ChevronRight size={18} /></IconButton>
        </div>
        <div>
          <h2 className="font-display text-[20px] leading-tight font-medium text-ink">{title}</h2>
          {view === 'day' && relativeDay(date) && <p className="text-[12px] text-sage-700">{relativeDay(date)}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {pendingCount > 0 && <span className="rounded-full bg-amber-dim px-3.5 py-1.5 text-[12px] font-semibold text-amber">{pendingCount} aguardando aprovação</span>}
          {view === 'week' && data && (
            <Select aria-label="Sala" className="py-2" value={activeRoom?.id ?? ''} onChange={(e) => setRoomId(Number(e.target.value))}>
              {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
          <Segmented value={view} onChange={setView} options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }]} />
        </div>
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {legend.length > 0 && (
        <ul className="mb-4 flex flex-wrap items-center gap-2" aria-label="Clientes na agenda">
          {legend.map((c) => (
            <li key={c.id} title={`${c.name} · ${c.count} reserva${c.count > 1 ? 's' : ''}`} className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-cream py-1 pr-3 pl-2 text-[12px] font-medium text-ink">
              <i className="h-3 w-3 rounded-full" style={{ backgroundColor: clientSwatch(c.id) }} />
              {firstName(c.name)}
              <span className="text-[11px] font-normal text-stone-light">{c.count}</span>
            </li>
          ))}
          <li className="ml-1 text-[11.5px] text-stone-light">Tracejado = aguardando aprovação · apagado e riscado = faltou</li>
        </ul>
      )}
      {!data ? <PageLoader /> : (
        <TimeGrid columns={columns} events={events} step={data.step} onEmptyClick={openNew} />
      )}

      <BookingDetail
        booking={selected}
        admin
        onClose={() => setSelected(null)}
        onEdit={(b) => { setSelected(null); setForm({ booking: b }); }}
        onChanged={q.reload}
      />

      {data && settingsQ.data && (
        <BookingFormModal
          open={!!form}
          onClose={() => setForm(null)}
          admin
          booking={form?.booking}
          initial={form?.initial}
          rooms={data.rooms}
          hours={data.hours}
          settings={settingsQ.data.settings}
          onSaved={q.reload}
        />
      )}
    </>
  );
}
