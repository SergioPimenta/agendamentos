import { useState } from 'react';
import { DoorClosed, DoorOpen, Hourglass, TimerReset } from 'lucide-react';
import { fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking, CheckoutPreview } from '../../types';
import { Button } from '../ui/Button';
import { SessionBadge, useConfirm, useToast } from '../ui/Feedback';

interface Props {
  booking: Booking;
  /** Como o clique chegou: botão no sistema ou QR da sala (só para registro). */
  method?: 'app' | 'qr';
  onChanged: (b: Booking) => void;
  /** Quanto o excedente está custando agora (já calculado pelo servidor, se houver). */
  estimate?: { minutes: number; cents: number } | null;
}

const hhmm = (stamp: string | null) => (stamp ? stamp.slice(11, 16) : '');

/** Check-in e check-out da reserva, para o próprio cliente. */
export function SessionPanel({ booking: b, method = 'app', onChanged, estimate }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const s = b.session;

  const checkIn = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ booking: Booking }>(`/bookings/${b.id}/check-in`, { method });
      toast.success('Check-in feito. Bom trabalho!');
      onChanged(r.booking);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível fazer o check-in.');
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async () => {
    setBusy(true);
    try {
      const p = await api.get<CheckoutPreview>(`/bookings/${b.id}/checkout-preview`);
      const late = p.overtime_minutes > 0;
      const ok = await confirm({
        title: 'Encerrar o uso da sala?',
        confirmLabel: 'Encerrar uso',
        cancelLabel: 'Voltar',
        tone: late && p.overtime_cents > 0 ? 'danger' : 'primary',
        description: late
          ? p.overtime_cents > 0
            ? `Você passou ${p.overtime_minutes} min do horário reservado. O excedente de ${fmtMoney(p.overtime_cents)} (cobrado por minuto) será lançado no seu consumo.`
            : `Você passou ${p.overtime_minutes} min do horário reservado. Não há cobrança extra.`
          : 'Você está dentro do horário reservado. Ao encerrar, a sala fica liberada para a próxima pessoa.',
      });
      if (!ok) return;
      const r = await api.post<{ booking: Booking }>(`/bookings/${b.id}/check-out`, { method });
      toast.success('Uso encerrado. Obrigado!');
      onChanged(r.booking);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível encerrar o uso.');
    } finally {
      setBusy(false);
    }
  };

  if (!s.state || (s.state === 'upcoming' && !s.can_check_in)) {
    return <p className="text-[13px] text-stone">O check-in abre às {s.check_in_opens_at}, no sistema ou pelo QR code da sala.</p>;
  }

  if (s.state === 'done') {
    return (
      <div className="text-[13.5px] text-stone">
        <p className="flex items-center gap-2 font-medium text-ink"><DoorClosed size={16} className="text-sage-700" />Uso encerrado às {hhmm(b.checked_out_at)}</p>
        {b.overtime_minutes > 0 && (
          <p className="mt-1.5">Excedente de {b.overtime_minutes} min{b.overtime_cents > 0 ? ` · ${fmtMoney(b.overtime_cents)}` : ''}</p>
        )}
      </div>
    );
  }

  if (s.state === 'no_checkin') {
    return <p className="text-[13px] text-stone">Esta reserva terminou sem check-in. Se você usou a sala, fale com a recepção.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <SessionBadge state={s.state} />
        {b.checked_in_at && <span className="text-[13px] text-stone">Entrada às {hhmm(b.checked_in_at)} · reservado até {b.end_time}</span>}
      </div>

      {s.state === 'overtime' && (
        <p className="flex items-start gap-2 rounded-xl bg-rose-dim px-4 py-3 text-[13px] leading-snug text-rose">
          <Hourglass size={16} className="mt-0.5 shrink-0" />
          Você passou {s.live_overtime_minutes} min do horário reservado
          {estimate && estimate.cents > 0 ? `: excedente de ${fmtMoney(estimate.cents)} até agora (cobrado por minuto).` : '.'}
        </p>
      )}

      {s.can_check_in && (
        <Button size="lg" loading={busy} icon={<DoorOpen size={18} />} onClick={checkIn} className="w-full sm:w-fit">Fazer check-in</Button>
      )}
      {s.can_check_out && (
        <Button size="lg" variant={s.state === 'overtime' ? 'danger' : 'primary'} loading={busy} icon={<TimerReset size={18} />} onClick={checkOut} className="w-full sm:w-fit">
          Encerrar uso (check-out)
        </Button>
      )}
    </div>
  );
}
