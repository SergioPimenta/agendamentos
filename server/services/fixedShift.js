import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { addDays, daysBetween, nowLocal, nowStamp, toMin, weekdayOf } from '../utils/time.js';
import { OCCUPYING, assertFree, getBusinessHours, hoursFor, inList, validateWindow } from './availability.js';
import { createBookings } from './bookings.js';
import { createContract } from './contracts.js';
import { purchasePackage } from './packages.js';
import { getSettings } from './settings.js';

/**
 * Turno Fixo (Acolhimento Premium): o cliente escolhe uma sala, um dia da semana e um turno; o valor mensal é fechado por
 * categoria de sala e cobre 4 turnos (um por semana). Paga o primeiro mês antecipado; ao confirmar o pagamento, o sistema
 * cria as 4 reservas semanais e registra o contrato. A renovação é feita pelo cliente quando o ciclo está acabando.
 */

export const SESSIONS = 4;
export const SHIFTS = {
  morning: { label: 'Manhã', start: '07:30', end: '12:00' },
  afternoon: { label: 'Tarde', start: '13:00', end: '17:30' },
  night: { label: 'Noite', start: '18:00', end: '22:00' },
  // Plano Imersão: dia fixo na semana, em horário comercial ou o dia todo.
  commercial: { label: 'Horário comercial', start: '07:30', end: '18:30' },
  full: { label: 'Integral diária', start: '07:00', end: '22:00' },
};
/** Opções de horário de cada modalidade (kind do plano). */
export const SHIFT_SETS = { shift: ['morning', 'afternoon', 'night'], immersion: ['commercial', 'full'] };
export const isShiftKind = (kind) => kind === 'shift' || kind === 'immersion';
const MODE_TEXT = {
  shift: { title: 'Turno fixo — Acolhimento Premium', label: 'Turno fixo' },
  immersion: { title: 'Plano Imersão — dia fixo na semana', label: 'Plano Imersão' },
};
const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const shiftMinutes = (key) => toMin(SHIFTS[key].end) - toMin(SHIFTS[key].start);

const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const parseMeta = (s) => {
  try {
    const v = JSON.parse(s || 'null');
    return v && v.kind === 'shift' ? v : null;
  } catch {
    return null;
  }
};

/** Primeira data a partir de `from` que cai no dia da semana pedido. */
const nextWeekday = (from, weekday) => addDays(from, (weekday - weekdayOf(from) + 7) % 7);

/** Dias da semana em que cada turno cabe no horário de funcionamento do espaço (para a tela desabilitar o que não dá). */
export async function shiftAvailability() {
  const hours = await getBusinessHours();
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const h = hours.find((x) => x.weekday === weekday);
    return {
      weekday,
      name: WEEKDAY_NAMES[weekday],
      shifts: Object.fromEntries(
        Object.entries(SHIFTS).map(([key, s]) => [key, Boolean(h?.is_open) && toMin(h.open_time) <= toMin(s.start) && toMin(h.close_time) >= toMin(s.end)]),
      ),
    };
  });
}

/** Ciclo em andamento de turno fixo: reservas futuras das séries dos turnos já pagos. */
export async function activeShiftCycle(userId, planId = null, conn = db) {
  const today = nowLocal().date;
  const rows = await conn.query(
    `SELECT p.meta FROM package_purchases p JOIN hour_packages k ON k.id = p.package_id
      WHERE p.user_id = ? AND p.status = 'paid' AND p.meta IS NOT NULL${planId ? ' AND k.plan_id = ?' : ''}
      ORDER BY p.id DESC`,
    planId ? [userId, planId] : [userId],
  );
  const metas = rows.map((r) => parseMeta(r.meta)).filter((m) => m?.series_id);
  if (!metas.length) return null;
  const series = [...new Set(metas.map((m) => m.series_id))];
  const row = await conn.get(
    `SELECT MAX(date) AS last_date, COUNT(*) AS n FROM bookings
      WHERE user_id = ? AND series_id IN (${series.map(() => '?').join(',')}) AND status IN (${inList(OCCUPYING)}) AND date >= ?`,
    [userId, ...series, today],
  );
  if (!row?.last_date) return null;
  const last = metas[0];
  return {
    last_date: row.last_date,
    remaining_sessions: Number(row.n),
    // Dá para renovar quando falta uma semana ou menos: o próximo ciclo começa logo depois da última reserva.
    can_renew: daysBetween(today, row.last_date) <= 7,
    slot: { room_id: last.room_id, weekday: last.weekday, shift: last.shift },
  };
}

