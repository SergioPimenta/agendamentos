import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Users, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { fmtDateFull, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Form';
import type { ClientPlan, HourPackage, ShiftKey, ShiftPreview } from '../../types';

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface Props {
  plan: ClientPlan;
  online: boolean;
  busy: boolean;
  onContract: (body: { package_id: number; room_id: number; weekday: number; shift: ShiftKey; partner: { name: string; email: string } | null }) => void;
}

/**
 * Turno Fixo (Acolhimento Premium): categoria de sala (valor mensal fechado), sala, dia da semana e turno.
 * Mostra as 4 datas do ciclo e se cada uma está livre antes de contratar. Quando já há um turno em andamento, vira "renovar".
 */
export function ShiftPicker({ plan, online, busy, onContract }: Props) {
  const info = plan.shift!;
  const cycle = info.cycle;
  const immersion = info.mode === 'immersion';
  const shiftKeys = Object.keys(info.shifts) as ShiftKey[];
  const [shift, setShift] = useState<ShiftKey>(cycle?.slot.shift ?? shiftKeys[0]);
  // Na Imersão cada categoria tem um valor por horário: mostra só os do horário escolhido, mantendo a categoria (pelo subtítulo).
  const combos = immersion ? plan.combos.filter((c) => c.shift_key === shift) : plan.combos;
  const startCombo = (cycle && combos.find((c) => c.room_ids.includes(cycle.slot.room_id))) || combos[0];

  const [catKey, setCatKey] = useState(startCombo.subtitle);
  const combo: HourPackage = combos.find((c) => c.subtitle === catKey) ?? combos[0];
  const [roomId, setRoomId] = useState<number>(cycle?.slot.room_id ?? combo.room_ids[0]);
  const [weekday, setWeekday] = useState<number | null>(cycle?.slot.weekday ?? null);
  const [partnerOn, setPartnerOn] = useState(false);
  const [partner, setPartner] = useState({ name: '', email: '' });

  // Trocar a categoria leva para a primeira sala dela.
  useEffect(() => {
    if (!combo.room_ids.includes(roomId)) setRoomId(combo.room_ids[0]);
  }, [combo, roomId]);

  const fits = (w: number, s: ShiftKey) => info.availability.find((a) => a.weekday === w)?.shifts[s] ?? false;
  const openDays = info.availability.filter((a) => a.shifts[shift]);
  // Sem dia escolhido (ou o dia não comporta o turno): fica o primeiro que comporta.
  const day = weekday != null && fits(weekday, shift) ? weekday : (openDays[0]?.weekday ?? null);

  const roomNames = (c: HourPackage) => c.rooms.map((r) => r.replace(/^Sala /, ''));
  const roomName = (id: number) => combo.rooms[combo.room_ids.indexOf(id)] ?? '';

  const preview = useApi(
    () => (day == null ? Promise.resolve(null) : api.get<ShiftPreview>(`/me/plans/${plan.id}/shift-preview`, { package_id: String(combo.id), room_id: String(roomId), weekday: String(day), shift })),
    [plan.id, combo.id, roomId, day, shift],
  );
  const p = preview.data;
  const blockedByCycle = cycle && !cycle.can_renew;
  const partnerOk = !partnerOn || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(partner.email.trim());
  const canContract = Boolean(online && p?.ok && !blockedByCycle && partnerOk && day != null);
  const verb = cycle ? 'Renovar' : 'Contratar';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-cream p-4 text-ink">
      <section>
        <p className="mb-2 text-[11.5px] font-semibold tracking-[0.08em] text-stone uppercase">1 · Categoria de sala</p>
        <div role="radiogroup" aria-label="Categoria de sala" className="flex flex-col gap-2">
          {combos.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === combo.id}
              onClick={() => setCatKey(c.subtitle)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors', c.id === combo.id ? 'border-sage-700 bg-sage-dim' : 'border-ink/12 hover:border-ink/30')}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{c.name.split(' · ').pop()}</span>
                {c.rooms.length > 1 && <span className="block truncate text-[12px] text-stone">{roomNames(c).join(' e ')}</span>}
              </span>
              <span className="shrink-0 font-display text-[15px] font-medium">{fmtMoney(c.price_cents)}<span className="text-[11px] font-normal text-stone">/mês</span></span>
            </button>
          ))}
        </div>
        {combo.room_ids.length > 1 && (
          <div className="mt-2.5">
            <Select label="Qual sala?" value={roomId} onChange={(e) => setRoomId(Number(e.target.value))}>
              {combo.room_ids.map((id) => <option key={id} value={id}>{roomName(id)}</option>)}
            </Select>
          </div>
        )}
      </section>

      <section>
        <p className="mb-2 text-[11.5px] font-semibold tracking-[0.08em] text-stone uppercase">2 · {immersion ? 'Horário e dia da semana' : 'Turno e dia da semana'}</p>
        <div role="radiogroup" aria-label="Turno" className={cn('grid gap-2', immersion ? 'grid-cols-2' : 'grid-cols-3')}>
          {shiftKeys.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === shift}
              onClick={() => setShift(s)}
              className={cn('cursor-pointer rounded-xl border px-2 py-2 text-center transition-colors', s === shift ? 'border-sage-700 bg-sage-dim' : 'border-ink/12 hover:border-ink/30')}
            >
              <span className="block text-[13px] font-semibold">{info.shifts[s]!.label}</span>
              <span className="block text-[11px] text-stone">{info.shifts[s]!.start.replace(':', 'h')} às {info.shifts[s]!.end.replace(':', 'h')}</span>
            </button>
          ))}
        </div>
        {!immersion && <p className="mt-1.5 text-[11.5px] text-stone-light">Há uma janela automática de 30 minutos entre a tarde e a noite.</p>}
        <div className="mt-2.5">
          <Select label="Dia da semana" value={day ?? ''} onChange={(e) => setWeekday(Number(e.target.value))} disabled={openDays.length === 0}>
            {openDays.length === 0 && <option value="">Sem dias disponíveis neste turno</option>}
            {openDays.map((a) => <option key={a.weekday} value={a.weekday}>{a.name.charAt(0).toUpperCase() + a.name.slice(1)}</option>)}
          </Select>
          {openDays.length === 0 && <p className="mt-1.5 text-[12px] text-stone-light">Este horário está fora do funcionamento do espaço nos dias liberados para o plano. Escolha outro ou fale com a recepção.</p>}
        </div>
      </section>

      <section>
        <p className="mb-2 text-[11.5px] font-semibold tracking-[0.08em] text-stone uppercase">3 · Suas {info.sessions} reservas do ciclo</p>
        {blockedByCycle ? (
          <p className="rounded-xl bg-amber-dim px-3.5 py-2.5 text-[12.5px] leading-snug text-ink">
            Você já tem um turno fixo em andamento, com a última reserva em {dmy(cycle!.last_date)}. A renovação abre uma semana antes.
          </p>
        ) : !p ? (
          <p className="text-[12.5px] text-stone">{preview.loading ? 'Conferindo a agenda…' : preview.error ?? 'Escolha o turno e o dia.'}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label="Datas do ciclo">
            {p.dates.map((d) => (
              <li key={d.date} className={cn('flex items-start gap-2 text-[13px]', d.ok ? 'text-ink' : 'text-rose')}>
                {d.ok ? <Check size={15} className="mt-0.5 shrink-0 text-sage-700" /> : <X size={15} className="mt-0.5 shrink-0" />}
                <span>
                  <span className="font-medium">{fmtDateFull(d.date)}</span> · {p.room.name}, {p.window.start.replace(':', 'h')} às {p.window.end.replace(':', 'h')}
                  {!d.ok && <span className="block text-[11.5px] text-rose">{d.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {p && !p.ok && !blockedByCycle && <p className="mt-2 text-[12px] text-stone">Escolha outro turno, dia ou sala para liberar as {info.sessions} datas.</p>}
      </section>

      {immersion && (
        <p className="flex items-center gap-2 rounded-xl bg-sage-dim px-3.5 py-2.5 text-[12.5px] font-medium text-sage-700">
          <Users size={15} className="shrink-0" />Permitido compartilhamento com +2 profissionais parceiros
        </p>
      )}

      {!immersion && <section>
        <button type="button" aria-expanded={partnerOn} onClick={() => setPartnerOn((v) => !v)} className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-sage-700">
          <Users size={15} />{partnerOn ? 'Remover parceiro(a) da dupla' : 'Dupla de profissionais parceiros?'}
        </button>
        {partnerOn ? (
          <div className="mt-2.5 grid gap-2.5">
            <Input label="Nome do(a) parceiro(a)" value={partner.name} maxLength={120} onChange={(e) => setPartner({ ...partner, name: e.target.value })} placeholder="Nome completo" />
            <Input label="E-mail do(a) parceiro(a)" type="email" value={partner.email} maxLength={160} onChange={(e) => setPartner({ ...partner, email: e.target.value })} placeholder="parceiro@email.com" hint="Recebe o convite das reservas. A fatura é única, em nome do titular do contrato." error={partner.email && !partnerOk ? 'E-mail inválido.' : undefined} />
          </div>
        ) : (
          <p className="mt-1 text-[11.5px] text-stone-light">Opcional. A fatura única é emitida para você, titular do contrato.</p>
        )}
      </section>}

      <div className="flex flex-col gap-2 border-t border-ink/8 pt-3.5">
        <Button className="w-full" loading={busy} disabled={!canContract && online} onClick={() => p && day != null && onContract({ package_id: combo.id, room_id: roomId, weekday: day, shift, partner: !immersion && partnerOn &&partner.email.trim() ? { name: partner.name.trim(), email: partner.email.trim() } : null })}>
          {!online ? 'Fale com a recepção' : `${verb} · ${fmtMoney(combo.price_cents)}/mês`}
        </Button>
        <p className="flex items-start gap-2 text-[11.5px] leading-snug text-stone">
          <CalendarCheck size={14} className="mt-0.5 shrink-0 text-sage-700" />
          Pagamento online seguro, com Pix, cartão ou boleto. Valor fixo por mês ({info.sessions} {immersion ? 'dias' : 'turnos'}, nunca muda com o calendário). O primeiro pagamento é antecipado: ao confirmar, as reservas são criadas sozinhas e você as gerencia em Minhas reservas.
        </p>
      </div>
    </div>
  );
}
