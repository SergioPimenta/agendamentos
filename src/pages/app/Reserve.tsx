import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarX2, Info, MoonStar, Users } from 'lucide-react';
import { BookingFormModal, type BookingFormInitial } from '../../components/booking/BookingFormModal';
import { MiniCalendar } from '../../components/booking/MiniCalendar';
import { SlotStrip } from '../../components/booking/SlotStrip';
import { EmptyState, ErrorState, PageLoader, Skeleton } from '../../components/ui/Feedback';
import { Card, PageHeader } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { useBookingMeta } from '../../hooks/useBookingMeta';
import { cn } from '../../lib/cn';
import { addDays, addMonths, fmtDateLong, fmtDuration, fmtMoney, fmtWeekdayShort, relativeDay, todayStr } from '../../lib/format';
import { api } from '../../services/api';
import type { DayAvailability, MonthDay, Slot } from '../../types';

const freeSummary = (slots: Slot[], step: number) => {
  const free = slots.filter((s) => s.state === 'free');
  return { next: free[0]?.time, minutes: free.length * step };
};

export default function Reserve() {
  const { meta, loading: metaLoading, error: metaError } = useBookingMeta();
  const [params, setParams] = useSearchParams();
  const roomFilter = Number(params.get('room')) || 0;
  const { user } = useAuth();
  const navigate = useNavigate();

  // Vindo do login (ou de um link), a data e o horário escolhidos chegam pela URL.
  const startDate = (() => {
    const d = params.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  })();
  const [date, setDate] = useState(startDate ?? todayStr());
  const [month, setMonth] = useState((startDate ?? todayStr()).slice(0, 7));
  const [form, setForm] = useState<BookingFormInitial | null>(null);
  const [showCal, setShowCal] = useState(false);

  const monthQ = useApi(
    () => api.get<{ days: MonthDay[] }>('/availability/month', { month, room_id: roomFilter || undefined }),
    [month, roomFilter],
  );
  const dayQ = useApi(
    () => api.get<DayAvailability>('/availability/day', { date, room_id: roomFilter || undefined }),
    [date, roomFilter],
  );

  // Se hoje já está fechado/lotado, salta para o primeiro dia com vaga (olhando até 2 meses à frente).
  const [jump, setJump] = useState<'idle' | 'searching' | 'done'>(startDate ? 'done' : 'idle');
  useEffect(() => {
    const days = monthQ.data?.days;
    if (jump === 'done' || !days || days[0]?.date.slice(0, 7) !== month) return;
    const current = days.find((d) => d.date === date);
    if (jump === 'idle' && current?.state === 'available') return setJump('done');
    const next = days.find((d) => d.state === 'available' && d.date >= date);
    if (next) {
      setDate(next.date);
      return setJump('done');
    }
    if (month < addMonths(todayStr().slice(0, 7), 2)) {
      setJump('searching');
      setMonth(addMonths(month, 1));
    } else setJump('done');
  }, [monthQ.data, jump, date, month]);

  useEffect(() => {
    const start = params.get('start');
    if (!user || !meta || !startDate || !start || !roomFilter) return;
    setForm({ room_id: roomFilter, date: startDate, start_time: start });
    setParams({ room: String(roomFilter) }, { replace: true });
  }, [user, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Visitante: guarda a escolha na URL e manda entrar; depois do login volta e abre a reserva. */
  const goLogin = (roomId: number, day: string, time: string) => {
    const q = new URLSearchParams({ room: String(roomId), date: day, start: time });
    navigate('/login', { state: { from: `/reservar?${q.toString()}` } });
  };

  const pick = (d: string) => {
    setDate(d);
    setMonth(d.slice(0, 7));
  };

  const refresh = () => {
    monthQ.reload();
    dayQ.reload();
  };

  const step = dayQ.data?.step ?? meta?.settings.slot_step_minutes ?? 30;
  const rel = relativeDay(date);

  const visible = useMemo(() => dayQ.data?.rooms ?? [], [dayQ.data]);

  if (metaLoading) return <PageLoader />;
  if (metaError || !meta) return <ErrorState message={metaError ?? 'Não foi possível carregar.'} />;

  return (
    <>
      <PageHeader
        eyebrow="Reservas"
        title="Reservar uma sala"
        description={user ? 'Escolha o dia e clique em um horário livre. A confirmação é imediata.' : 'Veja os horários livres de cada sala. Ao escolher um, você entra na sua conta para confirmar.'}
      />

      {meta.settings.notice_message && (
        <p className="mb-6 flex items-start gap-2.5 rounded-2xl bg-amber-dim px-5 py-3.5 text-[13.5px] text-amber">
          <Info size={17} className="mt-0.5 shrink-0" />{meta.settings.notice_message}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0 lg:hidden">
          <DayStrip date={date} days={monthQ.data?.days} onPick={pick} />
          <button type="button" onClick={() => setShowCal((v) => !v)} className="mt-3 inline-flex items-center gap-2 text-[13px] font-semibold text-sage-700">
            <CalendarDays size={16} />{showCal ? 'Ocultar calendário' : 'Abrir calendário do mês'}
          </button>
          {showCal && <Card className="animate-pop mt-3"><MiniCalendar month={month} onMonthChange={setMonth} days={monthQ.data?.days} value={date} onChange={(d) => { pick(d); setShowCal(false); }} /></Card>}
        </div>
        <Card className="hidden lg:sticky lg:top-8 lg:block">
          <MiniCalendar month={month} onMonthChange={setMonth} days={monthQ.data?.days} value={date} onChange={pick} />
        </Card>

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-sage-700 uppercase">{rel ?? 'Dia escolhido'}</p>
              <h2 className="font-display text-[26px] leading-tight font-medium text-ink">{fmtDateLong(date)}</h2>
              {dayQ.data?.open && <p className="mt-1 text-[13px] text-stone">Aberto das {dayQ.data.open_time} às {dayQ.data.close_time}</p>}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por sala">
              {[{ id: 0, name: 'Todas' }, ...meta.rooms].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setParams(r.id ? { room: String(r.id) } : {}, { replace: true })}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                    roomFilter === r.id ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/12 bg-cream text-stone hover:border-sage-700 hover:text-sage-700',
                  )}
                >
                  {r.name.replace(/^Sala /, '')}
                </button>
              ))}
            </div>
          </div>

          {dayQ.error && <ErrorState message={dayQ.error} onRetry={dayQ.refetch} />}

          {dayQ.loading && !dayQ.data ? (
            <div className="flex flex-col gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[168px] rounded-[22px]" />)}</div>
          ) : dayQ.data && !dayQ.data.open ? (
            <Card><EmptyState icon={<MoonStar />} title="Fechado neste dia" description="O espaço não funciona nesta data. Escolha outro dia no calendário." /></Card>
          ) : dayQ.data?.beyond ? (
            <Card><EmptyState icon={<CalendarX2 />} title="Ainda não abrimos esta data" description={`As reservas abrem com até ${meta.settings.max_advance_days} dias de antecedência.`} /></Card>
          ) : (
            <div className={cn('flex flex-col gap-4 transition-opacity', dayQ.loading && 'opacity-60')}>
              {visible.map(({ room, slots }) => {
                const sum = freeSummary(slots, step);
                return (
                  <article key={room.id} className="animate-fade-up overflow-hidden rounded-[22px] border border-ink/8 bg-cream">
                    <div className="flex flex-col gap-5 p-4 sm:p-5">
                      <div className="flex items-center gap-4">
                        <Link to={`/app/salas/${room.slug}`} aria-label={`Ver ${room.name}`} className="shrink-0">
                          <img src={room.image} alt="" loading="lazy" className="h-16 w-16 rounded-2xl object-cover sm:h-[72px] sm:w-[72px]" />
                        </Link>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display text-[19px] font-medium text-ink"><Link to={`/app/salas/${room.slug}`} className="no-underline hover:text-sage-700">{room.name}</Link></h3>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-stone">
                            <span className="inline-flex items-center gap-1.5"><Users size={13} />até {room.capacity}</span>
                            <span>{fmtMoney(room.price_cents)}/h</span>
                            <span className="text-stone-light">mín. {fmtDuration(room.min_minutes)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          {sum.next ? (
                            <>
                              <p className="text-[11px] font-semibold tracking-[0.12em] text-sage-700 uppercase">Próximo livre</p>
                              <p className="font-display text-[20px] leading-tight font-medium text-ink">{sum.next}</p>
                            </>
                          ) : (
                            <p className="rounded-full bg-mist-light px-3 py-1 text-[12px] font-semibold text-stone">Sem horários</p>
                          )}
                        </div>
                      </div>
                      <SlotStrip slots={slots} step={step} onPick={(time) => (user ? setForm({ room_id: room.id, date, start_time: time }) : goLogin(room.id, date, time))} />
                    </div>
                  </article>
                );
              })}
              {!visible.length && !dayQ.loading && <Card><EmptyState icon={<CalendarX2 />} title="Nenhuma sala disponível" /></Card>}
            </div>
          )}

          <p className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[12px] text-stone">
            <span className="flex items-center gap-2"><i className="h-3 w-5 rounded bg-sage-dim" />Livre</span>
            <span className="flex items-center gap-2"><i className="bg-hatch h-3 w-5 rounded bg-mist-light" />Ocupado</span>
            <span className="flex items-center gap-2"><i className="h-3 w-5 rounded bg-sage-700" />Sua reserva</span>
            <span className="flex items-center gap-2"><i className="h-3 w-5 rounded bg-sand-deep" />Indisponível</span>
          </p>
        </div>
      </div>

      <BookingFormModal
        open={!!form}
        onClose={() => setForm(null)}
        rooms={meta.rooms}
        hours={meta.hours}
        settings={meta.settings}
        initial={form ?? undefined}
        onSaved={refresh}
      />
    </>
  );
}