/** Datas do ciclo (4 semanas seguidas) e se cada uma está livre. */
export async function previewShift({ userId, planId, packageId, roomId, weekday, shift }) {
  const pkg = await db.get('SELECT * FROM hour_packages WHERE id = ? AND plan_id = ? AND active = 1', [packageId, planId]);
  if (!pkg) throw new HttpError(422, 'Escolha a categoria de sala do seu turno.');
  const planRow = await db.get('SELECT kind FROM plans WHERE id = ?', [planId]);
  const mode = planRow?.kind === 'immersion' ? 'immersion' : 'shift';
  const win = SHIFT_SETS[mode].includes(shift) ? SHIFTS[shift] : null;
  if (!win) throw new HttpError(422, mode === 'immersion' ? 'Escolha o horário: comercial ou integral.' : 'Escolha o turno: manhã, tarde ou noite.');
  // Na Imersão cada pacote é uma categoria + horário (o preço muda com o horário).
  if (pkg.shift_key && pkg.shift_key !== shift) throw new HttpError(422, 'Esse valor não corresponde ao horário escolhido.');
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(422, 'Escolha o dia da semana.');
  const roomIds = JSON.parse(pkg.room_ids || '[]').map(Number);
  const room = await db.get('SELECT * FROM rooms WHERE id = ? AND active = 1', [roomId]);
  if (!room || (roomIds.length && !roomIds.includes(Number(room.id)))) throw new HttpError(422, 'Escolha uma sala da categoria selecionada.');

  const today = nowLocal().date;
  const cycle = await activeShiftCycle(userId, planId);
  if (cycle && !cycle.can_renew) {
    throw new HttpError(409, `Você já tem um turno fixo em andamento. A renovação abre uma semana antes da última reserva (${dmy(cycle.last_date)}).`);
  }
  const base = cycle ? addDays(cycle.last_date, 1) : addDays(today, 1);
  const first = nextWeekday(base, weekday);
  const hoursList = await getBusinessHours();
  const rules = await getSettings();
  const now = nowLocal();
  const dates = [];
  for (let i = 0; i < SESSIONS; i++) {
    const date = addDays(first, i * 7);
    try {
      validateWindow({ room, date, start: win.start, end: win.end, hours: hoursFor(hoursList, date), rules, now, isAdmin: true });
      await assertFree(db, { roomId: room.id, startAt: `${date} ${win.start}`, endAt: `${date} ${win.end}`, buffer: Number(room.buffer_minutes) || 0 });
      dates.push({ date, ok: true, reason: '' });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      dates.push({ date, ok: false, reason: err.message });
    }
  }
  return {
    ok: dates.every((d) => d.ok),
    amount_cents: Number(pkg.price_cents),
    minutes: SESSIONS * shiftMinutes(shift),
    mode,
    window: win,
    room: { id: Number(room.id), name: room.name },
    renewal: Boolean(cycle),
    dates,
    pkg,
  };
}

/** Contrata o ciclo: confere as 4 datas e abre a cobrança do primeiro pagamento (as reservas saem quando o pagamento confirmar). */
export async function subscribeShift({ actor, plan, packageId, roomId, weekday, shift, partner = null }) {
  const p = await previewShift({ userId: actor.id, planId: Number(plan.id), packageId, roomId, weekday, shift });
  if (!p.ok) {
    const bad = p.dates.filter((d) => !d.ok);
    throw new HttpError(409, `Esse turno não está livre em ${bad.map((d) => dmy(d.date)).join(', ')} (${bad[0].reason}) Escolha outro dia, turno ou sala.`);
  }
  const meta = {
    kind: 'shift', mode: p.mode, room_id: p.room.id, room_name: p.room.name, weekday, shift, start: p.window.start, end: p.window.end,
    dates: p.dates.map((d) => d.date), partner: partner?.email ? { name: partner.name ?? '', email: partner.email } : null, created: false,
  };
  return purchasePackage({ actor, packageId, viaPlan: true, options: { room_ids: [p.room.id], minutes: p.minutes, meta } });
}

