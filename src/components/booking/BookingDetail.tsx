import { useState } from 'react';
import { Banknote, CalendarPlus, Check, LogIn, LogOut, Mail, Pencil, Phone, Repeat, RotateCcw, UserX, X } from 'lucide-react';
import { fmtDateLong, fmtDuration, fmtMoney, relativeDay } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking } from '../../types';
import { Button } from '../ui/Button';
import { PaymentBadge, SessionBadge, StatusBadge, useToast } from '../ui/Feedback';
import { Textarea } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { PayModal } from '../../pages/admin/finance/shared';
import { useAuth } from '../../contexts/AuthContext';
import { SessionPanel } from './SessionPanel';

const METHOD: Record<string, string> = { app: 'pelo sistema', qr: 'pelo QR da sala', admin: 'pela recepção', auto: 'automático' };
const hhmm = (stamp: string | null) => (stamp ? stamp.slice(11, 16) : '');

interface Props {
  booking: Booking | null;
  admin?: boolean;
  onClose: () => void;
  onEdit?: (b: Booking) => void;
  onChanged: () => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-6 border-b border-ink/6 py-3 last:border-0">
    <dt className="text-[12.5px] text-stone">{label}</dt>
    <dd className="text-right text-[13.5px] font-medium text-ink">{children}</dd>
  </div>
);

