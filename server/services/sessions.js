import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { addDays, addMinutesAt, minutesBetween, nowLocal, nowStamp } from '../utils/time.js';
import { BOOKING_SELECT, formatBRL, formatDateBR, getBookingRow, serializeBooking } from './bookings.js';
import { sendTemplated } from './emailTemplates.js';
import { getSettings } from './settings.js';

/**
 * Check-in / check-out manual da sala.
 *
 *  - O cliente faz o próprio check-in (botão no sistema ou QR da sala) dentro da janela configurada.
 *  - No check-out, o que passar do horário reservado + tolerância vira excedente cobrado por minuto
 *    (valor/hora da sala, com o desconto do plano). Quem esquece o check-out é encerrado automaticamente
 *    no horário previsto, sem cobrança extra.
 *  - A administração pode registrar, corrigir o horário e perdoar o excedente.
 */

const hhmm = (stamp) => stamp.slice(11, 16);
const firstName = (name = '') => name.trim().split(' ')[0];

const sessionVars = (row, extra = {}) => ({
  nome: firstName(row.user_name),
  nome_completo: row.user_name,
  email: row.user_email,
  sala: row.room_name,
  data: formatDateBR(row.date),
  horario_inicio: row.start_time,
  horario_fim: row.end_time,
  horario: `${row.start_time} às ${row.end_time}`,
  codigo: row.code,
  ...extra,
});

/** Minutos além do horário reservado → { minutes, cents } cobráveis (0 se dentro da tolerância). */
export async function computeOvertime(row, over, rules) {
  if (over <= (rules.overtime_grace_minutes ?? 0)) return { minutes: 0, cents: 0 };
  const room = await db.get('SELECT price_cents FROM rooms WHERE id = ?', [row.room_id]);
  const plan = await db.get(
    'SELECT p.unlimited, p.room_discount_percent FROM users u JOIN plans p ON p.id = u.plan_id WHERE u.id = ?',
    [row.user_id],
  );
  const free = !rules.overtime_charge || Boolean(plan && Number(plan.unlimited));
  const discount = plan ? Number(plan.room_discount_percent) : 0;
  const cents = free ? 0 : Math.round(((Number(room.price_cents) * over) / 60) * (1 - discount / 100));
  return { minutes: over, cents };
}

/** A administração só "age em nome de" outra pessoa; na própria reserva vale a regra do cliente. */
const asAdmin = (actor, row) => actor.role === 'admin' && Number(row.user_id) !== Number(actor.id);

async function loadForActor(actor, id) {
  const row = await getBookingRow(id);
  if (actor.role !== 'admin' && Number(row.user_id) !== Number(actor.id)) throw new HttpError(404, 'Reserva não encontrada.');
  return row;
}

const adminStamp = (row, at) => `${row.date} ${at}:00`;

export async function checkIn({ actor, id, method = 'app', at }) {
  const rules = await getSettings();
  const now = nowLocal();
  const row = await loadForActor(actor, id);
  const override = asAdmin(actor, row);

  if (row.status === 'pending') throw new HttpError(422, 'Esta reserva ainda aguarda a aprovação da recepção.');
  if (row.status !== 'confirmed') throw new HttpError(422, 'Esta reserva não está ativa.');
  if (row.checked_out_at) throw new HttpError(409, 'O uso desta reserva já foi encerrado.');
  if (row.checked_in_at) throw new HttpError(409, `O check-in já foi feito às ${hhmm(row.checked_in_at)}.`);

  if (!override) {
    if (now.at > row.end_at) throw new HttpError(422, 'Esta reserva já terminou.');
    if (minutesBetween(now.at, row.start_at) > (rules.checkin_window_minutes ?? 0)) {
      const opens = addMinutesAt(row.start_at, -(rules.checkin_window_minutes ?? 0));
      throw new HttpError(422, `O check-in abre às ${hhmm(opens)}${opens.slice(0, 10) === now.date ? '' : ` de ${formatDateBR(opens.slice(0, 10))}`}.`);
    }
  }

  const stamp = override && at ? adminStamp(row, at) : nowStamp();
  await db.run('UPDATE bookings SET checked_in_at = ?, check_in_method = ?, updated_at = ? WHERE id = ?', [
    stamp, override ? 'admin' : method === 'qr' ? 'qr' : 'app', nowStamp(), id,
  ]);

  const fresh = await getBookingRow(id);
  sendTemplated('checkin_confirmed', { to: fresh.user_email, vars: sessionVars(fresh, { entrada: hhmm(stamp) }) }).catch(() => {});
  return serializeBooking(fresh, { rules, now: nowLocal(), isAdmin: actor.role === 'admin', viewerId: actor.id });
}

