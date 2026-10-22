import crypto from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { shownEmail } from '../utils/email.js';
import { HttpError } from '../utils/http.js';
import { MAX_GUESTS, guestsToDb, normalizeGuests, parseGuests } from '../utils/guests.js';
import { bookingToIcs } from '../utils/ics.js';
import { sendTemplated } from './emailTemplates.js';
import { onlinePaymentsReady } from './settings.js';
import { creditCancelledBooking, planPackageUse, revokeCancellationCredit, savePackageUse } from './packages.js';
import { sessionInfo } from './sessionState.js';
import { addDays, addMinutesAt, minutesBetween, monthRange, nowLocal, nowStamp } from '../utils/time.js';
import { getSettings } from './settings.js';
import { CONSUMING, OCCUPYING, assertFree, getBusinessHours, hoursFor, inList, validateWindow } from './availability.js';

/** Valor mínimo para cobrar online (o Pagar.me não aceita menos de R$ 1,00). */
export const MIN_ONLINE_CENTS = 100;

export const BOOKING_SELECT = `
  SELECT b.*, r.name AS room_name, r.slug AS room_slug, r.image AS room_image, r.capacity AS room_capacity,
         u.name AS user_name, u.email AS user_email, u.phone AS user_phone, u.company AS user_company
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    JOIN users u ON u.id = b.user_id`;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export const formatBRL = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatDateBR = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Transforma uma linha do banco na forma devolvida pela API. */
export function serializeBooking(row, { rules, now = nowLocal(), isAdmin = false, viewerId = null } = {}) {
  const active = OCCUPYING.includes(row.status);
  const displayStatus = row.status === 'confirmed' && row.end_at < now.at ? 'completed' : row.status;
  const minutesToStart = minutesBetween(now.at, row.start_at);
  const inWindow = minutesToStart >= (rules?.cancel_min_hours ?? 0) * 60;
  const own = viewerId != null && Number(row.user_id) === Number(viewerId);

  const out = {
    id: Number(row.id),
    code: row.code,
    room: { id: Number(row.room_id), name: row.room_name, slug: row.room_slug, image: row.room_image },
    date: row.date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    display_status: displayStatus,
    title: row.title,
    notes: row.notes || '',
    attendees: Number(row.attendees),
    total_minutes: Number(row.total_minutes),
    included_minutes: Number(row.included_minutes),
    package_minutes: Number(row.package_minutes ?? 0),
    price_cents: Number(row.price_cents),
    payment_status: row.payment_status,
    series_id: row.series_id,
    created_at: row.created_at,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    can_cancel: active && (isAdmin || (own && inWindow)),
    can_edit: active && (isAdmin || (own && inWindow)),
    awaiting_payment: Boolean(row.hold_until) && row.status === 'pending',
    hold_until: row.hold_until ?? null,
    checked_in_at: row.checked_in_at ?? null,
    check_in_method: row.check_in_method ?? null,
    checked_out_at: row.checked_out_at ?? null,
    check_out_method: row.check_out_method ?? null,
    overtime_minutes: Number(row.overtime_minutes || 0),
    overtime_cents: Number(row.overtime_cents || 0),
    overtime_payment_status: row.overtime_payment_status || 'none',
    session: sessionInfo(row, rules ?? {}, now),
  };
  if (isAdmin || own) {
    out.guests = parseGuests(row.guests);
    out.user = {
      id: Number(row.user_id),
      name: row.user_name,
      email: shownEmail(row.user_email),
      phone: row.user_phone,
      company: row.user_company,
    };
  }
  return out;
}

/** Horas incluídas no plano já consumidas no mês da data informada. */
async function usedIncludedMinutes(conn, userId, date, excludeId = null) {
  const { from, to } = monthRange(date.slice(0, 7));
  const row = await conn.get(
    `SELECT COALESCE(SUM(included_minutes), 0) AS used FROM bookings
      WHERE user_id = ? AND date >= ? AND date <= ? AND status IN (${inList(CONSUMING)})${excludeId ? ' AND id <> ?' : ''}`,
    excludeId ? [userId, from, to, excludeId] : [userId, from, to],
  );
  return Number(row.used);
}