/** Faixa de 21 dias para navegação rápida no celular. */
function DayStrip({ date, days, onPick }: { date: string; days: MonthDay[] | undefined; onPick: (d: string) => void }) {
  const today = todayStr();
  const list = Array.from({ length: 21 }, (_, i) => addDays(today, i));
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1" role="group" aria-label="Escolher dia">
      <div className="flex gap-2">
        {list.map((d) => {
          const info = byDate.get(d);
          const off = info && (info.state === 'closed' || info.state === 'past' || info.state === 'beyond');
          const selected = d === date;
          return (
            <button
              key={d}
              type="button"
              disabled={!!off}
              onClick={() => onPick(d)}
              aria-pressed={selected}
              ref={(el) => { if (el && selected) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }}
              className={cn(
                'flex w-[58px] shrink-0 flex-col items-center gap-0.5 rounded-2xl border py-2.5 transition-colors',
                selected ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/10 bg-cream text-ink',
                off && 'opacity-35',
              )}
            >
              <span className="text-[10.5px] font-semibold tracking-wide uppercase">{fmtWeekdayShort(d).slice(0, 3)}</span>
              <span className="font-display text-[20px] leading-none font-medium">{Number(d.slice(8))}</span>
              <span className={cn('h-1 w-1 rounded-full', info?.state === 'full' ? 'bg-rose/70' : info?.state === 'available' ? (selected ? 'bg-cream' : 'bg-sage') : 'bg-transparent')} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
