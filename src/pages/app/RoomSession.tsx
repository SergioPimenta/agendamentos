import { Link, useParams } from 'react-router-dom';
import { CalendarClock, DoorOpen } from 'lucide-react';
import { SessionPanel } from '../../components/booking/SessionPanel';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Card } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { fmtDateLong, fmtDuration, relativeDay } from '../../lib/format';
import { api } from '../../services/api';
import type { RoomSessionResponse } from '../../types';

/** Página aberta ao escanear o QR code da porta da sala: check-in e check-out em um toque. */
export default function RoomSession() {
  const { slug } = useParams();
  const q = useApi(() => api.get<RoomSessionResponse>(`/rooms/${slug}/session`), [slug]);

  if (q.loading && !q.data) return <PageLoader />;
  if (q.error || !q.data) {
    return (
      <Card>
        <ErrorState message={q.error ?? 'Não foi possível carregar.'} onRetry={q.refetch} />
      </Card>
    );
  }

  const { room, booking, next, overtime_estimate } = q.data;

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="overflow-hidden rounded-[26px] border border-ink/8 bg-cream">
        <div className="relative aspect-[16/7] bg-mist-light">
          {room.image && <img src={room.image} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-sage-900/70 via-transparent to-transparent" />
          <div className="absolute right-6 bottom-5 left-6">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-cream/80 uppercase">Você está na</p>
            <h1 className="font-display text-[28px] leading-tight font-medium text-cream">{room.name}</h1>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          {booking ? (
            <>
              <div className="mb-5 flex items-start gap-3 border-b border-ink/8 pb-5">
                <CalendarClock size={20} className="mt-0.5 shrink-0 text-sage-700" />
                <div>
                  <p className="text-[15px] font-semibold text-ink">
                    {booking.start_time} às {booking.end_time} <span className="font-normal text-stone">({fmtDuration(booking.total_minutes)})</span>
                  </p>
                  <p className="text-[13px] text-stone">{relativeDay(booking.date) ?? fmtDateLong(booking.date)} · Reserva {booking.code}</p>
                </div>
              </div>
              <SessionPanel booking={booking} method="qr" estimate={overtime_estimate} onChanged={() => q.reload()} />
            </>
          ) : (
            <EmptyState
              icon={<DoorOpen />}
              title="Nenhuma reserva sua nesta sala agora"
              description="Para usar a sala, reserve um horário. O check-in abre alguns minutos antes do início."
              action={<LinkButton to={`/app/salas/${room.slug}`}>Reservar esta sala</LinkButton>}
            />
          )}

          {next && (
            <p className="mt-6 rounded-xl bg-sand px-4 py-3 text-[13px] text-stone">
              Sua próxima reserva aqui: <strong className="text-ink">{relativeDay(next.date) ?? fmtDateLong(next.date)}, {next.start_time} às {next.end_time}</strong>.
            </p>
          )}
        </div>
      </div>

      <p className="mt-5 text-center text-[12.5px] text-stone">
        <Link to="/app/reservas" className="font-semibold text-sage-700 no-underline hover:underline">Ver todas as minhas reservas</Link>
      </p>
    </div>
  );
}