export function BookingDetail({ booking: b, admin, onClose, onEdit, onChanged }: Props) {
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [series, setSeries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const { settings } = useAuth();

  if (!b) return null;
  const rel = relativeDay(b.date);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  };

  const active = b.status === 'pending' || b.status === 'confirmed';
  const ended = b.display_status === 'completed';

  return (
    <>
      <Modal
        open={!cancelling}
        onClose={onClose}
        title={b.room.name}
        subtitle={<span>{rel ? `${rel} · ` : ''}{fmtDateLong(b.date)}</span>}
        footer={
          <>
            {admin && b.status === 'pending' && !b.awaiting_payment && (
              <Button loading={busy} icon={<Check size={16} />} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/status`, { status: 'confirmed' }), 'Reserva aprovada.')}>Aprovar</Button>
            )}
            {admin && b.status === 'cancelled' && (
              <Button loading={busy} variant="soft" icon={<RotateCcw size={16} />} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/status`, { status: 'confirmed' }), 'Reserva reativada.')}>Reativar</Button>
            )}
            {admin && b.status === 'confirmed' && ended && (
              <Button variant="secondary" loading={busy} icon={<UserX size={16} />} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/status`, { status: 'no_show' }), 'Marcada como não compareceu.')}>Não compareceu</Button>
            )}
            {admin && b.status === 'no_show' && (
              <Button variant="secondary" loading={busy} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/status`, { status: 'confirmed' }), 'Falta desfeita.')}>Desfazer falta</Button>
            )}
            {admin && b.price_cents > 0 && b.status !== 'cancelled' && (
              <Button
                variant={b.payment_status === 'paid' ? 'secondary' : 'soft'}
                loading={busy}
                icon={<Banknote size={16} />}
                onClick={() => (b.payment_status === 'paid' ? run(() => api.post(`/admin/bookings/${b.id}/payment`, { payment_status: 'pending' }), 'Pagamento reaberto.') : setPayOpen(true))}
              >
                {b.payment_status === 'paid' ? 'Reabrir cobrança' : 'Marcar como pago'}
              </Button>
            )}
            {!admin && settings?.online_payments && b.status !== 'cancelled' && (b.payment_status === 'pending' && b.price_cents > 0 || b.overtime_payment_status === 'pending' && b.overtime_cents > 0) && (
              <Button
                loading={busy}
                icon={<Banknote size={16} />}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.post<{ payment: { checkout_url: string } }>('/payments', { scope: 'booking', booking_id: b.id });
                    window.location.href = r.payment.checkout_url;
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.');
                    setBusy(false);
                  }
                }}
              >
                Pagar online
              </Button>
            )}
            {b.can_edit && onEdit && <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => onEdit(b)}>Alterar</Button>}
            {b.can_cancel && <Button variant="danger" icon={<X size={16} />} onClick={() => setCancelling(true)}>Cancelar reserva</Button>}
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
          </>
        }
      >
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <StatusBadge status={b.display_status} awaitingPayment={b.awaiting_payment} />
          {b.session.state && b.session.state !== 'upcoming' && <SessionBadge state={b.session.state} />}
          {b.price_cents > 0 && b.status !== 'cancelled' && <PaymentBadge status={b.payment_status} />}
          {b.series_id && <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-light px-3 py-1 text-[11px] font-semibold text-stone"><Repeat size={12} />Recorrente</span>}
          <span className="ml-auto font-mono text-[12px] tracking-wider text-stone">{b.code}</span>
        </div>

        <dl>
          <Row label="Horário">{b.start_time} às {b.end_time} · {fmtDuration(b.total_minutes)}</Row>
          {b.title && <Row label="Título">{b.title}</Row>}
          <Row label="Pessoas">{b.attendees}</Row>
          {admin && b.user && (
            <Row label="Cliente">
              <span className="block">{b.user.name}</span>
              <span className="mt-1 flex flex-wrap justify-end gap-x-3 text-[12px] font-normal text-stone">
                <a className="inline-flex items-center gap-1 no-underline hover:text-sage-700" href={`mailto:${b.user.email}`}><Mail size={12} />{b.user.email}</a>
                {b.user.phone && <a className="inline-flex items-center gap-1 no-underline hover:text-sage-700" href={`tel:${b.user.phone}`}><Phone size={12} />{b.user.phone}</a>}
              </span>
            </Row>
          )}
          {b.included_minutes > 0 && <Row label="Incluído no plano">{fmtDuration(b.included_minutes)}</Row>}
          {b.package_minutes > 0 && <Row label="Pago com pacote de horas">{fmtDuration(b.package_minutes)}</Row>}
          <Row label="Valor">{b.price_cents > 0 ? fmtMoney(b.price_cents) : 'Sem cobrança'}</Row>
          {b.notes && <Row label="Observações"><span className="font-normal whitespace-pre-wrap">{b.notes}</span></Row>}
          {b.status === 'cancelled' && b.cancel_reason && <Row label="Motivo do cancelamento">{b.cancel_reason}</Row>}
          {b.checked_in_at && <Row label="Check-in">{hhmm(b.checked_in_at)} <span className="font-normal text-stone">· {b.check_in_method ? METHOD[b.check_in_method] : ''}</span></Row>}
          {b.checked_out_at && <Row label="Check-out">{hhmm(b.checked_out_at)} <span className="font-normal text-stone">· {b.check_out_method ? METHOD[b.check_out_method] : ''}</span></Row>}
          {b.overtime_minutes > 0 && (
            <Row label="Excedente">
              {b.overtime_minutes} min{b.overtime_cents > 0 ? ` · ${fmtMoney(b.overtime_cents)}` : ' · sem cobrança'}
              {b.overtime_cents > 0 && <span className="ml-2 align-middle"><PaymentBadge status={b.overtime_payment_status} /></span>}
            </Row>
          )}
        </dl>

        {!admin && b.status === 'confirmed' && b.session.state && b.session.state !== 'done' && (
          <div className="mt-5 rounded-2xl bg-sand p-4"><SessionPanel booking={b} onChanged={() => { onChanged(); onClose(); }} /></div>
        )}

        {admin && b.status === 'confirmed' && (
          <div className="mt-5 rounded-2xl bg-sand p-4">
            <p className="mb-3 text-[12px] font-semibold tracking-wide text-ink">Uso da sala (recepção)</p>
            <div className="flex flex-wrap items-end gap-3">
              {!b.checked_out_at && (
                <label className="flex flex-col gap-1 text-[12px] text-stone">
                  Horário (vazio = agora)
                  <input type="time" value={at} onChange={(e) => setAt(e.target.value)} className="rounded-xl border border-ink/12 bg-cream px-3 py-2 text-[13.5px] text-ink outline-none focus:border-sage-700" />
                </label>
              )}
              {!b.checked_in_at && (
                <Button variant="soft" size="sm" loading={busy} icon={<LogIn size={15} />} onClick={() => run(() => api.post(`/bookings/${b.id}/check-in`, { at: at || undefined }), 'Check-in registrado.')}>Registrar check-in</Button>
              )}
              {b.checked_in_at && !b.checked_out_at && (
                <>
                  <Button variant="soft" size="sm" loading={busy} icon={<LogOut size={15} />} onClick={() => run(() => api.post(`/bookings/${b.id}/check-out`, { at: at || undefined }), 'Check-out registrado.')}>Registrar check-out</Button>
                  <Button variant="secondary" size="sm" loading={busy} onClick={() => run(() => api.post(`/bookings/${b.id}/check-out`, { at: at || undefined, waive: true }), 'Check-out registrado sem cobrar excedente.')}>Check-out sem excedente</Button>
                </>
              )}
              {b.checked_out_at && b.overtime_cents > 0 && (
                <>
                  <Button variant={b.overtime_payment_status === 'paid' ? 'secondary' : 'soft'} size="sm" loading={busy} icon={<Banknote size={15} />} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/overtime`, { action: b.overtime_payment_status === 'paid' ? 'pending' : 'paid' }), b.overtime_payment_status === 'paid' ? 'Cobrança do excedente reaberta.' : 'Excedente marcado como pago.')}>
                    {b.overtime_payment_status === 'paid' ? 'Reabrir excedente' : 'Excedente pago'}
                  </Button>
                  <Button variant="danger" size="sm" loading={busy} onClick={() => run(() => api.post(`/admin/bookings/${b.id}/overtime`, { action: 'waive' }), 'Excedente perdoado.')}>Perdoar excedente</Button>
                </>
              )}
            </div>
            {b.session.state === 'no_checkin' && <p className="mt-3 text-[12.5px] text-stone">Terminou sem check-in. Se a pessoa usou a sala, registre o check-in e o check-out com os horários reais; senão, use "Não compareceu".</p>}
          </div>
        )}

        {active && (
          <button
            type="button"
            onClick={() => api.download(`/bookings/${b.id}/ics`, `reserva-${b.code}.ics`).catch((e) => toast.error(e.message))}
            className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-sage-700 hover:underline"
          >
            <CalendarPlus size={16} />Adicionar ao meu calendário
          </button>
        )}
        {!admin && !b.can_cancel && active && (
          <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-[12.5px] leading-relaxed text-stone">
            O prazo para alterar ou cancelar online já passou. Fale com a recepção se precisar de ajuda.
          </p>
        )}
      </Modal>

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        size="sm"
        locked={busy}
        title="Cancelar esta reserva?"
        subtitle={`${b.room.name} · ${b.start_time} às ${b.end_time}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)} disabled={busy}>Voltar</Button>
            <Button variant="danger" loading={busy} onClick={() => run(() => api.post(`/bookings/${b.id}/cancel`, { reason, scope: series ? 'series' : 'one' }), series ? 'Reservas canceladas.' : 'Reserva cancelada.')}>Cancelar reserva</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Textarea label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} rows={2} />
          {b.series_id && (
            <label className="flex items-start gap-2.5 text-[13px] text-stone">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sage-700" checked={series} onChange={(e) => setSeries(e.target.checked)} />
              Cancelar também as próximas reservas desta repetição
            </label>
          )}
          <p className="text-[12.5px] text-stone">O horário será liberado e as horas do plano voltam para o seu saldo.</p>
        </div>
      </Modal>
      {payOpen && (
        <PayModal
          open
          title="Registrar pagamento"
          subtitle={`${b.room.name} · ${b.start_time} às ${b.end_time}`}
          amount_cents={b.price_cents}
          confirmLabel="Confirmar pagamento"
          onClose={() => setPayOpen(false)}
          onConfirm={(v) => { setPayOpen(false); run(() => api.post(`/admin/bookings/${b.id}/payment`, { payment_status: 'paid', ...v }), 'Pagamento registrado.'); }}
        />
      )}
    </>
  );
}