/** Mostra quanto o cliente vai pagar de excedente se encerrar agora (ou no horário `at`). */
export async function checkoutPreview({ actor, id }) {
  const rules = await getSettings();
  const now = nowLocal();
  const row = await loadForActor(actor, id);
  const over = Math.max(0, minutesBetween(row.end_at, now.at));
  const { minutes, cents } = await computeOvertime(row, over, rules);
  return { over_minutes: over, grace_minutes: rules.overtime_grace_minutes, overtime_minutes: minutes, overtime_cents: cents, charge: Boolean(rules.overtime_charge) };
}

export async function checkOut({ actor, id, method = 'app', at, waive = false }) {
  const rules = await getSettings();
  const row = await loadForActor(actor, id);
  const override = asAdmin(actor, row);

  if (row.status !== 'confirmed') throw new HttpError(422, 'Esta reserva não está ativa.');
  if (!row.checked_in_at) throw new HttpError(422, 'Faça o check-in antes de encerrar o uso.');
  if (row.checked_out_at) throw new HttpError(409, `O uso já foi encerrado às ${hhmm(row.checked_out_at)}.`);

  const stamp = override && at ? adminStamp(row, at) : nowStamp();
  if (stamp.slice(0, 16) < row.checked_in_at.slice(0, 16)) throw new HttpError(422, 'A saída não pode ser antes da entrada.');

  const over = Math.max(0, minutesBetween(row.end_at, stamp.slice(0, 16)));
  let { minutes, cents } = await computeOvertime(row, over, rules);
  if (override && waive) cents = 0;

  await db.run(
    `UPDATE bookings SET checked_out_at = ?, check_out_method = ?, overtime_minutes = ?, overtime_cents = ?,
            overtime_payment_status = ?, updated_at = ? WHERE id = ?`,
    [stamp, override ? 'admin' : method === 'qr' ? 'qr' : 'app', minutes, cents, cents > 0 ? 'pending' : 'none', nowStamp(), id],
  );

  const fresh = await getBookingRow(id);
  const used = Math.max(0, minutesBetween(fresh.checked_in_at.slice(0, 16), stamp.slice(0, 16)));
  sendTemplated('checkout_confirmed', {
    to: fresh.user_email,
    vars: sessionVars(fresh, {
      entrada: hhmm(fresh.checked_in_at),
      saida: hhmm(stamp),
      duracao: `${Math.floor(used / 60)}h${String(used % 60).padStart(2, '0')}`,
      excedente_minutos: String(minutes),
      excedente_valor: cents > 0 ? formatBRL(cents) : '',
      aviso_excedente:
        minutes > 0
          ? cents > 0
            ? `Você ficou ${minutes} min além do horário reservado. Excedente: ${formatBRL(cents)} (cobrado por minuto).`
            : `Você ficou ${minutes} min além do horário reservado.`
          : '',
    }),
  }).catch(() => {});
  return serializeBooking(fresh, { rules, now: nowLocal(), isAdmin: actor.role === 'admin', viewerId: actor.id });
}

/** Administração: perdoar ou mudar a situação de pagamento do excedente. */
export async function setOvertime({ id, action }) {
  const row = await getBookingRow(id);
  if (!row.checked_out_at) throw new HttpError(422, 'O uso ainda não foi encerrado.');
  if (action === 'waive') {
    await db.run(
      "UPDATE bookings SET overtime_cents = 0, overtime_payment_status = 'none', overtime_paid_at = NULL, overtime_payment_method = NULL, updated_at = ? WHERE id = ?",
      [nowStamp(), id],
    );
  } else {
    if (Number(row.overtime_cents) === 0) throw new HttpError(422, 'Esta reserva não tem excedente a cobrar.');
    await db.run(
      'UPDATE bookings SET overtime_payment_status = ?, overtime_paid_at = ?, overtime_payment_method = ?, updated_at = ? WHERE id = ?',
      [action, action === 'paid' ? nowStamp() : null, action === 'paid' ? 'outro' : null, nowStamp(), id],
    );
  }
  return serializeBooking(await getBookingRow(id), { rules: await getSettings(), now: nowLocal(), isAdmin: true });
}

