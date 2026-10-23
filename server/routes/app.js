import express from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { optionalAuth, verifyToken } from '../middleware/auth.js';
import {
  buildDaySlots,
  buildMonthOverview,
  getBusinessHours,
  hoursFor,
  inList,
  loadOccupation,
  validateWindow,
  assertFree,
  CONSUMING,
} from '../services/availability.js';
import {
  BOOKING_SELECT,
  cancelBooking,
  computePricing,
  createBookings,
  getBookingRow,
  releaseExpiredHolds,
  releaseHold,
  serializeBooking,
  updateBooking,
} from '../services/bookings.js';
import { checkIn, checkOut, checkoutPreview, findRoomSession, computeOvertime } from '../services/sessions.js';
import { createCharge, getPaymentFor, payBookingDirect, presentPayment, syncPayment } from '../services/onlinePayments.js';
import { config } from '../config.js';
import { packagesForClient, purchasePackage } from '../services/packages.js';
import { plansForClient, subscribeToPlan } from '../services/plans.js';
import { onlinePaymentsReady } from '../services/settings.js';
import { getSettings, publicSettings } from '../services/settings.js';
import { HttpError, asyncHandler, parse } from '../utils/http.js';
import { bookingToIcs } from '../utils/ics.js';
import { DATE_RE, addDays, daysBetween, monthRange, nowLocal, TIME_RE, isValidDate } from '../utils/time.js';

const router = express.Router();

export const presentRoom = (r) => ({
  id: Number(r.id),
  name: r.name,
  slug: r.slug,
  tagline: r.tagline,
  description: r.description || '',
  capacity: Number(r.capacity),
  price_cents: Number(r.price_cents),
  image: r.image,
  amenities: safeJson(r.amenities),
  min_minutes: Number(r.min_minutes),
  max_minutes: Number(r.max_minutes),
  buffer_minutes: Number(r.buffer_minutes),
  active: Boolean(Number(r.active)),
  sort_order: Number(r.sort_order),
});

function safeJson(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Configurações públicas (tela de login precisa saber se o cadastro está aberto). */
router.get(
  '/public',
  asyncHandler(async (_req, res) => {
    res.json({ settings: publicSettings(await getSettings()) });
  }),
);

// Consultas de leitura (salas, planos, horários e disponibilidade) são públicas; reservar exige login.
router.use(optionalAuth);

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: publicSettings(await getSettings()), hours: await getBusinessHours() });
  }),
);

router.get(
  '/rooms',
  asyncHandler(async (_req, res) => {
    const rows = await db.query('SELECT * FROM rooms WHERE active = 1 ORDER BY sort_order, name');
    res.json({ rooms: rows.map(presentRoom) });
  }),
);

/** Planos ativos, para a tabela de valores na página de cada sala. */
router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const rows = await db.query('SELECT id, name, description, included_minutes, unlimited, room_discount_percent FROM plans WHERE active = 1 ORDER BY sort_order, id');
    res.json({
      plans: rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        description: p.description,
        included_minutes: Number(p.included_minutes),
        unlimited: Boolean(Number(p.unlimited)),
        room_discount_percent: Number(p.room_discount_percent),
      })),
    });
  }),
);

/* ---------------- disponibilidade ---------------- */

const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido'),
  room_id: z.coerce.number().int().positive().optional(),
});

router.get(
  '/availability/month',
  asyncHandler(async (req, res) => {
    await releaseExpiredHolds();
    const q = parse(monthQuery, req.query);
    const isAdmin = req.user?.role === 'admin';
    const rules = await getSettings();
    const { from, to } = monthRange(q.month);
    const rooms = (await db.query(`SELECT * FROM rooms WHERE active = 1${q.room_id ? ' AND id = ?' : ''}`, q.room_id ? [q.room_id] : [])).map(presentRoom);
    const occupation = await loadOccupation({ from, to });
    const days = buildMonthOverview({
      month: q.month, rooms, hoursList: await getBusinessHours(), occupation, rules,
      now: nowLocal(), userId: req.user?.id ?? null, isAdmin,
    });
    res.json({ month: q.month, days });
  }),
);

