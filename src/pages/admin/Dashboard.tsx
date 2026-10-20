import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Clock, Hourglass, Users, Wallet } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingFormModal } from '../../components/booking/BookingFormModal';
import { BookingRow } from '../../components/booking/BookingRow';
import { Badge, EmptyState, ErrorState, SessionBadge, Skeleton } from '../../components/ui/Feedback';
import { Card, CardHeader, PageHeader, Stat } from '../../components/ui/Misc';
import { LinkButton } from '../../components/ui/Button';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { firstName, fmtDateLong, fmtDateShort, fmtDuration, fmtHours, fmtMoney, fmtWeekdayShort } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import type { Booking, BusinessHours, LiveRoom, PublicSettings, Room } from '../../types';

interface Dashboard {
  today: { date: string; bookings: Booking[] };
  upcoming: Booking[];
  kpis: {
    pending_approvals: number; active_clients: number; month_bookings: number; month_minutes: number;
    month_revenue_cents: number; month_paid_cents: number; receivable_cents: number; rooms: number;
  };
  series: { date: string; minutes: number; bookings: number; capacity_minutes: number; is_today: boolean }[];
  top_rooms: { id: number; name: string; bookings: number; minutes: number }[];
  rooms_live: LiveRoom[];
  no_checkin: Booking[];
}

