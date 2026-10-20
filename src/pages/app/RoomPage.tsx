import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Clock, DoorOpen, Expand, MapPin, Users } from 'lucide-react';
import { RoomBookingPanel } from '../../components/booking/RoomBookingPanel';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { LinkButton } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Card } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { useBookingMeta } from '../../hooks/useBookingMeta';
import { cn } from '../../lib/cn';
import { WEEKDAYS, fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { BusinessHours, Plan, Room } from '../../types';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const POLICY_PREVIEW_CHARS = 260;

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-t border-ink/8 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={18} className="shrink-0 text-stone transition-transform group-open:rotate-180" />
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

function HoursList({ hours }: { hours: BusinessHours[] }) {
  return (
    <ul className="grid gap-x-10 sm:grid-cols-2">
      {WEEK_ORDER.map((d) => {
        const h = hours.find((x) => x.weekday === d);
        return (
          <li key={d} className="flex items-center justify-between gap-4 border-b border-ink/6 py-2 text-[13.5px] last:border-0">
            <span className="text-stone">{WEEKDAYS[d]}</span>
            <span className={cn('font-medium', h?.is_open ? 'text-ink' : 'text-stone-light')}>{h?.is_open ? `${h.open_time} às ${h.close_time}` : 'Fechado'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PriceTable({ room, myPlanId }: { room: Room; myPlanId?: number }) {
  const plansQ = useApi(() => api.get<{ plans: Plan[] }>('/plans'), []);
  const plans = plansQ.data?.plans ?? [];
  const perHour = (discount: number) => Math.round((room.price_cents * (100 - discount)) / 100);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 text-[13.5px] sm:grid-cols-2">
        <div className="flex justify-between gap-4 border-b border-ink/6 pb-2"><dt className="text-stone">Valor da hora</dt><dd className="font-semibold text-ink">{fmtMoney(room.price_cents)}</dd></div>
        <div className="flex justify-between gap-4 border-b border-ink/6 pb-2"><dt className="text-stone">Reserva mínima</dt><dd className="font-semibold text-ink">{fmtDuration(room.min_minutes)}</dd></div>
        <div className="flex justify-between gap-4 border-b border-ink/6 pb-2"><dt className="text-stone">Reserva máxima</dt><dd className="font-semibold text-ink">{fmtDuration(room.max_minutes)}</dd></div>
        {room.buffer_minutes > 0 && (
          <div className="flex justify-between gap-4 border-b border-ink/6 pb-2"><dt className="text-stone">Intervalo entre reservas</dt><dd className="font-semibold text-ink">{fmtDuration(room.buffer_minutes)}</dd></div>
        )}
      </dl>

      {plans.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-ink/10 text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">
                <th className="py-2 pr-3">Plano</th>
                <th className="px-3 py-2">Horas incluídas</th>
                <th className="py-2 pl-3 text-right">Hora extra</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className={cn('border-b border-ink/6 last:border-0', p.id === myPlanId && 'bg-sage-dim/60')}>
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    {p.name}
                    {p.id === myPlanId && <span className="ml-2 rounded-full bg-sage-700 px-2 py-0.5 text-[10px] font-semibold text-cream">Seu plano</span>}
                  </td>
                  <td className="px-3 py-2.5 text-stone">{p.unlimited ? 'Ilimitadas' : p.included_minutes > 0 ? `${fmtDuration(p.included_minutes)}/mês` : '—'}</td>
                  <td className="py-2.5 pl-3 text-right font-semibold text-ink">
                    {p.unlimited ? 'Incluso' : fmtMoney(perHour(p.room_discount_percent))}
                    {!p.unlimited && p.room_discount_percent > 0 && <span className="ml-1.5 font-normal text-sage-700">−{p.room_discount_percent}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Policy({ text, cancelHours }: { text: string; cancelHours: number }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const long = text.length > POLICY_PREVIEW_CHARS || lines.length > 3;

  return (
    <div className="text-[13.5px] leading-relaxed text-stone">
      <ul className={cn('flex list-disc flex-col gap-2 pl-5', long && !expanded && 'max-h-[7.5rem] overflow-hidden')}>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
        <li>Alterações e cancelamentos pelo sistema até {cancelHours}h antes do início da reserva.</li>
      </ul>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 cursor-pointer text-[13px] font-semibold text-ink underline underline-offset-2">
          {expanded ? 'Mostrar menos' : 'Mostrar mais'}
        </button>
      )}
    </div>
  );
}

export default function RoomPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { meta, loading, error } = useBookingMeta();
  const [zoom, setZoom] = useState(false);
  const [sp, setSp] = useSearchParams();
  const initial = sp.get('date') && sp.get('start') ? { date: sp.get('date')!, start: sp.get('start')!, end: sp.get('end') ?? '' } : undefined;

  if (loading) return <PageLoader />;
  if (error || !meta) return <ErrorState message={error ?? 'Não foi possível carregar.'} />;

  const room = meta.rooms.find((r) => r.slug === slug);
  if (!room) {
    return (
      <Card>
        <EmptyState icon={<DoorOpen />} title="Sala não encontrada" description="Essa sala não existe ou não está mais disponível." action={<LinkButton to={user ? '/app/salas' : '/'} variant="secondary">Ver todas as salas</LinkButton>} />
      </Card>
    );
  }

  const s = meta.settings;

  return (
    <>
      <Link to={user ? '/app/salas' : '/'} className="mb-5 inline-flex items-center gap-2 text-[13px] font-semibold text-stone no-underline transition-colors hover:text-sage-700">
        <ArrowLeft size={16} />Todas as salas
      </Link>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <div className="relative aspect-[16/10] overflow-hidden rounded-[26px] bg-mist-light">
            {room.image && <img src={room.image} alt={room.name} className="h-full w-full object-cover" />}
            {room.image && (
              <button type="button" onClick={() => setZoom(true)} aria-label="Ampliar foto" className="absolute right-4 bottom-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-cream/90 text-ink backdrop-blur transition-colors hover:bg-cream">
                <Expand size={18} />
              </button>
            )}
          </div>

          <h1 className="mt-6 font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-tight font-medium tracking-[-0.015em] text-ink">{room.name}</h1>
          {s.business_address && (
            <p className="mt-2 flex items-start gap-2 text-[13.5px] text-stone"><MapPin size={16} className="mt-0.5 shrink-0 text-sage-700" />{s.business_address}</p>
          )}
          <p className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-stone">
            <span className="inline-flex items-center gap-2"><Users size={16} className="text-sage-700" />até {room.capacity} pessoas</span>
            <span className="inline-flex items-center gap-2"><DoorOpen size={16} className="text-sage-700" />Sala</span>
            <span className="inline-flex items-center gap-2"><Clock size={16} className="text-sage-700" />mín. {fmtDuration(room.min_minutes)} · {fmtMoney(room.price_cents)}/h</span>
          </p>

          {(room.tagline || room.description) && (
            <div className="mt-5 max-w-[68ch] text-[14.5px] leading-[1.75] text-stone">
              {room.tagline && <p className="font-medium text-ink">{room.tagline}</p>}
              {room.description && <p className="mt-2 whitespace-pre-line">{room.description}</p>}
            </div>
          )}

          {room.amenities.length > 0 && (
            <section className="mt-8" aria-labelledby="amenities">
              <h2 id="amenities" className="mb-3 text-[15px] font-semibold text-ink">Comodidades da sala</h2>
              <ul className="flex flex-wrap gap-2">
                {room.amenities.map((a) => (
                  <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-sage-dim px-3.5 py-1.5 text-[12.5px] font-medium text-sage-700"><Check size={13} />{a}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-8">
            <Section title="Horário de funcionamento"><HoursList hours={meta.hours} /></Section>
            <Section title="Tabela completa de valores"><PriceTable room={room} myPlanId={user?.plan?.id} /></Section>
            <Section title="Políticas de uso" defaultOpen><Policy text={s.usage_policy} cancelHours={s.cancel_min_hours} /></Section>
            <div className="border-t border-ink/8" />
          </div>
        </div>

        <RoomBookingPanel key={room.id} room={room} hours={meta.hours} settings={s} initial={initial} onBooked={() => setSp({}, { replace: true })} />
      </div>

      <Modal open={zoom} onClose={() => setZoom(false)} size="xl" title={room.name}>
        <img src={room.image} alt={room.name} className="w-full rounded-2xl object-contain" />
      </Modal>
    </>
  );
}