router.get(
  '/availability/day',
  asyncHandler(async (req, res) => {
    await releaseExpiredHolds();
    const q = parse(
      z.object({ date: z.string().regex(DATE_RE, 'Data inválida'), room_id: z.coerce.number().int().positive().optional() }),
      req.query,
    );
    if (!isValidDate(q.date)) throw new HttpError(400, 'Data inválida.');
    const isAdmin = req.user?.role === 'admin';
    const rules = await getSettings();
    const now = nowLocal();
    const hours = hoursFor(await getBusinessHours(), q.date);
    const rooms = (await db.query(`SELECT * FROM rooms WHERE active = 1${q.room_id ? ' AND id = ?' : ''} ORDER BY sort_order, name`, q.room_id ? [q.room_id] : [])).map(presentRoom);
    const occupation = await loadOccupation({ from: q.date, to: q.date });

    const beyond = !isAdmin && q.date > addDays(now.date, rules.max_advance_days);
    const result = rooms.map((room) => ({
      room,
      ...(beyond
        ? { open: hours?.is_open ?? false, slots: [] }
        : buildDaySlots({ room, date: q.date, hours, rules, now, isAdmin, userId: req.user?.id ?? null, ...occupation })),
    }));

    res.json({
      date: q.date,
      open: Boolean(hours?.is_open),
      open_time: hours?.open_time,
      close_time: hours?.close_time,
      step: rules.slot_step_minutes,
      beyond,
      rooms: result,
    });
  }),
);

router.use(verifyToken);

/* ---------------- pagamento online (Pagar.me) ---------------- */

/** Gera (ou reaproveita) o link para o cliente pagar a própria fatura do mês ou uma reserva. */
router.post(
  '/payments',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        scope: z.enum(['month', 'booking']),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        booking_id: z.coerce.number().int().positive().optional(),
      }).refine((v) => (v.scope === 'month' ? !!v.month : !!v.booking_id), 'Informe o mês ou a reserva.'),
      req.body,
    );
    res.status(201).json({ payment: await createCharge({ actor: req.user, userId: req.user.id, scope: d.scope, month: d.month, bookingId: d.booking_id }) });
  }),
);

/** O que o popup de reserva precisa saber para oferecer o pagamento na hora. */
router.get(
  '/payments/config',
  asyncHandler(async (_req, res) => {
    const rules = await getSettings();
    const methods = String(rules.pagarme_methods || '').split(',').filter((m) => ['pix', 'credit_card'].includes(m));
    const ready = onlinePaymentsReady(rules);
    res.json({
      pay_on_booking: ready && Boolean(rules.pay_on_booking),
      methods: methods.filter((m) => m !== 'credit_card' || Boolean(config.pagarme.publicKey)), // cartão precisa da chave pública
      public_key: config.pagarme.publicKey || null,
      max_installments: rules.pagarme_max_installments,
      hold_minutes: rules.booking_hold_minutes,
    });
  }),
);

router.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    res.json({ payment: presentPayment(await getPaymentFor(req.user, Number(req.params.id))) });
  }),
);

/** Chamada quando o cliente volta do Pagar.me: confirma o pagamento direto na fonte. */
router.post(
  '/payments/:id/sync',
  asyncHandler(async (req, res) => {
    const own = await getPaymentFor(req.user, Number(req.params.id));
    const payment = await syncPayment(Number(req.params.id));
    let booking = null;
    if (own.kind === 'booking') {
      const item = JSON.parse(own.items).bookings?.[0];
      if (item) booking = serializeBooking(await getBookingRow(item.id), { rules: await getSettings(), now: nowLocal(), viewerId: req.user.id });
    }
    res.json({ payment, booking });
  }),
);

/** Paga a reserva que está segurada: Pix (devolve o QR code) ou cartão (token gerado no navegador). */
router.post(
  '/payments/booking',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        booking_id: z.coerce.number().int().positive(),
        method: z.enum(['pix', 'credit_card']),
        document: z.string().trim().max(24),
        phone: z.string().trim().max(24),
        card_token: z.string().trim().max(80).optional(),
        installments: z.coerce.number().int().min(1).max(12).optional().default(1),
      }),
      req.body,
    );
    const payment = await payBookingDirect({
      actor: req.user, bookingId: d.booking_id, method: d.method, cardToken: d.card_token, installments: d.installments, document: d.document, phone: d.phone,
    });
    const booking = serializeBooking(await getBookingRow(d.booking_id), { rules: await getSettings(), now: nowLocal(), viewerId: req.user.id });
    res.json({ payment, booking });
  }),
);

