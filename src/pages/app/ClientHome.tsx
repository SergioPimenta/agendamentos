import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck, CalendarPlus, DoorOpen, Receipt, Sparkles } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingFormModal } from '../../components/booking/BookingFormModal';
import { BookingRow } from '../../components/booking/BookingRow';
import { SessionPanel } from '../../components/booking/SessionPanel';
import { CanopyMotif } from '../../components/brand/harmonizeUi';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, Skeleton } from '../../components/ui/Feedback';
import { Card, CardHeader, ProgressBar } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { useBookingMeta } from '../../hooks/useBookingMeta';
import { firstName, fmtDuration, fmtMoney, fmtMonth } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking, Statement } from '../../types';

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};

const shortcuts = [
  { to: '/app/reservar', label: 'Reservar sala', icon: <CalendarPlus size={22} />, hint: 'Escolha dia e horário' },
  { to: '/app/reservas', label: 'Minhas reservas', icon: <CalendarCheck size={22} />, hint: 'Altere ou cancele' },
  { to: '/app/salas', label: 'Conhecer as salas', icon: <DoorOpen size={22} />, hint: 'Fotos e comodidades' },
  { to: '/app/consumo', label: 'Consumo e faturas', icon: <Receipt size={22} />, hint: 'Horas e valores' },
];

export default function ClientHome() {
  const { user } = useAuth();
  const { meta } = useBookingMeta();
  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const upcoming = useApi(() => api.get<{ bookings: Booking[] }>('/bookings', { scope: 'upcoming' }), []);
  const usage = useApi(() => api.get<Statement>('/me/usage'), []);

  const list = upcoming.data?.bookings.slice(0, 4) ?? [];
  const u = usage.data;
  // Reserva que está acontecendo agora (ou que já pode fazer check-in): aparece no topo, com as ações.
  const now = upcoming.data?.bookings.find((b) => b.session.can_check_in || b.session.can_check_out || ['in_use', 'overtime', 'awaiting_checkin'].includes(b.session.state ?? ''));

  return (
    <>
      <section className="animate-fade-up relative mb-6 overflow-hidden rounded-[28px] bg-sage-900 p-7 text-cream sm:p-10">
        <CanopyMotif className="-top-20 -right-16 h-[340px] w-[340px] opacity-80 [&_span]:bg-cream/10" />
        <div className="relative z-10 max-w-[560px]">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-sage-light uppercase">{greeting()}</p>
          <h1 className="font-display text-[clamp(1.9rem,4vw,3rem)] leading-[1.06] font-medium tracking-[-0.02em]">
            Olá, <em className="font-normal not-italic text-sage-light">{firstName(user?.name)}</em>. Que espaço vamos reservar?
          </h1>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton to="/app/reservar" variant="light" size="lg">Reservar agora <ArrowRight size={16} /></LinkButton>
            <LinkButton to="/app/salas" variant="outline-light" size="lg">Ver salas</LinkButton>
          </div>
        </div>
      </section>

      {now && (
        <Card className="animate-fade-up mb-6 border-sage-700/25">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <img src={now.room.image} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
              <div>
                <p className="text-[11px] font-semibold tracking-[0.18em] text-sage-700 uppercase">Sua reserva agora</p>
                <h2 className="font-display text-[22px] leading-tight font-medium text-ink">{now.room.name}</h2>
                <p className="text-[13.5px] text-stone">{now.start_time} às {now.end_time}</p>
              </div>
            </div>
            <div className="sm:max-w-[360px]"><SessionPanel booking={now} onChanged={() => { upcoming.reload(); usage.reload(); }} /></div>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {shortcuts.map((s, i) => (
          <Link
            key={s.to}
            to={s.to}
            style={{ animationDelay: `${i * 60}ms` }}
            className="animate-fade-up group flex flex-col gap-3 rounded-[22px] border border-ink/8 bg-cream p-5 no-underline transition-all duration-300 hover:-translate-y-1 hover:border-sage-700/30 hover:shadow-[0_26px_44px_-26px_rgba(44,54,39,0.4)]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage-dim text-sage-700 transition-colors duration-300 group-hover:bg-sage-700 group-hover:text-cream">{s.icon}</span>
            <span>
              <span className="block font-display text-[16px] leading-tight font-medium text-ink">{s.label}</span>
              <span className="mt-0.5 block text-[12.5px] text-stone">{s.hint}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Próximas reservas" action={list.length > 0 && <Link to="/app/reservas" className="text-[13px] font-semibold text-sage-700 no-underline hover:underline">Ver todas</Link>} />
          {upcoming.loading && !upcoming.data ? (
            <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-[88px]" />)}</div>
          ) : list.length === 0 ? (
            <EmptyState icon={<CalendarPlus />} title="Nada agendado por enquanto" description="Reserve uma sala e ela aparece aqui." action={<LinkButton to="/app/reservar">Reservar uma sala</LinkButton>} />
          ) : (
            <div className="flex flex-col gap-3">{list.map((b) => <BookingRow key={b.id} booking={b} onClick={() => setSelected(b)} />)}</div>
          )}
        </Card>

        <Card>
          <CardHeader title="Seu plano" subtitle={fmtMonth(u?.month ?? new Date().toISOString().slice(0, 7))} />
          {!u ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-sage-dim px-3.5 py-1.5 text-[12.5px] font-semibold text-sage-700">{u.plan?.name ?? 'Sem plano'}</span>
                {u.plan && u.plan.room_discount_percent > 0 && <span className="text-[12px] text-stone">{u.plan.room_discount_percent}% off nas demais horas</span>}
              </div>

              {u.plan?.unlimited ? (
                <p className="flex items-center gap-2.5 rounded-2xl bg-sage-dim px-4 py-3.5 text-[13.5px] text-sage-800"><Sparkles size={18} className="text-sage-700" />Salas ilimitadas no seu plano.</p>
              ) : u.included_total ? (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-[30px] leading-none font-medium text-ink">{fmtDuration(u.included_remaining ?? 0)}</span>
                    <span className="text-[12.5px] text-stone">restantes de {fmtDuration(u.included_total)}</span>
                  </div>
                  <ProgressBar value={u.included_used} max={u.included_total} />
                </div>
              ) : (
                <p className="text-[13.5px] leading-relaxed text-stone">Você paga apenas pelas horas que usar. <Link to="/app/planos" className="font-semibold text-sage-700">Conheça os planos</Link> com horas incluídas.</p>
              )}

              <div className="grid grid-cols-2 gap-3 border-t border-ink/8 pt-4">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Horas no mês</p>
                  <p className="mt-1 font-display text-[20px] font-medium text-ink">{fmtDuration(u.totals.minutes)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">A pagar</p>
                  <p className="mt-1 font-display text-[20px] font-medium text-ink">{fmtMoney(u.totals.pending_cents)}</p>
                </div>
              </div>
              <Link to="/app/consumo" className="text-[13px] font-semibold text-sage-700 no-underline hover:underline">Ver consumo detalhado →</Link>
            </div>
          )}
        </Card>
      </div>

      <BookingDetail booking={selected} onClose={() => setSelected(null)} onEdit={(b) => { setSelected(null); setEditing(b); }} onChanged={() => { upcoming.reload(); usage.reload(); }} />
      {meta && <BookingFormModal open={!!editing} onClose={() => setEditing(null)} booking={editing} rooms={meta.rooms} hours={meta.hours} settings={meta.settings} onSaved={() => { upcoming.reload(); usage.reload(); }} />}
    </>
  );
}
