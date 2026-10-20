import { useState } from 'react';
import { CalendarPlus, History } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingFormModal } from '../../components/booking/BookingFormModal';
import { BookingRow } from '../../components/booking/BookingRow';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { PageHeader, Segmented } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { useBookingMeta } from '../../hooks/useBookingMeta';
import { fmtMonth } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking } from '../../types';

export default function MyBookings() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const { meta } = useBookingMeta();
  const q = useApi(() => api.get<{ bookings: Booking[] }>('/bookings', { scope }), [scope]);

  const bookings = q.data?.bookings ?? [];
  // Agrupa por mês para leitura mais fácil
  const groups = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
    (acc[b.date.slice(0, 7)] ||= []).push(b);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        eyebrow="Reservas"
        title="Minhas reservas"
        description="Acompanhe, altere ou cancele seus horários."
        actions={<LinkButton to="/app/reservar"><CalendarPlus size={16} />Nova reserva</LinkButton>}
      />

      <Segmented
        className="mb-6"
        value={scope}
        onChange={setScope}
        options={[{ value: 'upcoming', label: 'Próximas' }, { value: 'past', label: 'Histórico' }]}
      />

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      {q.loading && !q.data ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px] rounded-[20px]" />)}</div>
      ) : bookings.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream">
          <EmptyState
            icon={scope === 'upcoming' ? <CalendarPlus /> : <History />}
            title={scope === 'upcoming' ? 'Nenhuma reserva por vir' : 'Seu histórico está vazio'}
            description={scope === 'upcoming' ? 'Que tal garantir seu próximo horário?' : 'Suas reservas passadas e canceladas aparecem aqui.'}
            action={scope === 'upcoming' ? <LinkButton to="/app/reservar">Reservar uma sala</LinkButton> : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Object.entries(groups).map(([month, list]) => (
            <section key={month}>
              <h2 className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-stone uppercase">{fmtMonth(month)}</h2>
              <div className="flex flex-col gap-3">
                {list.map((b) => <BookingRow key={b.id} booking={b} onClick={() => setSelected(b)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <BookingDetail
        booking={selected}
        onClose={() => setSelected(null)}
        onEdit={(b) => { setSelected(null); setEditing(b); }}
        onChanged={q.reload}
      />

      {meta && (
        <BookingFormModal
          open={!!editing}
          onClose={() => setEditing(null)}
          booking={editing}
          rooms={meta.rooms}
          hours={meta.hours}
          settings={meta.settings}
          onSaved={q.reload}
        />
      )}
    </>
  );
}