/** O cliente desistiu de pagar: libera o horário na hora. */
router.post(
  '/bookings/:id/release-hold',
  asyncHandler(async (req, res) => {
    res.json(await releaseHold({ actor: req.user, id: Number(req.params.id) }));
  }),
);

/* ---------------- reservas ---------------- */

const guestEmail = z.string().trim().toLowerCase().email('E-mail de convidado inválido').max(160);
/** Convidados (até 10): só o e-mail, ou { name, email }. */
const guestList = z
  .array(z.union([guestEmail, z.object({ name: z.string().trim().max(120).optional().default(''), email: guestEmail })]))
  .max(10, 'Até 10 convidados por reserva.');

const bookingInput = z.object({
  room_id: z.coerce.number().int().positive('Escolha uma sala'),
  user_id: z.coerce.number().int().positive().optional(),
  date: z.string().regex(DATE_RE, 'Data inválida'),
  start_time: z.string().regex(TIME_RE, 'Horário inicial inválido'),
  end_time: z.string().regex(TIME_RE, 'Horário final inválido'),
  title: z.string().trim().max(160).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  attendees: z.coerce.number().int().min(1, 'Informe o número de pessoas').max(200).optional().default(1),
  repeat_weeks: z.coerce.number().int().min(0).max(52).optional().default(0),
  skip_conflicts: z.boolean().optional().default(false),
  exclude_booking_id: z.coerce.number().int().positive().optional(),
  guests: guestList.optional().default([]),
});

router.post(
  '/bookings/quote',
  asyncHandler(async (req, res) => {
    const input = parse(bookingInput, req.body);
    const isAdmin = req.user.role === 'admin';
    const rules = await getSettings();
    const room = await db.get('SELECT * FROM rooms WHERE id = ? AND active = 1', [input.room_id]);
    if (!room) throw new HttpError(404, 'Sala não encontrada.');
    const userId = isAdmin && input.user_id ? input.user_id : req.user.id;
    const user = await db.get('SELECT id, plan_id FROM users WHERE id = ?', [userId]);
    const minutes = validateWindow({
      room, date: input.date, start: input.start_time, end: input.end_time,
      hours: hoursFor(await getBusinessHours(), input.date), rules, now: nowLocal(), isAdmin,
    });
    await assertFree(db, {
      roomId: room.id, startAt: `${input.date} ${input.start_time}`, endAt: `${input.date} ${input.end_time}`,
      buffer: Number(room.buffer_minutes) || 0, excludeId: input.exclude_booking_id ?? null,
    });
    const pricing = await computePricing(db, { user, room, date: input.date, minutes, excludeId: input.exclude_booking_id ?? null });
    const { package_allocations: _allocations, ...quote } = pricing;
    res.json({ minutes, ...quote, price_per_hour_cents: Number(room.price_cents) });
  }),
);

router.post(
  '/bookings',
  asyncHandler(async (req, res) => {
    const input = parse(bookingInput, req.body);
    const result = await createBookings({ actor: req.user, input });
    res.status(201).json(result);
  }),
);

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({ scope: z.enum(['upcoming', 'past', 'all']).optional().default('all') }),
      req.query,
    );
    const rules = await getSettings();
    const now = nowLocal();
    let where = 'b.user_id = ?';
    const params = [req.user.id];
    let order = 'b.start_at DESC';
    if (q.scope === 'upcoming') {
      where += ` AND b.status IN ('pending','confirmed') AND b.end_at >= ?`;
      params.push(now.at);
      order = 'b.start_at ASC';
    } else if (q.scope === 'past') {
      where += ` AND (b.end_at < ? OR b.status IN ('cancelled','no_show'))`;
      params.push(now.at);
    }
    const rows = await db.query(`${BOOKING_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 300`, params);
    res.json({ bookings: rows.map((r) => serializeBooking(r, { rules, now, viewerId: req.user.id })) });
  }),
);

router.get(
  '/bookings/:id',
  asyncHandler(async (req, res) => {
    const row = await getBookingRow(Number(req.params.id));
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && Number(row.user_id) !== req.user.id) throw new HttpError(404, 'Reserva não encontrada.');
    res.json({ booking: serializeBooking(row, { rules: await getSettings(), isAdmin, viewerId: req.user.id }) });
  }),
);