export async function computePricing(conn, { user, room, date, minutes, excludeId = null }) {
  const plan = user.plan_id ? await conn.get('SELECT * FROM plans WHERE id = ?', [user.plan_id]) : null;
  const unlimited = Boolean(plan && Number(plan.unlimited));
  let included = 0;

  if (unlimited) included = minutes;
  else if (plan && Number(plan.included_minutes) > 0) {
    const used = await usedIncludedMinutes(conn, user.id, date, excludeId);
    included = Math.max(0, Math.min(minutes, Number(plan.included_minutes) - used));
  }

  // Depois das horas do plano, o saldo de pacotes comprados cobre o que sobrar (da compra que vence primeiro).
  const pkg = await planPackageUse(conn, { userId: user.id, date, minutes: minutes - included, excludeId, roomId: room.id });

  const payable = minutes - included - pkg.used;
  const discount = plan ? Number(plan.room_discount_percent) : 0;
  const price = Math.round(((Number(room.price_cents) * payable) / 60) * (1 - discount / 100));
  return {
    included_minutes: included,
    package_minutes: pkg.used,
    package_allocations: pkg.allocations,
    price_cents: price,
    payment_status: price > 0 ? 'pending' : 'none',
  };
}

async function loadRoom(conn, id, { requireActive = true } = {}) {
  const room = await conn.get('SELECT * FROM rooms WHERE id = ?', [id]);
  if (!room || (requireActive && !Number(room.active))) throw new HttpError(404, 'Sala não encontrada ou indisponível.');
  return room;
}

async function loadUser(conn, id) {
  const user = await conn.get('SELECT id, name, email, phone, plan_id, active, role FROM users WHERE id = ?', [id]);
  if (!user || !Number(user.active)) throw new HttpError(404, 'Cliente não encontrado ou inativo.');
  return user;
}