/**
 * Cria as reservas semanais dos turnos já pagos (uma vez por compra) e registra/atualiza o contrato.
 * Roda depois da confirmação do pagamento (online ou baixa manual) e também no agendamento periódico, como rede de segurança.
 */
export async function processShiftPurchases() {
  const rows = await db.query(
    `SELECT p.id, p.user_id, p.minutes_total, p.price_cents, p.meta FROM package_purchases p
      WHERE p.status = 'paid' AND p.meta LIKE '%"kind":"shift"%' AND p.meta NOT LIKE '%"created":true%'`,
  );
  let done = 0;
  for (const r of rows) {
    const meta = parseMeta(r.meta);
    if (!meta) continue;
    const text = MODE_TEXT[meta.mode] ?? MODE_TEXT.shift;
    // Só uma execução por compra: marca como "em andamento" com troca condicionada ao texto original.
    const claim = await db.run('UPDATE package_purchases SET meta = ? WHERE id = ? AND meta = ?', [JSON.stringify({ ...meta, created: true, booked: 0 }), r.id, r.meta]);
    if (!claim.changes) continue;

    const today = nowLocal().date;
    let first = meta.dates[0];
    while (first < today) first = addDays(first, 7); // pagou depois da data prevista: segue para a próxima semana livre
    const result = { booked: 0, skipped: [], series_id: null, error: '' };
    try {
      const partner = meta.partner?.email ? [meta.partner] : [];
      const made = await createBookings({
        actor: { id: Number(r.user_id), role: 'admin' },
        input: {
          user_id: Number(r.user_id), room_id: meta.room_id, date: first, start_time: meta.start, end_time: meta.end, attendees: partner.length ? 2 : 1,
          title: text.title, notes: `${text.label} ${SHIFTS[meta.shift].label.toLowerCase()} (${meta.start} às ${meta.end}), ${WEEKDAY_NAMES[meta.weekday]}.`,
          repeat_weeks: SESSIONS - 1, skip_conflicts: true, guests: partner,
        },
      });
      result.booked = made.bookings.length;
      result.skipped = made.skipped ?? [];
      result.series_id = (await db.get('SELECT series_id FROM bookings WHERE id = ?', [made.bookings[0].id]))?.series_id ?? null;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error('[turno fixo] falha ao criar as reservas da compra', r.id, result.error);
    }
    await db.run('UPDATE package_purchases SET meta = ? WHERE id = ?', [JSON.stringify({ ...meta, created: true, dates: undefined, first_date: first, ...result }), r.id]);

    // Contrato do cliente (um por sala, dia e turno; a renovação só reabre o mesmo contrato).
    try {
      const key = `shift:${r.user_id}:${meta.room_id}:${meta.weekday}:${meta.shift}`;
      const exists = await db.get('SELECT id FROM contracts WHERE legacy_key = ?', [key]);
      if (exists) await db.run('UPDATE contracts SET active = 1, end_date = NULL, amount_cents = ?, updated_at = ? WHERE id = ?', [Number(r.price_cents), nowStamp(), exists.id]);
      else {
        await createContract(Number(r.user_id), {
          kind: `${text.label} · ${SHIFTS[meta.shift].label} · ${meta.room_name}`, unit: 'Coworking Harmonize o Ser', period: 'Mensal', signed_at: null, start_date: first, end_date: null,
          fidelity_until: null, amount_cents: Number(r.price_cents), due_day: Number(today.slice(8, 10)), private_office: '', created_by_name: 'Sistema (contratação pelo app)',
          last_adjustment: null, adjustment_index: '', active: true,
          notes: `${WEEKDAY_NAMES[meta.weekday]}, ${meta.start} às ${meta.end}${meta.partner ? `. Parceiro(a): ${meta.partner.name || meta.partner.email}` : ''}.`,
        }, db, { legacy_key: key });
      }
    } catch (err) {
      console.error('[turno fixo] falha ao registrar o contrato', err.message);
    }
    done += 1;
  }
  return done;
}
