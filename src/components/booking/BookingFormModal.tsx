import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CalendarDays, Clock, Info, Repeat, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDebounced } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { addDays, fmtDateLong, fmtDuration, fmtMoney, fromMin, toMin, todayStr, weekdayOf } from '../../lib/format';
import { api, ApiError } from '../../services/api';
import type { Booking, BusinessHours, Client, Guest, PaymentConfig, PublicSettings, Room } from '../../types';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Form';
import { useToast } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { GuestsField, cleanGuests, guestsError } from './GuestsField';
import { PaymentStep } from './PaymentStep';

interface Quote {
  minutes: number;
  included_minutes: number;
  price_cents: number;
  price_per_hour_cents: number;
}

export interface BookingFormInitial {
  room_id?: number;
  date?: string;
  start_time?: string;
  end_time?: string;
  user_id?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  hours: BusinessHours[];
  settings: PublicSettings;
  admin?: boolean;
  booking?: Booking | null;
  initial?: BookingFormInitial;
  onSaved: (info: { created: number; skipped: number }) => void;
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 480];

export function BookingFormModal({ open, onClose, rooms, hours, settings, admin, booking, initial, onSaved }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const editing = !!booking;
  const step = settings.slot_step_minutes;

  const [form, setForm] = useState({
    room_id: 0, date: todayStr(), start_time: '', end_time: '', title: '', notes: '', attendees: 1, user_id: 0, repeat_weeks: 0, skip_conflicts: true,
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  // Pagamento no ato da reserva (Pix / cartão), quando a administração ligou.
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [stage, setStage] = useState<'form' | 'pay'>('form');
  const [held, setHeld] = useState<Booking | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const room = rooms.find((r) => r.id === form.room_id);
  const dayHours = hours.find((h) => h.weekday === weekdayOf(form.date));

  // Reinicia o formulário sempre que o modal abre.
  useEffect(() => {
    if (!open) return;
    const first = rooms[0];
    const roomId = booking?.room.id ?? initial?.room_id ?? first?.id ?? 0;
    const r = rooms.find((x) => x.id === roomId) ?? first;
    const start = booking?.start_time ?? initial?.start_time ?? '';
    const end = booking?.end_time ?? initial?.end_time ?? (start && r ? fromMin(toMin(start) + Math.max(r.min_minutes, step)) : '');
    setForm({
      room_id: roomId,
      date: booking?.date ?? initial?.date ?? todayStr(),
      start_time: start,
      end_time: end,
      title: booking?.title ?? '',
      notes: booking?.notes ?? '',
      attendees: booking?.attendees ?? 1,
      user_id: booking?.user?.id ?? initial?.user_id ?? 0,
      repeat_weeks: 0,
      skip_conflicts: true,
    });
    setGuests(booking?.guest_list ?? (booking?.guests ?? []).map((email) => ({ name: '', email })));
    setQuote(null);
    setQuoteError('');
    setSubmitError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id, initial?.room_id, initial?.date, initial?.start_time, initial?.end_time, initial?.user_id]);

  useEffect(() => {
    if (!open) return;
    setStage('form');
    setHeld(null);
    if (admin || booking) return setCfg(null);
    api.get<PaymentConfig>('/payments/config').then(setCfg).catch(() => setCfg(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, admin, booking?.id]);

  useEffect(() => {
    if (!open || !admin) return;
    api.get<{ users: Client[] }>('/admin/users', { role: 'client', active: 'true' }).then((r) => setClients(r.users)).catch(() => {});
  }, [open, admin]);

  const startOptions = useMemo(() => {
    if (!dayHours?.is_open) return [];
    const out: string[] = [];
    for (let m = toMin(dayHours.open_time); m + step <= toMin(dayHours.close_time); m += step) out.push(fromMin(m));
    return out;
  }, [dayHours, step]);

  const endOptions = useMemo(() => {
    if (!dayHours?.is_open || !form.start_time) return [];
    const out: string[] = [];
    for (let m = toMin(form.start_time) + step; m <= toMin(dayHours.close_time); m += step) out.push(fromMin(m));
    return out;
  }, [dayHours, form.start_time, step]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const setStart = (start: string) =>
    setForm((f) => {
      const minEnd = toMin(start) + (room ? Math.max(room.min_minutes, step) : step);
      const keep = f.end_time && toMin(f.end_time) > toMin(start) && toMin(f.end_time) - toMin(start) >= (room?.min_minutes ?? 0);
      return { ...f, start_time: start, end_time: keep ? f.end_time : fromMin(minEnd) };
    });

  const pickDuration = (d: number) => {
    if (form.start_time) set('end_time', fromMin(toMin(form.start_time) + d));
  };

  // Cotação em tempo real (também valida conflito e regras antes do envio).
  const key = useDebounced(
    JSON.stringify([form.room_id, form.date, form.start_time, form.end_time, form.user_id, booking?.id]),
    350,
  );
  useEffect(() => {
    if (!open) return;
    if (!form.room_id || !form.date || !form.start_time || !form.end_time) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    let alive = true;
    setQuoting(true);
    api
      .post<Quote>('/bookings/quote', {
        room_id: form.room_id, date: form.date, start_time: form.start_time, end_time: form.end_time,
        ...(admin && form.user_id ? { user_id: form.user_id } : {}),
        ...(booking ? { exclude_booking_id: booking.id } : {}),
      })
      .then((q) => alive && (setQuote(q), setQuoteError('')))
      .catch((e: ApiError) => alive && (setQuote(null), setQuoteError(e.message)))
      .finally(() => alive && setQuoting(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const minutes = form.start_time && form.end_time ? toMin(form.end_time) - toMin(form.start_time) : 0;
  const maxDate = addDays(todayStr(), settings.max_advance_days);

  const needsPayment = !admin && !editing && !!cfg?.pay_on_booking && cfg.methods.length > 0 && form.repeat_weeks === 0 && !!quote && quote.price_cents >= 100;

  const blocked = !!quoteError || quoting || !form.start_time || !form.end_time || !dayHours?.is_open || (admin && !editing && !form.user_id);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (blocked) return;
    const gErr = guestsError(guests, admin ? undefined : user?.email);
    if (gErr) return setSubmitError(gErr);
    setSubmitError('');
    setSaving(true);
    try {
      const base = {
        room_id: form.room_id, date: form.date, start_time: form.start_time, end_time: form.end_time,
        title: form.title, notes: form.notes, attendees: Number(form.attendees) || 1, guests: cleanGuests(guests),
        ...(admin && form.user_id ? { user_id: form.user_id } : {}),
      };
      if (editing && booking) {
        await api.put(`/bookings/${booking.id}`, base);
        toast.success('Reserva atualizada.');
        onSaved({ created: 0, skipped: 0 });
      } else {
        const res = await api.post<{ bookings: Booking[]; skipped: { date: string }[]; payment_required?: boolean }>('/bookings', {
          ...base, repeat_weeks: form.repeat_weeks, skip_conflicts: form.skip_conflicts,
        });
        if (res.payment_required) {
          // O horário ficou segurado: segue para o pagamento, no mesmo popup.
          setHeld(res.bookings[0]);
          setStage('pay');
          return;
        }
        const n = res.bookings.length;
        toast.success(
          res.bookings[0]?.status === 'pending'
            ? 'Pedido enviado! Você será avisado quando for aprovado.'
            : n > 1 ? `${n} reservas confirmadas.` : 'Reserva confirmada!',
        );
        if (res.skipped.length) toast.info(`${res.skipped.length} data(s) foram ignoradas por indisponibilidade.`);
        onSaved({ created: n, skipped: res.skipped.length });
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  /** Desistiu ou fechou antes de pagar: libera o horário na hora (se não liberar, o servidor libera pelo prazo). */
  const release = async (b: Booking) => {
    try { await api.post(`/bookings/${b.id}/release-hold`); } catch { /* segue */ }
  };
  const closeModal = async () => {
    if (stage === 'pay' && held) await release(held);
    onClose();
  };
  const backToForm = async () => {
    if (held) await release(held);
    setHeld(null);
    setStage('form');
    onSaved({ created: 0, skipped: 0 }); // atualiza as grades: o horário voltou a ficar livre
  };
  const paidAndConfirmed = () => {
    toast.success('Pagamento confirmado! Sua reserva está confirmada.');
    onSaved({ created: 1, skipped: 0 });
    onClose();
  };

  const durationChips = DURATIONS.filter((d) => room && (admin || (d >= room.min_minutes && d <= room.max_minutes)) && dayHours?.is_open && form.start_time && toMin(form.start_time) + d <= toMin(dayHours.close_time));

  return (
    <Modal
      open={open}
      onClose={closeModal}
      size="lg"
      locked={saving || payBusy}
      title={stage === 'pay' ? 'Pagamento' : editing ? 'Alterar reserva' : admin ? 'Nova reserva' : 'Reservar sala'}
      subtitle={stage === 'pay' && held ? `${held.room.name} · ${fmtDateLong(held.date)}, ${held.start_time} às ${held.end_time}` : room ? `${room.name} · até ${room.capacity} pessoas · ${fmtMoney(room.price_cents)}/hora` : undefined}
      footer={stage === 'pay' ? undefined : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={() => submit()} loading={saving} disabled={blocked}>{editing ? 'Salvar alterações' : needsPayment ? 'Continuar para o pagamento' : 'Confirmar reserva'}</Button>
          <p className="flex items-center justify-between text-[13px] text-stone sm:order-first sm:mr-auto sm:gap-4 md:hidden" aria-live="polite">
            <span>{minutes > 0 ? fmtDuration(minutes) : 'Escolha o horário'}</span>
            <strong className="font-display text-[18px] font-medium text-ink">{quoteError ? 'Indisponível' : quote ? (quote.price_cents > 0 ? fmtMoney(quote.price_cents) : 'Incluído') : '—'}</strong>
          </p>
        </>
      )}
    >
      {stage === 'pay' && held && cfg ? (
        <PaymentStep booking={held} config={cfg} onConfirmed={paidAndConfirmed} onBack={backToForm} onExpired={backToForm} onBusy={setPayBusy} />
      ) : (<>
      <form onSubmit={submit} className="grid gap-7 md:grid-cols-[1fr_250px]">
        <div className="flex flex-col gap-4">
          {admin && (
            <Select label="Cliente" required value={form.user_id || ''} onChange={(e) => set('user_id', Number(e.target.value))}>
              <option value="">Selecione o cliente…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
              ))}
            </Select>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Sala" value={form.room_id} onChange={(e) => set('room_id', Number(e.target.value))}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Input label="Data" type="date" required min={admin ? undefined : todayStr()} max={admin ? undefined : maxDate} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>

          {dayHours && !dayHours.is_open ? (
            <p className="flex items-center gap-2 rounded-xl bg-amber-dim px-4 py-3 text-[13px] text-amber"><AlertCircle size={16} />O espaço não funciona nesse dia. Escolha outra data.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Início" required value={form.start_time} onChange={(e) => setStart(e.target.value)}>
                  <option value="">Escolha…</option>
                  {startOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Select label="Término" required value={form.end_time} onChange={(e) => set('end_time', e.target.value)} disabled={!form.start_time}>
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
                      onClick={() => pickDuration(d)}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                        minutes === d ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/12 text-stone hover:border-sage-700 hover:text-sage-700',
                      )}
                    >
                      {fmtDuration(d)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <Input label="Título (opcional)" placeholder="Ex.: Atendimento, reunião de equipe…" maxLength={160} value={form.title} onChange={(e) => set('title', e.target.value)} />

          <div className="grid gap-4 sm:grid-cols-[130px_1fr]">
            <Input label="Pessoas" type="number" min={1} max={room?.capacity ?? 50} value={form.attendees} onChange={(e) => set('attendees', Number(e.target.value))} />
            {!editing && settings.max_recurrence_weeks > 0 ? (
              <Select label="Repetição" value={form.repeat_weeks} onChange={(e) => set('repeat_weeks', Number(e.target.value))}>
                <option value={0}>Não repetir</option>
                {[1, 2, 3, 4, 8, 12].filter((w) => w <= settings.max_recurrence_weeks).map((w) => (
                  <option key={w} value={w}>Toda semana, por mais {w} semana{w > 1 ? 's' : ''}</option>
                ))}
              </Select>
            ) : <span />}
          </div>

          {form.repeat_weeks > 0 && (
            <label className="flex items-start gap-2.5 text-[13px] text-stone">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sage-700" checked={form.skip_conflicts} onChange={(e) => set('skip_conflicts', e.target.checked)} />
              Pular datas em que a sala estiver indisponível (em vez de cancelar tudo)
            </label>
          )}

          <GuestsField value={guests} onChange={setGuests} ownerEmail={admin ? undefined : user?.email} />

          <Textarea label="Observações (opcional)" maxLength={1000} placeholder="Algo que a recepção deva saber?" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        <aside className="flex flex-col gap-4 self-start rounded-[20px] bg-sand p-5 md:sticky md:top-0">
          <h3 className="font-display text-[16px] font-medium text-ink">Resumo</h3>
          <dl className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-start gap-2.5 text-stone"><CalendarDays size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{fmtDateLong(form.date)}</dd></div>
            <div className="flex items-start gap-2.5 text-stone"><Clock size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{form.start_time && form.end_time && minutes > 0 ? `${form.start_time} às ${form.end_time} · ${fmtDuration(minutes)}` : 'Escolha o horário'}</dd></div>
            <div className="flex items-start gap-2.5 text-stone"><Users size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{form.attendees} pessoa{form.attendees > 1 ? 's' : ''}</dd></div>
            {form.repeat_weeks > 0 && <div className="flex items-start gap-2.5 text-stone"><Repeat size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{form.repeat_weeks + 1} encontros semanais</dd></div>}
          </dl>

          <div className="border-t border-ink/10 pt-4">
            {quoting ? (
              <p className="text-[13px] text-stone">Calculando…</p>
            ) : quoteError ? (
              <p role="alert" className="flex items-start gap-2 text-[13px] leading-snug text-rose"><AlertCircle size={16} className="mt-0.5 shrink-0" />{quoteError}</p>
            ) : quote ? (
              <>
                <p className="text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">{form.repeat_weeks > 0 ? 'Valor por encontro' : 'Valor'}</p>
                <p className="mt-1 font-display text-[28px] leading-none font-medium text-ink">{quote.price_cents > 0 ? fmtMoney(quote.price_cents) : 'Incluído'}</p>
                {quote.included_minutes > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-sage-700"><Sparkles size={14} className="mt-px shrink-0" />{fmtDuration(quote.included_minutes)} descontadas do seu plano</p>
                )}
                {form.repeat_weeks > 0 && <p className="mt-1.5 text-[11.5px] leading-snug text-stone-light">O desconto do plano é aplicado mês a mês; os próximos encontros podem ter valor diferente.</p>}
              </>
            ) : (
              <p className="text-[13px] text-stone">Escolha sala, data e horário para ver o valor.</p>
            )}
          </div>

          {!admin && settings.require_approval && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-dim px-3 py-2.5 text-[12px] leading-snug text-amber"><Info size={14} className="mt-px shrink-0" />A reserva fica aguardando aprovação da recepção.</p>
          )}
          {!admin && (
            <p className="text-[11.5px] leading-snug text-stone-light">Cancelamento gratuito até {settings.cancel_min_hours}h antes do início.</p>
          )}
        </aside>
      </form>

      {submitError && (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />{submitError}
        </div>
      )}
      </>)}
    </Modal>
  );
}
