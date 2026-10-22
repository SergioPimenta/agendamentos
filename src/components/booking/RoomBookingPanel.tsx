import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CalendarX2, ChevronDown, Info, MoonStar, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { addDays, addMonths, fmtDateLong, fmtDuration, fmtMoney, fromMin, toMin, todayStr, weekdayOf } from '../../lib/format';
import { api, ApiError } from '../../services/api';
import type { Booking, BusinessHours, DayAvailability, Guest, MonthDay, PaymentConfig, PublicSettings, Room } from '../../types';
import { Button } from '../ui/Button';
import { Skeleton, useToast } from '../ui/Feedback';
import { Input, Select, Textarea } from '../ui/Form';
import { Card, CardHeader } from '../ui/Misc';
import { GuestsField, cleanGuests, guestsError } from './GuestsField';
import { PaymentStep } from './PaymentStep';
import { SlotStrip } from './SlotStrip';

interface Quote {
  minutes: number;
  included_minutes: number;
  package_minutes?: number;
  price_cents: number;
  price_per_hour_cents: number;
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 480];

/** Reserva de UMA sala, direto na página dela: dia, faixa de horários, valor na hora e botão de reservar. */
export interface PanelInitial { date?: string; start?: string; end?: string }

export function RoomBookingPanel({
  room, hours, settings, initial, onBooked,
}: { room: Room; hours: BusinessHours[]; settings: PublicSettings; initial?: PanelInitial; onBooked?: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const step = settings.slot_step_minutes;
  const minLen = Math.max(room.min_minutes, step);

  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [pickingEnd, setPickingEnd] = useState(false);
  const [attendees, setAttendees] = useState(1);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(0);
  const [more, setMore] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  // Pagamento no ato da reserva (Pix / cartão), quando a administração ligou.
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [held, setHeld] = useState<Booking | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const dayQ = useApi(() => api.get<DayAvailability>('/availability/day', { date, room_id: room.id }), [date, room.id]);
  const dayHours = hours.find((h) => h.weekday === weekdayOf(date));
  const slots = dayQ.data?.rooms[0]?.slots ?? [];
  const freeCount = slots.filter((s) => s.state === 'free').length;

  // Ao abrir a página, vai direto para o primeiro dia com horário livre (a menos que a pessoa já tenha mexido na data).
  const touched = useRef(Boolean(initial?.date));
  useEffect(() => {
    let alive = true;
    (async () => {
      let month = todayStr().slice(0, 7);
      for (let i = 0; i < 3; i++) {
        const { days } = await api.get<{ days: MonthDay[] }>('/availability/month', { month, room_id: room.id });
        const next = days.find((d) => d.state === 'available' && d.date >= todayStr());
        if (next) {
          if (alive && !touched.current) setDate(next.date);
          return;
        }
        month = addMonths(month, 1);
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [room.id]);

  const clearTimes = () => {
    setStart('');
    setEnd('');
    setPickingEnd(false);
  };

  const changeDate = (d: string) => {
    touched.current = true;
    setDate(d);
    clearTimes();
  };

  const startOptions = useMemo(() => {
    if (!dayHours?.is_open) return [];
    const out: string[] = [];
    for (let m = toMin(dayHours.open_time); m + step <= toMin(dayHours.close_time); m += step) out.push(fromMin(m));
    return out;
  }, [dayHours, step]);

  const endOptions = useMemo(() => {
    if (!dayHours?.is_open || !start) return [];
    const out: string[] = [];
    for (let m = toMin(start) + step; m <= toMin(dayHours.close_time); m += step) out.push(fromMin(m));
    return out;
  }, [dayHours, start, step]);

  const pickStart = (t: string) => {
    setStart(t);
    setEnd(fromMin(toMin(t) + minLen));
  };

  /** 1º toque define o início; 2º toque, num horário depois dele, define o fim. */
  const onSlot = (t: string) => {
    if (start && pickingEnd && toMin(t) > toMin(start)) {
      setEnd(fromMin(toMin(t) + step));
      setPickingEnd(false);
      return;
    }
    pickStart(t);
    setPickingEnd(true);
  };

  const minutes = start && end ? toMin(end) - toMin(start) : 0;
  const durationChips = DURATIONS.filter(
    (d) => d >= room.min_minutes && d <= room.max_minutes && !!start && !!dayHours?.is_open && toMin(start) + d <= toMin(dayHours.close_time),
  );

  const quoteKey = useDebounced(JSON.stringify([room.id, date, start, end]), 300);
  useEffect(() => {
    if (!start || !end) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    if (!user) {
      // Visitante: só conferimos regras simples e mostramos o valor base (sem desconto de plano).
      const mins = toMin(end) - toMin(start);
      const window = slots.filter((s) => s.time >= start && s.time < end);
      setQuoting(false);
      if (mins < room.min_minutes) { setQuote(null); setQuoteError(`A reserva mínima desta sala é ${fmtDuration(room.min_minutes)}.`); }
      else if (mins > room.max_minutes) { setQuote(null); setQuoteError(`A reserva máxima desta sala é ${fmtDuration(room.max_minutes)}.`); }
      else if (slots.length > 0 && (window.length * step < mins || window.some((s) => s.state !== 'free'))) { setQuote(null); setQuoteError('Esse horário não está disponível. Escolha outro.'); }
      else { setQuoteError(''); setQuote({ minutes: mins, included_minutes: 0, price_cents: Math.round((room.price_cents * mins) / 60), price_per_hour_cents: room.price_cents }); }
      return;
    }
    let alive = true;
    setQuoting(true);
    api
      .post<Quote>('/bookings/quote', { room_id: room.id, date, start_time: start, end_time: end })
      .then((q) => alive && (setQuote(q), setQuoteError('')))
      .catch((e: ApiError) => alive && (setQuote(null), setQuoteError(e.message)))
      .finally(() => alive && setQuoting(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, user?.id, slots.length]);

  useEffect(() => {
    if (!user) return setCfg(null);
    api.get<PaymentConfig>('/payments/config').then(setCfg).catch(() => setCfg(null));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsPayment = !!user && !!cfg?.pay_on_booking && cfg.methods.length > 0 && repeat === 0 && !!quote && quote.price_cents >= 100;

  const blocked = !!quoteError || quoting || !start || !end || !dayHours?.is_open;

  const goLogin = () => {
    const q = new URLSearchParams({ date, start, end });
    navigate('/login', { state: { from: `${location.pathname}?${q.toString()}` } });
  };

  const submit = async () => {
    if (blocked) return;
    if (!user) return goLogin();
    const gErr = guestsError(guests, user.email);
    if (gErr) return setSubmitError(gErr);
    setSubmitError('');
    setSaving(true);
    try {
      const res = await api.post<{ bookings: Booking[]; skipped: { date: string }[]; payment_required?: boolean }>('/bookings', {
        room_id: room.id, date, start_time: start, end_time: end, title, notes,
        attendees: Number(attendees) || 1, repeat_weeks: repeat, skip_conflicts: true, guests: cleanGuests(guests),
      });
      if (res.payment_required) {
        setHeld(res.bookings[0]); // horário segurado: segue para o pagamento, aqui mesmo
        return;
      }
      const n = res.bookings.length;
      toast.success(
        res.bookings[0]?.status === 'pending'
          ? 'Pedido enviado! Você será avisado quando for aprovado.'
          : n > 1 ? `${n} reservas confirmadas.` : 'Reserva confirmada!',
      );
      if (res.skipped.length) toast.info(`${res.skipped.length} data(s) foram ignoradas por indisponibilidade.`);
      clearTimes();
      setRepeat(0);
      setGuests([]);
      dayQ.reload();
      onBooked?.();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Não foi possível reservar.');
      dayQ.reload();
    } finally {
      setSaving(false);
    }
  };

  const release = async (b: Booking) => {
    try { await api.post(`/bookings/${b.id}/release-hold`); } catch { /* o servidor libera pelo prazo */ }
  };
  const leavePayment = async () => {
    if (held) await release(held);
    setHeld(null);
    clearTimes();
    dayQ.reload();
  };

  if (held && cfg) {
    return (
      <Card className="lg:sticky lg:top-8">
        <CardHeader title="Pagamento" subtitle="Pague para confirmar a sua reserva." />
        <PaymentStep
          compact
          booking={held}
          config={cfg}
          onBusy={setPayBusy}
          onBack={leavePayment}
          onExpired={leavePayment}
          onConfirmed={() => {
            toast.success('Pagamento confirmado! Sua reserva está confirmada.');
            setHeld(null);
            clearTimes();
            setRepeat(0);
            dayQ.reload();
            onBooked?.();
          }}
        />
        {payBusy && <span className="sr-only" aria-live="polite">Processando pagamento</span>}
      </Card>
    );
  }

  const closed = dayQ.data && !dayQ.data.open;
  const beyond = dayQ.data?.beyond;

  return (
    <Card className="lg:sticky lg:top-8">
      <CardHeader
        title="Reservar esta sala"
        subtitle={`${fmtMoney(room.price_cents)}/hora · mín. ${fmtDuration(room.min_minutes)}`}
      />

      <div className="flex flex-col gap-4">
        <Input
          label="Data"
          type="date"
          min={todayStr()}
          max={addDays(todayStr(), settings.max_advance_days)}
          value={date}
          onChange={(e) => e.target.value && changeDate(e.target.value)}
          hint={dayQ.data?.open ? `${fmtDateLong(date)} · aberto das ${dayQ.data.open_time} às ${dayQ.data.close_time}` : fmtDateLong(date)}
        />

        {dayQ.loading && !dayQ.data ? (
          <Skeleton className="h-[72px] rounded-2xl" />
        ) : closed ? (
          <p className="flex items-center gap-2.5 rounded-2xl bg-sand-deep/60 px-4 py-3.5 text-[13px] text-stone"><MoonStar size={17} className="shrink-0" />Fechado neste dia. Escolha outra data.</p>
        ) : beyond ? (
          <p className="flex items-center gap-2.5 rounded-2xl bg-sand-deep/60 px-4 py-3.5 text-[13px] text-stone"><CalendarX2 size={17} className="shrink-0" />As reservas abrem com até {settings.max_advance_days} dias de antecedência.</p>
        ) : (
          <div className={cn('transition-opacity', dayQ.loading && 'opacity-60')}>
            <SlotStrip slots={slots} step={step} onPick={onSlot} selected={start && end ? { start, end } : null} />
            <p className="mt-2 text-[12px] text-stone">
              {freeCount === 0
                ? 'Sem horários livres neste dia. Tente outra data.'
                : pickingEnd
                  ? 'Agora toque no último horário que você quer usar (ou ajuste abaixo).'
                  : 'Toque num horário livre para começar. Toque em outro, mais tarde, para definir o término.'}
            </p>
          </div>
        )}

        {!closed && !beyond && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Início" value={start} onChange={(e) => { e.target.value ? pickStart(e.target.value) : clearTimes(); setPickingEnd(false); }}>
                <option value="">Escolha…</option>
                {startOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Select label="Término" value={end} disabled={!start} onChange={(e) => { setEnd(e.target.value); setPickingEnd(false); }}>
                <option value="">Escolha…</option>
                {endOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>

            {durationChips.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Durações rápidas">
                {durationChips.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setEnd(fromMin(toMin(start) + d)); setPickingEnd(false); }}
                    className={cn(
                      'cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                      minutes === d ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/12 text-stone hover:border-sage-700 hover:text-sage-700',
                    )}
                  >
                    {fmtDuration(d)}
                  </button>
                ))}
              </div>
            )}

            <Input label="Pessoas" type="number" min={1} max={room.capacity} value={attendees} onChange={(e) => setAttendees(Number(e.target.value))} hint={`Esta sala comporta até ${room.capacity} pessoas.`} />

            {user && <GuestsField value={guests} onChange={setGuests} ownerEmail={user.email} />}

            <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-sage-700">
              Mais opções <ChevronDown size={15} className={cn('transition-transform', more && 'rotate-180')} />
            </button>
            {more && (
              <div className="animate-fade-up flex flex-col gap-4">
                <Input label="Título (opcional)" placeholder="Ex.: Atendimento, reunião de equipe…" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
                {settings.max_recurrence_weeks > 0 && (
                  <Select label="Repetição" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
                    <option value={0}>Não repetir</option>
                    {[1, 2, 3, 4, 8, 12].filter((w) => w <= settings.max_recurrence_weeks).map((w) => (
                      <option key={w} value={w}>Toda semana, por mais {w} semana{w > 1 ? 's' : ''}</option>
                    ))}
                  </Select>
                )}
                <Textarea label="Observações (opcional)" maxLength={1000} placeholder="Algo que a recepção deva saber?" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            )}
          </>
        )}

        <div className="border-t border-ink/8 pt-4" aria-live="polite">
          {quoting ? (
            <p className="text-[13px] text-stone">Calculando…</p>
          ) : quoteError ? (
            <p role="alert" className="flex items-start gap-2 text-[13px] leading-snug text-rose"><AlertCircle size={16} className="mt-0.5 shrink-0" />{quoteError}</p>
          ) : quote ? (
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[12.5px] text-stone">{start} às {end} · {fmtDuration(minutes)}</p>
                {quote.included_minutes > 0 && (
                  <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-sage-700"><Sparkles size={14} className="mt-px shrink-0" />{fmtDuration(quote.included_minutes)} descontadas do seu plano</p>
                )}
                {!!quote.package_minutes && quote.package_minutes > 0 && (
                  <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-sage-700"><Sparkles size={14} className="mt-px shrink-0" />{fmtDuration(quote.package_minutes)} descontadas do seu pacote de horas</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">{repeat > 0 ? 'Por encontro' : 'Total'}</p>
                <p className="font-display text-[28px] leading-none font-medium text-ink">{quote.price_cents > 0 ? fmtMoney(quote.price_cents) : 'Incluído'}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-stone">Escolha o horário para ver o valor.</p>
          )}
        </div>

        {submitError && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose"><AlertCircle size={16} className="mt-0.5 shrink-0" />{submitError}</p>
        )}

        <Button size="lg" loading={saving} disabled={blocked} onClick={submit} className="w-full">{user ? (needsPayment ? 'Continuar para o pagamento' : 'Reservar') : 'Entrar para reservar'}</Button>

        {!user && (
          <p className="-mt-1 rounded-xl bg-sage-dim px-3.5 py-2.5 text-center text-[12px] leading-snug text-sage-800">
            Escolha o horário agora. Para confirmar, você entra (ou cria sua conta) e a sua escolha fica guardada.
          </p>
        )}
        {settings.require_approval && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-dim px-3 py-2.5 text-[12px] leading-snug text-amber"><Info size={14} className="mt-px shrink-0" />A reserva fica aguardando aprovação da recepção.</p>
        )}
        <p className="-mt-1 text-center text-[11.5px] leading-snug text-stone-light">Cancelamento gratuito até {settings.cancel_min_hours}h antes do início.</p>
        {!user && quote && <p className="-mt-3 text-center text-[11.5px] leading-snug text-stone-light">Valor base. Clientes com plano têm desconto: entre para ver o seu.</p>}
      </div>
    </Card>
  );
}