const updateInput = z.object({
  room_id: z.coerce.number().int().positive().optional(),
  user_id: z.coerce.number().int().positive().optional(),
  date: z.string().regex(DATE_RE, 'Data inválida').optional(),
  start_time: z.string().regex(TIME_RE, 'Horário inicial inválido').optional(),
  end_time: z.string().regex(TIME_RE, 'Horário final inválido').optional(),
  title: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
  attendees: z.coerce.number().int().min(1).max(200).optional(),
  guests: guestList.optional(),
});

router.put(
  '/bookings/:id',
  asyncHandler(async (req, res) => {
    const input = parse(updateInput, req.body);
    res.json({ booking: await updateBooking({ actor: req.user, id: Number(req.params.id), input }) });
  }),
);

router.post(
  '/bookings/:id/cancel',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ reason: z.string().trim().max(250).optional().default(''), scope: z.enum(['one', 'series']).optional().default('one') }),
      req.body ?? {},
    );
    res.json(await cancelBooking({ actor: req.user, id: Number(req.params.id), ...input }));
  }),
);

const sessionInput = z.object({
  method: z.enum(['app', 'qr']).optional().default('app'),
  at: z.string().regex(TIME_RE, 'Horário inválido').optional(),
  waive: z.boolean().optional().default(false),
});

router.post(
  '/bookings/:id/check-in',
  asyncHandler(async (req, res) => {
    const input = parse(sessionInput, req.body ?? {});
    res.json({ booking: await checkIn({ actor: req.user, id: Number(req.params.id), ...input }) });
  }),
);

router.post(
  '/bookings/:id/check-out',
  asyncHandler(async (req, res) => {
    const input = parse(sessionInput, req.body ?? {});
    res.json({ booking: await checkOut({ actor: req.user, id: Number(req.params.id), ...input }) });
  }),
);

router.get(
  '/bookings/:id/checkout-preview',
  asyncHandler(async (req, res) => {
    res.json(await checkoutPreview({ actor: req.user, id: Number(req.params.id) }));
  }),
);

/** Página aberta pelo QR da sala: a reserva do cliente que vale agora, com as ações possíveis. */
router.get(
  '/rooms/:slug/session',
  asyncHandler(async (req, res) => {
    const room = await db.get('SELECT * FROM rooms WHERE slug = ? AND active = 1', [req.params.slug]);
    if (!room) throw new HttpError(404, 'Sala não encontrada.');
    const { current, next, rules, now } = await findRoomSession(req.user.id, Number(room.id));
    const opts = { rules, now, viewerId: req.user.id };
    const booking = current ? serializeBooking(current, opts) : null;
    const estimate = booking?.session.state === 'in_use' || booking?.session.state === 'overtime'
      ? await computeOvertime(current, booking.session.live_overtime_minutes, rules)
      : null;
    res.json({
      room: presentRoom(room),
      booking,
      next: next ? serializeBooking(next, opts) : null,
      overtime_estimate: estimate,
      settings: publicSettings(rules),
    });
  }),
);

