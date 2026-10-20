import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import {
  addDays,
  addMinutesAt,
  fromMin,
  isValidDate,
  isValidTime,
  monthRange,
  toMin,
  weekdayOf,
} from '../utils/time.js';

/** Status que ocupam a sala. */
export const OCCUPYING = ['pending', 'confirmed'];
/** Status que consomem as horas incluídas no plano. */
export const CONSUMING = ['pending', 'confirmed', 'no_show'];

export const inList = (list) => list.map((s) => `'${s}'`).join(', ');

export async function getBusinessHours() {
  const rows = await db.query('SELECT weekday, is_open, open_time, close_time FROM business_hours ORDER BY weekday');
  return rows.map((r) => ({ ...r, weekday: Number(r.weekday), is_open: Boolean(Number(r.is_open)) }));
}

export const hoursFor = (hoursList, date) => hoursList.find((h) => h.weekday === weekdayOf(date));

export async function loadOccupation({ from, to, roomId, conn = db }) {
  const params = [from, to];
  let roomSql = '';
  if (roomId) {
    roomSql = ' AND room_id = ?';
    params.push(roomId);
  }
  const bookings = await conn.query(
    `SELECT id, room_id, user_id, date, start_time, end_time, start_at, end_at, status
       FROM bookings WHERE date >= ? AND date <= ? AND status IN (${inList(OCCUPYING)})${roomSql}`,
    params,
  );
  const blocks = await conn.query(
    `SELECT id, room_id, start_at, end_at, reason FROM blocks
      WHERE start_at < ? AND end_at > ?${roomId ? ' AND (room_id IS NULL OR room_id = ?)' : ''}`,
    roomId ? [`${addDays(to, 1)} 00:00`, `${from} 00:00`, roomId] : [`${addDays(to, 1)} 00:00`, `${from} 00:00`],
  );
  return { bookings, blocks };
}

/**
 * Monta a grade de um dia para uma sala.
 * state: free | booked | blocked | past
 */
export function buildDaySlots({ room, date, hours, bookings, blocks, rules, now, isAdmin = false, userId = null }) {
  if (!hours?.is_open) return { open: false, slots: [] };

  const step = rules.slot_step_minutes;
  const open = toMin(hours.open_time);
  const close = toMin(hours.close_time);
  const buffer = Number(room.buffer_minutes) || 0;
  const earliest = isAdmin ? now.at : addMinutesAt(now.at, rules.min_notice_minutes);
  const roomBookings = bookings.filter((b) => Number(b.room_id) === Number(room.id) && b.date === date);
  const roomBlocks = blocks.filter((b) => b.room_id == null || Number(b.room_id) === Number(room.id));

  const slots = [];
  for (let t = open; t + step <= close; t += step) {
    const start = `${date} ${fromMin(t)}`;
    const end = addMinutesAt(start, step);
    let state = 'free';
    let mine = false;

    if (roomBlocks.some((b) => b.start_at < end && b.end_at > start)) state = 'blocked';
    else {
      const hit = roomBookings.find((b) => b.start_at < addMinutesAt(end, buffer) && b.end_at > addMinutesAt(start, -buffer));
      if (hit) {
        state = 'booked';
        mine = userId != null && Number(hit.user_id) === Number(userId);
      } else if (start < earliest) state = 'past';
    }
    slots.push({ time: fromMin(t), state, ...(mine ? { mine } : {}) });
  }
  return { open: true, open_time: hours.open_time, close_time: hours.close_time, slots };
}