/** Quem esqueceu o check-out é encerrado no horário previsto, sem excedente, depois do prazo configurado. */
export async function autoCloseSessions() {
  const rules = await getSettings();
  const limit = addMinutesAt(nowLocal().at, -(rules.auto_close_minutes ?? 180));
  const rows = await db.query(
    `SELECT id, end_at FROM bookings
      WHERE status = 'confirmed' AND checked_in_at IS NOT NULL AND checked_out_at IS NULL AND end_at <= ?`,
    [limit],
  );
  for (const r of rows) {
    await db.run(
      `UPDATE bookings SET checked_out_at = ?, check_out_method = 'auto', overtime_minutes = 0, overtime_cents = 0,
              overtime_payment_status = 'none', updated_at = ? WHERE id = ?`,
      [`${r.end_at}:00`, nowStamp(), r.id],
    );
  }
  return rows.length;
}

/** Reserva do cliente, nesta sala, que importa "agora": em uso > pode fazer check-in > próxima do dia. */
export async function findRoomSession(userId, roomId) {
  const rules = await getSettings();
  const now = nowLocal();
  const rows = await db.query(
    `${BOOKING_SELECT} WHERE b.room_id = ? AND b.user_id = ? AND b.status = 'confirmed' AND b.date >= ? AND b.date <= ? ORDER BY b.start_at`,
    [roomId, userId, addDays(now.date, -1), addDays(now.date, 1)],
  );
  const open = rows.find((r) => r.checked_in_at && !r.checked_out_at);
  const ready = rows.find((r) => !r.checked_in_at && now.at <= r.end_at && minutesBetween(now.at, r.start_at) <= (rules.checkin_window_minutes ?? 0));
  const upcoming = rows.find((r) => !r.checked_in_at && !r.checked_out_at && r.start_at > now.at);
  const recent = [...rows].reverse().find((r) => r.checked_out_at && minutesBetween(r.checked_out_at.slice(0, 16), now.at) <= 120);
  const current = open ?? ready ?? recent ?? null;
  const next = upcoming && upcoming !== current ? upcoming : null;
  return { current, next, rules, now };
}

/** Situação de cada sala neste momento (painel da administração). */
export async function liveRooms(rules, now) {
  const rooms = await db.query('SELECT id, name, slug, image FROM rooms WHERE active = 1 ORDER BY sort_order, name');
  const rows = await db.query(
    `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.date >= ? AND b.date <= ? AND (b.end_at >= ? OR (b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL)) ORDER BY b.start_at`,
    [addDays(now.date, -1), addDays(now.date, 1), now.at],
  );
  const opts = { rules, now, isAdmin: true };
  return rooms.map((room) => {
    const mine = rows.filter((r) => Number(r.room_id) === Number(room.id));
    const open = mine.find((r) => r.checked_in_at && !r.checked_out_at);
    const waiting = mine.find((r) => !r.checked_in_at && r.start_at <= now.at && now.at <= r.end_at);
    const next = mine.find((r) => !r.checked_in_at && r.start_at > now.at);
    const current = open ?? waiting ?? null;
    const state = open ? serializeBooking(open, opts).session.state : waiting ? 'awaiting_checkin' : 'free';
    return {
      room: { id: Number(room.id), name: room.name, slug: room.slug, image: room.image },
      state,
      booking: current ? serializeBooking(current, opts) : null,
      next: next ? { date: next.date, start_time: next.start_time, client: next.user_name } : null,
    };
  });
}

/** Reservas confirmadas que terminaram sem check-in (últimos 14 dias): candidatas a "não compareceu". */
export async function noCheckinList(rules, now) {
  const rows = await db.query(
    `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.checked_in_at IS NULL AND b.end_at < ? AND b.date >= ? ORDER BY b.start_at DESC LIMIT 20`,
    [now.at, addDays(now.date, -14)],
  );
  return rows.map((r) => serializeBooking(r, { rules, now, isAdmin: true }));
}