router.get(
  '/bookings/:id/ics',
  asyncHandler(async (req, res) => {
    const row = await getBookingRow(Number(req.params.id));
    if (req.user.role !== 'admin' && Number(row.user_id) !== req.user.id) throw new HttpError(404, 'Reserva não encontrada.');
    const rules = await getSettings();
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="reserva-${row.code}.ics"`,
    });
    res.send(bookingToIcs(row, { businessName: rules.business_name, address: rules.business_address }));
  }),
);

/* ---------------- consumo / faturas ---------------- */

export const monthStatement = (userId, month, rules, viewerId = userId) => rangeStatement(userId, monthRange(month), rules, viewerId, month);

/** Extrato de um período qualquer (de/até, inclusive). `month` só preenche o campo quando o período é um mês. */
export async function rangeStatement(userId, { from, to }, rules, viewerId = userId, month = '') {
  const now = nowLocal();
  const user = await db.get(
    `SELECT u.id, u.plan_id, p.name AS plan_name, p.included_minutes, p.unlimited, p.room_discount_percent
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.id = ?`,
    [userId],
  );
  const rows = await db.query(
    `${BOOKING_SELECT} WHERE b.user_id = ? AND b.date >= ? AND b.date <= ? AND b.status IN (${inList(CONSUMING)}) ORDER BY b.start_at`,
    [userId, from, to],
  );
  const bookings = rows.map((r) => serializeBooking(r, { rules, now, isAdmin: true, viewerId }));
  const sum = (fn) => bookings.reduce((a, b) => a + fn(b), 0);
  const unlimited = Boolean(Number(user?.unlimited));
  const includedTotal = unlimited ? null : Number(user?.included_minutes || 0);
  const includedUsed = sum((b) => b.included_minutes);

  return {
    month,
    from,
    to,
    plan: user?.plan_id
      ? { id: Number(user.plan_id), name: user.plan_name, included_minutes: includedTotal, unlimited, room_discount_percent: Number(user.room_discount_percent) }
      : null,
    included_total: includedTotal,
    included_used: includedUsed,
    included_remaining: includedTotal == null ? null : Math.max(0, includedTotal - includedUsed),
    totals: {
      bookings: bookings.length,
      minutes: sum((b) => b.total_minutes),
      amount_cents: sum((b) => b.price_cents + b.overtime_cents),
      paid_cents: sum((b) => (b.payment_status === 'paid' ? b.price_cents : 0) + (b.overtime_payment_status === 'paid' ? b.overtime_cents : 0)),
      pending_cents: sum((b) => (b.payment_status === 'pending' ? b.price_cents : 0) + (b.overtime_payment_status === 'pending' ? b.overtime_cents : 0)),
      overtime_cents: sum((b) => b.overtime_cents),
    },
    bookings,
  };
}

router.get(
  '/me/usage',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        // Período personalizado por dia: de/até (inclusive), no máximo 1 ano.
        from: z.string().regex(DATE_RE).refine(isValidDate, 'Data inicial inválida').optional(),
        to: z.string().regex(DATE_RE).refine(isValidDate, 'Data final inválida').optional(),
      }),
      req.query,
    );
    if (q.from || q.to) {
      if (!q.from || !q.to) throw new HttpError(400, 'Informe a data inicial e a final.');
      if (q.to < q.from) throw new HttpError(400, 'A data final não pode ser antes da inicial.');
      if (daysBetween(q.from, q.to) > 366) throw new HttpError(400, 'Escolha um período de até 1 ano.');
      return res.json(await rangeStatement(req.user.id, { from: q.from, to: q.to }, await getSettings()));
    }
    const month = q.month || nowLocal().date.slice(0, 7);
    res.json(await monthStatement(req.user.id, month, await getSettings()));
  }),
);

/** Pacotes de horas à venda e o saldo do cliente. */
router.get(
  '/me/packages',
  asyncHandler(async (req, res) => {
    res.json(await packagesForClient(req.user.id));
  }),
);

/** O cliente compra um pacote: devolve o link de pagamento online. */
router.post(
  '/me/packages/:id/purchase',
  asyncHandler(async (req, res) => {
    const packageId = parse(z.coerce.number().int().positive(), req.params.id);
    res.status(201).json(await purchasePackage({ actor: req.user, packageId }));
  }),
);

/** Planos disponíveis para o cliente escolher, com o plano atual e a troca aguardando pagamento. */
router.get(
  '/me/plans',
  asyncHandler(async (req, res) => {
    res.json(await plansForClient(req.user.id));
  }),
);

/** O cliente escolhe um plano: vale na hora se for sem mensalidade; se for pago, devolve o link de pagamento. */
router.post(
  '/me/plans/:id/subscribe',
  asyncHandler(async (req, res) => {
    const planId = parse(z.coerce.number().int().positive(), req.params.id);
    res.status(201).json(await subscribeToPlan({ actor: req.user, planId }));
  }),
);

router.get(
  '/me/statements',
  asyncHandler(async (req, res) => {
    const rows = await db.query(
      `SELECT SUBSTR(date, 1, 7) AS month, COUNT(*) AS bookings, SUM(total_minutes) AS minutes, SUM(price_cents + overtime_cents) AS amount_cents,
              SUM(CASE WHEN payment_status = 'paid' THEN price_cents ELSE 0 END + CASE WHEN overtime_payment_status = 'paid' THEN overtime_cents ELSE 0 END) AS paid_cents
         FROM bookings WHERE user_id = ? AND status IN (${inList(CONSUMING)})
        GROUP BY SUBSTR(date, 1, 7) ORDER BY month DESC LIMIT 24`,
      [req.user.id],
    );
    res.json({
      statements: rows.map((r) => ({
        month: r.month,
        bookings: Number(r.bookings),
        minutes: Number(r.minutes),
        amount_cents: Number(r.amount_cents),
        paid_cents: Number(r.paid_cents),
      })),
    });
  }),
);

export default router;