/** Regras de negócio para uma janela de reserva (sem consultar conflitos). */
export function validateWindow({ room, date, start, end, hours, rules, now, isAdmin = false }) {
  if (!isValidDate(date)) throw new HttpError(400, 'Data inválida.');
  if (!isValidTime(start) || !isValidTime(end)) throw new HttpError(400, 'Horário inválido.');

  const s = toMin(start);
  const e = toMin(end);
  if (e <= s) throw new HttpError(422, 'O horário final precisa ser depois do inicial.');

  if (!hours?.is_open) throw new HttpError(422, 'O espaço não funciona nesse dia.');
  const open = toMin(hours.open_time);
  const close = toMin(hours.close_time);
  if (s < open || e > close) {
    throw new HttpError(422, `Fora do horário de funcionamento (${hours.open_time} às ${hours.close_time}).`);
  }

  const step = rules.slot_step_minutes;
  if ((s - open) % step !== 0 || (e - open) % step !== 0) {
    throw new HttpError(422, `Os horários precisam seguir intervalos de ${step} minutos.`);
  }

  const duration = e - s;
  if (!isAdmin) {
    if (duration < room.min_minutes) throw new HttpError(422, `Duração mínima para esta sala: ${room.min_minutes} minutos.`);
    if (duration > room.max_minutes) throw new HttpError(422, `Duração máxima para esta sala: ${room.max_minutes / 60} horas.`);

    const startAt = `${date} ${start}`;
    if (startAt < addMinutesAt(now.at, rules.min_notice_minutes)) {
      throw new HttpError(
        422,
        rules.min_notice_minutes > 0
          ? `Reservas exigem antecedência mínima de ${formatNotice(rules.min_notice_minutes)}.`
          : 'Esse horário já passou.',
      );
    }
    if (date > addDays(now.date, rules.max_advance_days)) {
      throw new HttpError(422, `Só é possível reservar com até ${rules.max_advance_days} dias de antecedência.`);
    }
  }
  return duration;
}

const formatNotice = (min) => (min % 60 === 0 ? `${min / 60}h` : `${min} minutos`);

export async function assertFree(conn, { roomId, startAt, endAt, buffer = 0, excludeId = null }) {
  const from = addMinutesAt(startAt, -buffer);
  const to = addMinutesAt(endAt, buffer);

  const clash = await conn.get(
    `SELECT id FROM bookings
      WHERE room_id = ? AND status IN (${inList(OCCUPYING)}) AND start_at < ? AND end_at > ?${excludeId ? ' AND id <> ?' : ''}
      LIMIT 1`,
    excludeId ? [roomId, to, from, excludeId] : [roomId, to, from],
  );
  if (clash) throw new HttpError(409, 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário.', { code: 'CONFLICT' });

  const block = await conn.get(
    'SELECT reason FROM blocks WHERE (room_id IS NULL OR room_id = ?) AND start_at < ? AND end_at > ? LIMIT 1',
    [roomId, endAt, startAt],
  );
  if (block) {
    throw new HttpError(409, `Sala indisponível nesse período${block.reason ? ` (${block.reason})` : ''}.`, { code: 'BLOCKED' });
  }
}

/** Visão do mês: por dia, se está aberto / lotado / disponível. */
export function buildMonthOverview({ month, rooms, hoursList, occupation, rules, now, userId = null, isAdmin = false }) {
  const { from, to } = monthRange(month);
  const maxDate = addDays(now.date, rules.max_advance_days);
  const days = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const hours = hoursFor(hoursList, date);
    const base = { date };

    if (date < now.date) {
      days.push({ ...base, state: 'past' });
      continue;
    }
    if (!isAdmin && date > maxDate) {
      days.push({ ...base, state: 'beyond' });
      continue;
    }
    if (!hours?.is_open) {
      days.push({ ...base, state: 'closed' });
      continue;
    }

    let free = 0;
    let mine = false;
    for (const room of rooms) {
      const day = buildDaySlots({ room, date, hours, rules, now, isAdmin, userId, ...occupation });
      free += day.slots.filter((s) => s.state === 'free').length;
      mine = mine || day.slots.some((s) => s.mine);
    }
    days.push({ ...base, state: free > 0 ? 'available' : 'full', free_slots: free, ...(mine ? { mine } : {}) });
  }
  return days;
}
