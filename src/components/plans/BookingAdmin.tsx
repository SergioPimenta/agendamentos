import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Skeleton, useToast } from '../ui/Feedback';
import { Input, Select, Switch } from '../ui/Form';
import type { PlanBooking, ShiftKey } from '../../types';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const moneyIn = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);

interface Row {
  id?: number;
  name: string;
  subtitle: string;
  room_ids: number[];
  price: string;
  hours: string;
  validity: string;
  shift_key: ShiftKey | null;
  active: boolean;
  sold: number;
}

/**
 * Regras de contratação de um plano (Raiz, Turno Fixo, Imersão…): categorias de sala com valor, turnos/horários,
 * dias da semana, reservas por ciclo e antecedência da renovação. Salva à parte do cadastro da vitrine do plano.
 */
export function BookingAdmin({ planId }: { planId: number }) {
  const toast = useToast();
  const [data, setData] = useState<PlanBooking | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<NonNullable<PlanBooking['config']> | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = (d: PlanBooking) => {
    setData(d);
    setCfg(d.config ? { ...d.config, weekdays: [...d.config.weekdays], shifts: d.config.shifts.map((s) => ({ ...s })) } : null);
    setRows(d.categories.map((c) => ({
      id: c.id, name: c.name, subtitle: c.subtitle, room_ids: [...c.room_ids], price: moneyIn(c.price_cents),
      hours: String(c.minutes / 60).replace('.', ','), validity: String(c.validity_days), shift_key: c.shift_key ?? null, active: c.active, sold: c.sold_count ?? 0,
    })));
  };

  useEffect(() => {
    let alive = true;
    api.get<PlanBooking>(`/admin/plans/${planId}/booking`).then((d) => alive && load(d)).catch((e) => alive && setError(e instanceof Error ? e.message : 'Não foi possível carregar.'));
    return () => { alive = false; };
  }, [planId]);

  if (error && !data) return <p className="text-[13px] text-rose">{error}</p>;
  if (!data) return <Skeleton className="h-24 rounded-xl" />;
  // Planos comuns (sem categorias nem turnos) não têm o que configurar aqui.
  if (!data.shift_plan && data.categories.length === 0) return null;

  const shift = data.shift_plan;
  const immersion = data.kind === 'immersion';
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toggleRoom = (i: number, rid: number) =>
    setRow(i, { room_ids: rows[i].room_ids.includes(rid) ? rows[i].room_ids.filter((x) => x !== rid) : [...rows[i].room_ids, rid] });
  const setShiftField = (key: ShiftKey, patch: Partial<NonNullable<PlanBooking['config']>['shifts'][number]>) =>
    setCfg((c) => (c ? { ...c, shifts: c.shifts.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : c));
  const toggleDay = (d: number) => setCfg((c) => (c ? { ...c, weekdays: c.weekdays.includes(d) ? c.weekdays.filter((x) => x !== d) : [...c.weekdays, d].sort() } : c));

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const body = {
        config: cfg ? { sessions: cfg.sessions, renew_days: cfg.renew_days, weekdays: cfg.weekdays, shifts: cfg.shifts } : undefined,
        categories: rows.map((r) => ({
          id: r.id, name: r.name.trim(), subtitle: r.subtitle.trim(), room_ids: r.room_ids, price_cents: parseMoney(r.price),
          minutes: Math.round(parseFloat(r.hours.replace(',', '.') || '0') * 60), validity_days: Number(r.validity) || 0,
          shift_key: immersion ? r.shift_key : null, active: r.active,
        })),
      };
      load(await api.put<PlanBooking>(`/admin/plans/${planId}/booking`, body));
      toast.success('Regras de contratação salvas.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const firstShift = cfg?.shifts[0]?.key ?? null;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-sage-700/25 bg-sage-dim/40 p-4">
      <div>
        <h3 className="font-display text-[16px] font-medium text-ink">Contratação do plano</h3>
        <p className="text-[12.5px] text-stone">Categorias de sala e valores{shift ? ', turnos, dias e ciclo' : ''}. Vale para novas contratações; o que já foi pago não muda.</p>
      </div>
      {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}

      {shift && cfg && (
        <>
          <div className="flex flex-col gap-3">
            <h4 className="text-[13px] font-semibold text-ink">{immersion ? 'Horários' : 'Turnos'}</h4>
            {cfg.shifts.map((s) => (
              <div key={s.key} className="grid items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                <Input label="Nome" maxLength={40} value={s.label} onChange={(e) => setShiftField(s.key, { label: e.target.value })} />
                <Input label="Início" type="time" value={s.start} onChange={(e) => setShiftField(s.key, { start: e.target.value })} />
                <Input label="Fim" type="time" value={s.end} onChange={(e) => setShiftField(s.key, { end: e.target.value })} />
                <div className="pb-2.5"><Switch checked={s.active} onChange={(v) => setShiftField(s.key, { active: v })} label="Ativo" /></div>
              </div>
            ))}
            <p className="text-[12px] text-stone-light">O turno só aparece para o cliente nos dias em que o espaço abre cedo e fecha tarde o bastante para ele.</p>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-[13px] font-semibold text-ink">Dias da semana permitidos</h4>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Dias da semana permitidos">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={cfg.weekdays.includes(i)}
                  onClick={() => toggleDay(i)}
                  className={cn('cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', cfg.weekdays.includes(i) ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/12 text-stone hover:border-ink/30')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Reservas por ciclo mensal" type="number" min={1} max={12} value={cfg.sessions} onChange={(e) => setCfg({ ...cfg, sessions: Number(e.target.value) })} hint="Ex.: 4 = uma por semana durante 4 semanas." />
            <Input label="Renovação abre (dias antes do fim)" type="number" min={0} max={31} value={cfg.renew_days} onChange={(e) => setCfg({ ...cfg, renew_days: Number(e.target.value) })} hint="Antes disso o cliente não contrata um novo ciclo." />
          </div>
        </>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[13px] font-semibold text-ink">Categorias de sala</h4>
          <Button
            type="button"
            size="sm"
            variant="soft"
            icon={<Plus size={14} />}
            onClick={() => setRows((r) => [...r, { name: '', subtitle: '', room_ids: [], price: '0,00', hours: '4', validity: shift ? '35' : '30', shift_key: immersion ? firstShift : null, active: true, sold: 0 }])}
          >
            Adicionar
          </Button>
        </div>
        {rows.length === 0 && <p className="text-[13px] text-stone">Nenhuma categoria. O cliente não consegue contratar até você adicionar uma.</p>}
        {rows.map((r, i) => (
          <div key={r.id ?? `n${i}`} className={cn('flex flex-col gap-3 rounded-xl border border-ink/10 bg-cream p-3.5', !r.active && 'opacity-60')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nome da categoria" maxLength={80} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} hint={immersion ? 'Ex.: Imersão Comercial · Brisa' : undefined} />
              <Input label="Descrição curta" maxLength={120} value={r.subtitle} onChange={(e) => setRow(i, { subtitle: e.target.value })} hint="Ex.: Salas Sol e Terra. Também identifica a categoria na tela do cliente." />
              <Input label="Valor (R$)" inputMode="decimal" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} />
              {immersion && (
                <Select label="Horário deste valor" value={r.shift_key ?? ''} onChange={(e) => setRow(i, { shift_key: e.target.value as ShiftKey })}>
                  {cfg?.shifts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              )}
              {!shift && <Input label="Horas incluídas" inputMode="decimal" value={r.hours} onChange={(e) => setRow(i, { hours: e.target.value })} />}
              {!shift && <Input label="Validade (dias)" type="number" min={0} value={r.validity} onChange={(e) => setRow(i, { validity: e.target.value })} />}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold tracking-wide text-ink">Salas da categoria</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Salas da categoria">
                {data.rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    aria-pressed={r.room_ids.includes(room.id)}
                    onClick={() => toggleRoom(i, room.id)}
                    className={cn('cursor-pointer rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors', r.room_ids.includes(room.id) ? 'border-sage-700 bg-sage-dim text-sage-700' : 'border-ink/12 text-stone hover:border-ink/30')}
                  >
                    {room.name}
                  </button>
                ))}
              </div>
              {r.room_ids.length === 0 && <p className="text-[12px] text-stone-light">Sem salas marcadas = vale para todas.</p>}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Switch checked={r.active} onChange={(v) => setRow(i, { active: v })} label="Ativa" description={r.sold ? `${r.sold} contratação(ões) já feita(s).` : undefined} />
              <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={15} />} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>{r.sold ? 'Desativar e tirar' : 'Remover'}</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="button" loading={saving} onClick={save}>Salvar contratação</Button>
      </div>
    </section>
  );
}