export async function createBookings({ actor, input }) {
  await releaseExpiredHolds();
  const isAdmin = actor.role === 'admin';
  const rules = await getSettings();
  const now = nowLocal();
  const hoursList = await getBusinessHours();

  const userId = isAdmin && input.user_id ? input.user_id : actor.id;
  const room = await loadRoom(db, input.room_id);
  const user = await loadUser(db, userId);

  if (input.attendees > room.capacity) {
    throw new HttpError(422, `Esta sala comporta até ${room.capacity} pessoas.`);
  }

  const repeat = Math.min(input.repeat_weeks || 0, rules.max_recurrence_weeks);
  const dates = Array.from({ length: repeat + 1 }, (_, i) => addDays(input.date, i * 7));

  if (!isAdmin && rules.max_upcoming_bookings > 0) {
    const row = await db.get(
      `SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status IN (${inList(OCCUPYING)}) AND start_at >= ?`,
      [userId, now.at],
    );
    if (Number(row.n) + dates.length > rules.max_upcoming_bookings) {
      throw new HttpError(422, `Limite de ${rules.max_upcoming_bookings} reservas futuras atingido. Cancele alguma ou fale com a recepção.`);
    }
  }

  // Regras de negócio (horário, duração, antecedência) por data
  const skipped = [];
  const valid = [];
  dates.forEach((date, i) => {
    try {
      const minutes = validateWindow({
        room, date, start: input.start_time, end: input.end_time,
        hours: hoursFor(hoursList, date), rules, now, isAdmin,
      });
      valid.push({ date, minutes });
    } catch (err) {
      if (!(err instanceof HttpError) || i === 0 || !input.skip_conflicts) throw err;
      skipped.push({ date, reason: err.message });
    }
  });

  const status = !isAdmin && rules.require_approval ? 'pending' : 'confirmed';
  const seriesId = dates.length > 1 ? `S-${randomCode(8)}` : null;
  const guests = normalizeGuests(input.guests, user.email);
  const guestsJson = guestsToDb(guests);
  // Pagamento no ato: só o cliente, em reserva única, quando a cobrança online está ligada e há valor a cobrar.
  const mayHold = !isAdmin && dates.length === 1 && rules.pay_on_booking && onlinePaymentsReady(rules);
  let held = false;
  const buffer = Number(room.buffer_minutes) || 0;

  const createdIds = await db.transaction(async (tx) => {
    await tx.get(tx.forUpdate('SELECT id FROM rooms WHERE id = ?'), [room.id]);
    const ids = [];

    for (const { date, minutes } of valid) {
      const startAt = `${date} ${input.start_time}`;
      const endAt = `${date} ${input.end_time}`;
      try {
        await assertFree(tx, { roomId: room.id, startAt, endAt, buffer });
      } catch (err) {
        if (err instanceof HttpError && err.status === 409 && input.skip_conflicts && date !== input.date) {
          skipped.push({ date, reason: err.message });
          continue;
        }
        throw err;
      }

      const pricing = await computePricing(tx, { user, room, date, minutes });
      const hold = mayHold && pricing.price_cents >= MIN_ONLINE_CENTS;
      if (hold) held = true;
      let code = `HZ-${randomCode(6)}`;
      while (await tx.get('SELECT id FROM bookings WHERE code = ?', [code])) code = `HZ-${randomCode(6)}`;

      const r = await tx.run(
        `INSERT INTO bookings
          (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
           total_minutes, included_minutes, package_minutes, price_cents, payment_status, series_id, created_by, created_at, updated_at, hold_until, guests)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code, room.id, user.id, date, input.start_time, input.end_time, startAt, endAt, hold ? 'pending' : status,
          input.title || '', input.notes || '', input.attendees, minutes, pricing.included_minutes, pricing.package_minutes,
          pricing.price_cents, pricing.payment_status, seriesId, actor.id, nowStamp(), nowStamp(),
          hold ? `${addMinutesAt(now.at, rules.booking_hold_minutes || 15)}:00` : null, guestsJson,
        ],
      );
      await savePackageUse(tx, r.insertId, pricing.package_allocations);
      ids.push(r.insertId);
    }
    return ids;
  });

  const created = await fetchByIds(createdIds, { rules, now, isAdmin, viewerId: actor.id });
  // Reserva aguardando pagamento só vira e-mail de confirmação depois de paga.
  if (!held) {
    notifyCreated(created, user).catch(() => {});
    // Convidados só são avisados quando a reserva está confirmada (não enquanto aguarda aprovação).
    if (created[0]?.status === 'confirmed') notifyGuestsInvite(created[0].id, { seriesCount: created.length }).catch(() => {});
  }
  return { bookings: created, skipped, payment_required: held };
}

async function fetchByIds(ids, opts) {
  if (!ids.length) return [];
  const rows = await db.query(`${BOOKING_SELECT} WHERE b.id IN (${ids.map(() => '?').join(',')}) ORDER BY b.start_at`, ids);
  return rows.map((r) => serializeBooking(r, opts));
}

export async function getBookingRow(id, conn = db) {
  const row = await conn.get(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Reserva não encontrada.');
  return row;
}

function assertCanManage(row, actor, rules, now, verb) {
  const isAdmin = actor.role === 'admin';
  if (!isAdmin && Number(row.user_id) !== Number(actor.id)) throw new HttpError(404, 'Reserva não encontrada.');
  if (!OCCUPYING.includes(row.status)) throw new HttpError(422, 'Esta reserva não está mais ativa.');
  if (!isAdmin && minutesBetween(now.at, row.start_at) < rules.cancel_min_hours * 60) {
    throw new HttpError(
      403,
      `${verb} só é possível até ${rules.cancel_min_hours}h antes do início. Entre em contato com a recepção.`,
    );
  }
}

export async function updateBooking({ actor, id, input }) {
  const isAdmin = actor.role === 'admin';
  const rules = await getSettings();
  const now = nowLocal();
  const current = await getBookingRow(id);
  assertCanManage(current, actor, rules, now, 'Alterar');

  const roomId = isAdmin && input.room_id ? input.room_id : Number(current.room_id);
  const room = await loadRoom(db, roomId);
  const userId = isAdmin && input.user_id ? input.user_id : Number(current.user_id);
  const user = await loadUser(db, userId);
  const attendees = input.attendees ?? Number(current.attendees);
  if (attendees > room.capacity) throw new HttpError(422, `Esta sala comporta até ${room.capacity} pessoas.`);

  const priorGuests = parseGuests(current.guests);
  const nextGuests = input.guests === undefined ? priorGuests : normalizeGuests(input.guests, user.email);

  const date = input.date ?? current.date;
  const start = input.start_time ?? current.start_time;
  const end = input.end_time ?? current.end_time;
  const hoursList = await getBusinessHours();
  const minutes = validateWindow({ room, date, start, end, hours: hoursFor(hoursList, date), rules, now, isAdmin });

  await db.transaction(async (tx) => {
    await tx.get(tx.forUpdate('SELECT id FROM rooms WHERE id = ?'), [room.id]);
    await assertFree(tx, {
      roomId: room.id, startAt: `${date} ${start}`, endAt: `${date} ${end}`,
      buffer: Number(room.buffer_minutes) || 0, excludeId: id,
    });
    const pricing = await computePricing(tx, { user, room, date, minutes, excludeId: id });
    const payment =
      current.payment_status === 'paid' && pricing.price_cents === Number(current.price_cents) ? 'paid' : pricing.payment_status;
    const pending = !isAdmin && rules.require_approval;

    await tx.run(
      `UPDATE bookings SET room_id = ?, user_id = ?, date = ?, start_time = ?, end_time = ?, start_at = ?, end_at = ?,
              title = ?, notes = ?, attendees = ?, total_minutes = ?, included_minutes = ?, package_minutes = ?, price_cents = ?,
              payment_status = ?, status = ?, guests = ?, updated_at = ? WHERE id = ?`,
      [
        room.id, user.id, date, start, end, `${date} ${start}`, `${date} ${end}`,
        input.title ?? current.title, input.notes ?? current.notes ?? '', attendees, minutes,
        pricing.included_minutes, pricing.package_minutes, pricing.price_cents, payment, pending ? 'pending' : current.status, guestsToDb(nextGuests), nowStamp(), id,
      ],
    );
    await savePackageUse(tx, id, pricing.package_allocations);
  });

  const row = serializeBooking(await getBookingRow(id), { rules, now, isAdmin, viewerId: actor.id });
  notifyChanged(row, user).catch(() => {});

  // Convidados: quem acabou de ser adicionado recebe o convite; quem já estava recebe o aviso se o encontro mudou.
  const added = nextGuests.filter((g) => !priorGuests.includes(g));
  const kept = nextGuests.filter((g) => priorGuests.includes(g));
  const moved = current.date !== date || current.start_time !== start || current.end_time !== end || Number(current.room_id) !== Number(room.id);
  if (row.status === 'confirmed' && added.length) notifyGuestsInvite(id, { only: added }).catch(() => {});
  if (moved && kept.length && row.status === 'confirmed') notifyGuests('guest_changed', id, kept).catch(() => {});
  return row;
}

export async function cancelBooking({ actor, id, reason = '', scope = 'one' }) {
  const isAdmin = actor.role === 'admin';
  const rules = await getSettings();
  const now = nowLocal();
  const row = await getBookingRow(id);
  assertCanManage(row, actor, rules, now, 'Cancelar');

  const ids = [id];
  if (scope === 'series' && row.series_id) {
    const future = await db.query(
      `SELECT id, start_at, user_id, status FROM bookings WHERE series_id = ? AND start_at >= ? AND status IN (${inList(OCCUPYING)}) AND id <> ?`,
      [row.series_id, row.start_at, id],
    );
    for (const f of future) {
      if (isAdmin || minutesBetween(now.at, f.start_at) >= rules.cancel_min_hours * 60) ids.push(Number(f.id));
    }
  }

  const stamp = nowStamp();
  let credited = 0; // minutos pagos que voltaram para o banco de horas do cliente
  for (const bid of ids) {
    const before = bid === id ? row : await getBookingRow(bid);
    await db.run(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
              payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'none' END, updated_at = ?
        WHERE id = ?`,
      [stamp, actor.id, reason.slice(0, 250), stamp, bid],
    );
    credited += await creditCancelledBooking(before, actor.id);
  }

  const fresh = await getBookingRow(id);
  notifyCancelled(fresh, isAdmin && Number(fresh.user_id) !== Number(actor.id)).catch(() => {});
  if (row.status === 'confirmed') notifyGuests('guest_cancelled', id).catch(() => {}); // só quem chegou a ser convidado
  return { cancelled: ids.length, credited_minutes: credited, booking: serializeBooking(fresh, { rules, now, isAdmin, viewerId: actor.id }) };
}

/** Ações exclusivas da administração: confirmar, marcar falta, reativar. */
export async function changeStatus({ actor, id, status }) {
  const rules = await getSettings();
  const now = nowLocal();
  const row = await getBookingRow(id);
  if (row.hold_until && row.status === 'pending') throw new HttpError(422, 'Esta reserva aguarda o pagamento do cliente. Ela confirma sozinha quando o pagamento cair.');

  if (status === 'confirmed' && row.status === 'cancelled') {
    const room = await loadRoom(db, row.room_id, { requireActive: false });
    await db.transaction(async (tx) => {
      await tx.get(tx.forUpdate('SELECT id FROM rooms WHERE id = ?'), [room.id]);
      await assertFree(tx, { roomId: room.id, startAt: row.start_at, endAt: row.end_at, buffer: Number(room.buffer_minutes) || 0, excludeId: id });
      const user = await loadUser(tx, row.user_id);
      const pricing = await computePricing(tx, { user, room, date: row.date, minutes: Number(row.total_minutes), excludeId: id });
      await tx.run(
        `UPDATE bookings SET status = 'confirmed', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
                included_minutes = ?, package_minutes = ?, price_cents = ?, payment_status = ?, updated_at = ? WHERE id = ?`,
        [pricing.included_minutes, pricing.package_minutes, pricing.price_cents, pricing.payment_status, nowStamp(), id],
      );
      await savePackageUse(tx, id, pricing.package_allocations);
      await revokeCancellationCredit(id, tx); // a reserva voltou: o crédito que ela tinha gerado sai do banco (se não foi usado)
    });
  } else {
    await db.run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [status, nowStamp(), id]);
  }

  const fresh = await getBookingRow(id);
  if (status === 'confirmed' && row.status === 'pending') notifyApproved(fresh).catch(() => {});
  return serializeBooking(fresh, { rules, now, isAdmin: true, viewerId: actor.id });
}

/* ---------- pagamento no ato da reserva ---------- */

const RELEASE_REASON = 'Pagamento não concluído';

/** Libera os horários cujo prazo para pagar acabou. */
export async function releaseExpiredHolds() {
  const r = await db.run(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, payment_status = 'none', hold_until = NULL, updated_at = ?
      WHERE status = 'pending' AND hold_until IS NOT NULL AND hold_until < ?`,
    [nowStamp(), RELEASE_REASON, nowStamp(), nowStamp()],
  );
  return r.changes;
}

/** O cliente desistiu de pagar: libera o horário na hora (só enquanto ainda não foi pago). */
export async function releaseHold({ actor, id }) {
  const row = await getBookingRow(id);
  if (actor.role !== 'admin' && Number(row.user_id) !== Number(actor.id)) throw new HttpError(404, 'Reserva não encontrada.');
  if (!row.hold_until || row.status !== 'pending') return { released: false };
  const paid = await db.get("SELECT id FROM online_payments WHERE kind = 'booking' AND status = 'paid' AND items LIKE ?", [`%"id":${Number(id)},%`]);
  if (paid) return { released: false };
  await db.run(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, payment_status = 'none', hold_until = NULL, updated_at = ? WHERE id = ?`,
    [nowStamp(), actor.id, RELEASE_REASON, nowStamp(), id],
  );
  return { released: true };
}

/** Depois que o pagamento cai: manda o e-mail de confirmação (ou de "recebida", se a aprovação estiver ligada). */
export async function notifyBookingPaid(id) {
  const rules = await getSettings();
  const row = await getBookingRow(id);
  const booking = serializeBooking(row, { rules, now: nowLocal(), isAdmin: false, viewerId: row.user_id });
  await notifyCreated([booking], { name: row.user_name, email: row.user_email, phone: row.user_phone });
  if (row.status === 'confirmed') await notifyGuestsInvite(id);
}

/* ---------- convidados ---------- */

const guestVars = (row, extra = {}) => ({
  anfitriao: row.user_name,
  anfitriao_email: row.user_email,
  sala: row.room_name,
  data: formatDateBR(row.date),
  horario_inicio: row.start_time,
  horario_fim: row.end_time,
  horario: `${row.start_time} às ${row.end_time}`,
  titulo: row.title || '',
  recorrencia: '',
  ...extra,
});

const guestRows = (row, address) => [
  ['Sala', row.room_name],
  ['Data', formatDateBR(row.date)],
  ['Horário', `${row.start_time} às ${row.end_time}`],
  ...(row.title ? [['Assunto', row.title]] : []),
  ['Convidado por', row.user_name],
  ...(address ? [['Local', address]] : []),
];

/** Avisa os convidados (todos, ou só `only`) com o modelo `key`. */
async function notifyGuests(key, id, only, extra = {}, withCalendar = false) {
  const row = await getBookingRow(id);
  const list = only ?? parseGuests(row.guests);
  if (!list.length) return;
  const rules = await getSettings();
  const attachments = withCalendar
    ? [{ filename: `reserva-${row.code}.ics`, content: bookingToIcs(row, { businessName: rules.business_name, address: rules.business_address }), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }]
    : undefined;
  for (const to of list.slice(0, MAX_GUESTS)) {
    await sendTemplated(key, { to, vars: guestVars(row, extra), rows: guestRows(row, rules.business_address), attachments });
  }
}

/** Convite: os convidados recebem os dados da reserva e o evento para o calendário (um só e-mail por série semanal). */
export async function notifyGuestsInvite(id, { only, seriesCount = 1 } = {}) {
  const extra = seriesCount > 1 ? { recorrencia: `Este encontro se repete toda semana (${seriesCount} vezes).` } : {};
  await notifyGuests('guest_invite', id, only, extra, true);
}

/* ---------- e-mails (melhor esforço) ---------- */

const summaryRows = (b) => [
  ['Sala', b.room_name],
  ['Data', formatDateBR(b.date)],
  ['Horário', `${b.start_time} às ${b.end_time}`],
  ...(Number(b.price_cents) > 0 ? [['Valor', formatBRL(Number(b.price_cents))]] : []),
  ['Código', b.code],
];

const firstName = (name = '') => name.trim().split(' ')[0];

/** Variáveis de e-mail de uma reserva (aceita a reserva serializada ou a linha do banco). */
const bookingVars = (b, person = {}) => {
  const roomName = b.room?.name ?? b.room_name;
  return {
    nome: firstName(person.name),
    nome_completo: person.name ?? '',
    email: person.email ?? '',
    sala: roomName,
    data: formatDateBR(b.date),
    horario_inicio: b.start_time,
    horario_fim: b.end_time,
    horario: `${b.start_time} às ${b.end_time}`,
    valor: Number(b.price_cents) > 0 ? formatBRL(Number(b.price_cents)) : '',
    codigo: b.code,
    motivo: b.cancel_reason ?? '',
  };
};

async function notifyCreated(bookings, user) {
  if (!bookings.length) return;
  const first = bookings[0];
  const many = bookings.length > 1;
  const pending = first.status === 'pending';
  const rows = summaryRows({ ...first, room_name: first.room.name });
  const vars = bookingVars(first, user);

  await sendTemplated(many ? 'booking_recurring' : pending ? 'booking_pending' : 'booking_confirmed', {
    to: user.email,
    vars: { ...vars, quantidade: String(bookings.length), situacao: pending ? 'recebidas (aguardam aprovação)' : 'confirmadas' },
    rows,
  });
  if (config.mail.notify) {
    await sendTemplated('admin_new_booking', {
      to: config.mail.notify,
      vars: { ...vars, cliente: user.name, email_cliente: user.email, telefone_cliente: user.phone ?? '' },
      rows,
    });
  }
}

async function notifyChanged(b, user) {
  await sendTemplated('booking_changed', { to: user.email, vars: bookingVars(b, user), rows: summaryRows({ ...b, room_name: b.room.name }) });
}

async function notifyCancelled(row, byAdmin) {
  await sendTemplated(byAdmin ? 'booking_cancelled_admin' : 'booking_cancelled_client', {
    to: row.user_email,
    vars: bookingVars(row, { name: row.user_name, email: row.user_email }),
    rows: summaryRows(row),
  });
}

async function notifyApproved(row) {
  notifyGuestsInvite(row.id).catch(() => {});
  await sendTemplated('booking_approved', {
    to: row.user_email,
    vars: bookingVars(row, { name: row.user_name, email: row.user_email }),
    rows: summaryRows(row),
  });
}