export default function AdminDashboard() {
  const { user, can } = useAuth();
  const q = useApi(() => api.get<Dashboard>('/admin/dashboard'), []);
  const meta = useApi(async () => {
    const [rooms, s] = await Promise.all([
      api.get<{ rooms: Room[] }>('/rooms'),
      api.get<{ settings: PublicSettings; hours: BusinessHours[] }>('/admin/settings'),
    ]);
    return { rooms: rooms.rooms, settings: s.settings, hours: s.hours };
  }, []);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const d = q.data;

  const maxMinutes = Math.max(1, ...(d?.series.map((s) => Math.max(s.minutes, 1)) ?? [1]));
  const maxTop = Math.max(1, ...(d?.top_rooms.map((r) => r.minutes) ?? [1]));

  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title={<>Olá, <em className="font-normal not-italic text-sage-700">{firstName(user?.name)}</em></>}
        description={<span>{fmtDateLong(d?.today.date ?? new Date().toISOString().slice(0, 10))}</span>}
        actions={can('agenda') && <LinkButton to="/admin/agenda">Abrir agenda</LinkButton>}
      />

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-5">
        {!d ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[128px] rounded-[22px]" />) : (
          <>
            <Stat label="Hoje" value={d.today.bookings.length} hint={d.today.bookings.length === 1 ? 'reserva' : 'reservas'} icon={<CalendarCheck />} />
            <Stat label="Aprovações" value={d.kpis.pending_approvals} hint={d.kpis.pending_approvals ? (can('bookings') ? <Link to="/admin/reservas?status=pending" className="font-semibold text-amber no-underline">Revisar agora →</Link> : 'Aguardando aprovação') : 'Nada pendente'} icon={<Hourglass />} tone="amber" />
            <Stat label="Horas no mês" value={fmtHours(d.kpis.month_minutes)} hint={`${d.kpis.month_bookings} reservas`} icon={<Clock />} />
            <Stat label="Receita do mês" value={fmtMoney(d.kpis.month_revenue_cents)} hint={`${fmtMoney(d.kpis.month_paid_cents)} recebido`} icon={<Wallet />} tone="clay" />
            <Stat label="A receber" value={fmtMoney(d.kpis.receivable_cents)} hint={`${d.kpis.active_clients} clientes ativos`} icon={<Users />} tone="amber" />
          </>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader title="Salas agora" subtitle="Quem está usando cada sala neste momento" action={can('qrcodes') && <Link to="/admin/qr-codes" className="text-[13px] font-semibold text-sage-700 no-underline hover:underline">QR das salas</Link>} />
        {!d ? <Skeleton className="h-[120px]" /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.rooms_live.map((l) => (
              <button
                key={l.room.id}
                type="button"
                disabled={!l.booking}
                onClick={() => l.booking && setSelected(l.booking)}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl border border-l-4 p-4 text-left transition-[filter,box-shadow]',
                  // Cores suaves por situação: livre = verde claro, em uso = terracota claro, aguardando = âmbar, excedendo = rosa.
                  l.state === 'free' && 'border-sage/30 border-l-sage bg-sage-dim',
                  l.state === 'in_use' && 'border-clay/30 border-l-clay bg-clay-dim',
                  l.state === 'awaiting_checkin' && 'border-amber/30 border-l-amber bg-amber-dim',
                  l.state === 'overtime' && 'border-rose/35 border-l-rose bg-rose-dim',
                  l.booking && 'cursor-pointer hover:brightness-[0.97] hover:shadow-[0_8px_20px_-14px_rgba(38,42,34,0.5)]',
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-display text-[17px] font-medium text-ink">{l.room.name}</span>
                  {l.state === 'free' ? <Badge tone="sage">Livre</Badge> : <SessionBadge state={l.state} />}
                </span>
                <span className="text-[13px] text-stone">
                  {l.booking
                    ? <><strong className="font-semibold text-ink">{l.booking.user?.name}</strong> · {l.booking.start_time} às {l.booking.end_time}</>
                    : l.next
                      ? <>Próxima: {l.next.start_time} · {l.next.client}</>
                      : 'Sem mais reservas hoje'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="Ocupação" subtitle="Horas reservadas nos últimos 6 e próximos 7 dias" />
          {!d ? <Skeleton className="h-[200px]" /> : (
            <div className="flex h-[210px] items-end gap-1.5 sm:gap-2.5" role="img" aria-label="Gráfico de horas reservadas por dia">
              {d.series.map((s) => {
                const pct = s.capacity_minutes ? Math.round((s.minutes / s.capacity_minutes) * 100) : 0;
                return (
                  <div key={s.date} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${fmtDateShort(s.date)} · ${fmtDuration(s.minutes)} (${pct}%)`}>
                    <span className="text-[10.5px] font-semibold text-stone opacity-0 transition-opacity group-hover:opacity-100">{s.minutes ? fmtDuration(s.minutes) : ''}</span>
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className={cn('w-full rounded-t-[10px] transition-all duration-500', s.is_today ? 'bg-clay' : s.date < d.today.date ? 'bg-sage/50' : 'bg-sage-700', s.capacity_minutes === 0 && 'bg-mist')}
                        style={{ height: `${Math.max(4, (s.minutes / maxMinutes) * 100)}%` }}
                      />
                    </div>
                    <span className={cn('text-[10.5px] font-medium capitalize', s.is_today ? 'text-clay' : 'text-stone-light')}>{fmtWeekdayShort(s.date).slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Salas mais usadas" subtitle="Neste mês" />
          {!d ? <Skeleton className="h-[200px]" /> : d.top_rooms.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-stone">Ainda sem reservas neste mês.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {d.top_rooms.map((r) => (
                <li key={r.id}>
                  <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="text-stone">{fmtDuration(r.minutes)} · {r.bookings}×</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sage-dim"><div className="h-full rounded-full bg-sage-700" style={{ width: `${(r.minutes / maxTop) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Hoje" subtitle="Reservas do dia" />
          {!d ? <Skeleton className="h-[180px]" /> : d.today.bookings.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="Dia tranquilo" description="Nenhuma reserva para hoje." />
          ) : (
            <div className="flex flex-col gap-3">{d.today.bookings.map((b) => <BookingRow key={b.id} booking={b} showClient onClick={() => setSelected(b)} />)}</div>
          )}
        </Card>
        <Card>
          <CardHeader title="Próximas reservas" />
          {!d ? <Skeleton className="h-[180px]" /> : d.upcoming.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="Sem reservas futuras" />
          ) : (
            <div className="flex flex-col gap-3">{d.upcoming.slice(0, 5).map((b) => <BookingRow key={b.id} booking={b} showClient onClick={() => setSelected(b)} />)}</div>
          )}
        </Card>
      </div>

      {d && d.no_checkin.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Sem check-in" subtitle="Reservas que já terminaram e ninguém fez check-in (últimos 14 dias). Registre o uso ou marque como não compareceu." />
          <div className="flex flex-col gap-3">{d.no_checkin.slice(0, 6).map((b) => <BookingRow key={b.id} booking={b} showClient onClick={() => setSelected(b)} />)}</div>
        </Card>
      )}

      <BookingDetail booking={selected} admin onClose={() => setSelected(null)} onEdit={(b) => { setSelected(null); setEditing(b); }} onChanged={q.reload} />
      {meta.data && <BookingFormModal open={!!editing} onClose={() => setEditing(null)} admin booking={editing} rooms={meta.data.rooms} hours={meta.data.hours} settings={meta.data.settings} onSaved={q.reload} />}
    </>
  );
}
