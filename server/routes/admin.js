import bcrypt from 'bcryptjs';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { requireAdmin, requireModule, verifyToken } from '../middleware/auth.js';
import { LEVELS, MODULES, canEnterPanel, hasAccess, normalizePermissions } from '../services/access.js';
import { CONSUMING, OCCUPYING, getBusinessHours, inList } from '../services/availability.js';
import {
  BOOKING_SELECT,
  changeStatus,
  formatBRL,
  getBookingRow,
  serializeBooking,
} from '../services/bookings.js';
import {
  FIELD_LIMITS,
  getDefinition,
  listEmailTemplates,
  renderEmail,
  resetEmailTemplate,
  sampleData,
  saveEmailTemplate,
} from '../services/emailTemplates.js';
import { PAYMENT_METHODS, paidStamp, payInvoice } from '../services/finance.js';
import { liveRooms, noCheckinList, setOvertime } from '../services/sessions.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { HttpError, asyncHandler, parse } from '../utils/http.js';
import { sendMail } from '../utils/mailer.js';
import { DATE_RE, TIME_RE, addDays, daysBetween, isValidDate, nowLocal, nowStamp, toMin, weekdayOf } from '../utils/time.js';
import { monthStatement, presentRoom } from './app.js';

const router = express.Router();
router.use(verifyToken, requireAdmin);

/* Nível de acesso por área (perfis de usuário). Consultar pede "ver"; alterar pede "editar". */
router.use('/dashboard', requireModule(['dashboard']));
router.use('/agenda', requireModule(['agenda']));
router.use('/bookings', requireModule(['bookings', 'agenda']));
router.use('/rooms', requireModule(['rooms'], ['agenda', 'bookings']));
router.use('/upload', requireModule(['rooms']));
router.use('/plans', requireModule(['plans'], ['clients', 'finance']));
router.use('/blocks', requireModule(['blocks'], ['agenda']));
router.use('/email-templates', requireModule(['email_templates']));
router.use('/reports', (req, res, next) => requireModule(['reports'], req.path === '/export' ? ['bookings'] : [])(req, res, next));
router.use(['/profiles', '/profiles-users'], requireModule(['profiles']));
router.use('/users', (req, res, next) => {
  const isList = req.method === 'GET' && req.path === '/';
  return requireModule(['clients'], isList ? ['bookings', 'agenda', 'finance'] : [])(req, res, next);
});
// Regras e horários do espaço são lidas por várias telas; só quem tem Configurações altera.
router.use(['/settings', '/hours'], (req, res, next) => (req.method === 'GET' ? next() : requireModule(['settings'])(req, res, next)));

const id = z.coerce.number().int().positive();
const date = z.string().regex(DATE_RE, 'Data inválida').refine(isValidDate, 'Data inválida');
const time = z.string().regex(TIME_RE, 'Horário inválido');

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sala';

/* ---------------- painel ---------------- */

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const rules = await getSettings();
    const now = nowLocal();
    const hoursList = await getBusinessHours();
    const month = now.date.slice(0, 7);
    const monthFrom = `${month}-01`;
    const monthTo = `${month}-31`;

    const rooms = (await db.query('SELECT * FROM rooms WHERE active = 1 ORDER BY sort_order')).map(presentRoom);

    const todayRows = await db.query(
      `${BOOKING_SELECT} WHERE b.date = ? AND b.status IN (${inList(OCCUPYING)}) ORDER BY b.start_at`,
      [now.date],
    );
    const upcomingRows = await db.query(
      `${BOOKING_SELECT} WHERE b.end_at >= ? AND b.status IN (${inList(OCCUPYING)}) ORDER BY b.start_at LIMIT 8`,
      [now.at],
    );
    const pending = await db.get("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending' AND hold_until IS NULL");
    const clients = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'client' AND active = 1");
    const revenue = await db.get(
      `SELECT COALESCE(SUM(price_cents + overtime_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN price_cents ELSE 0 END + CASE WHEN overtime_payment_status = 'paid' THEN overtime_cents ELSE 0 END), 0) AS paid
         FROM bookings WHERE date >= ? AND date <= ? AND status IN (${inList(CONSUMING)})`,
      [monthFrom, monthTo],
    );
    const receivable = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN price_cents ELSE 0 END + CASE WHEN overtime_payment_status = 'pending' THEN overtime_cents ELSE 0 END), 0) AS total FROM bookings WHERE date <= ? AND status IN (${inList(CONSUMING)})`,
      [now.date],
    );
    const monthBookings = await db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_minutes), 0) AS minutes FROM bookings WHERE date >= ? AND date <= ? AND status IN (${inList(CONSUMING)})`,
      [monthFrom, monthTo],
    );

    // Ocupação de 14 dias (6 atrás → 7 à frente)
    const from = addDays(now.date, -6);
    const to = addDays(now.date, 7);
    const span = await db.query(
      `SELECT date, SUM(total_minutes) AS minutes, COUNT(*) AS n FROM bookings WHERE date >= ? AND date <= ? AND status IN (${inList(CONSUMING)}) GROUP BY date`,
      [from, to],
    );
    const byDate = new Map(span.map((r) => [r.date, r]));
    const series = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const h = hoursList.find((x) => x.weekday === weekdayOf(d));
      const cap = h?.is_open ? (toMin(h.close_time) - toMin(h.open_time)) * rooms.length : 0;
      const row = byDate.get(d);
      series.push({ date: d, minutes: Number(row?.minutes || 0), bookings: Number(row?.n || 0), capacity_minutes: cap, is_today: d === now.date });
    }

    const topRooms = await db.query(
      `SELECT r.id, r.name, COUNT(*) AS bookings, SUM(b.total_minutes) AS minutes
         FROM bookings b JOIN rooms r ON r.id = b.room_id
        WHERE b.date >= ? AND b.date <= ? AND b.status IN (${inList(CONSUMING)})
        GROUP BY r.id, r.name ORDER BY minutes DESC LIMIT 6`,
      [monthFrom, monthTo],
    );

    const opts = { rules, now, isAdmin: true };
    res.json({
      today: { date: now.date, bookings: todayRows.map((r) => serializeBooking(r, opts)) },
      upcoming: upcomingRows.map((r) => serializeBooking(r, opts)),
      kpis: {
        pending_approvals: Number(pending.n),
        active_clients: Number(clients.n),
        month_bookings: Number(monthBookings.n),
        month_minutes: Number(monthBookings.minutes),
        month_revenue_cents: Number(revenue.total),
        month_paid_cents: Number(revenue.paid),
        receivable_cents: Number(receivable.total),
        rooms: rooms.length,
      },
      series,
      top_rooms: topRooms.map((r) => ({ id: Number(r.id), name: r.name, bookings: Number(r.bookings), minutes: Number(r.minutes) })),
      rooms_live: await liveRooms(rules, now),
      no_checkin: await noCheckinList(rules, now),
    });
  }),
);

/* ---------------- agenda ---------------- */

router.get(
  '/agenda',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ from: date, to: date }), req.query);
    if (q.to < q.from || daysBetween(q.from, q.to) > 31) throw new HttpError(400, 'Período inválido (máx. 31 dias).');
    const rules = await getSettings();
    const now = nowLocal();
    const rows = await db.query(
      `${BOOKING_SELECT} WHERE b.date >= ? AND b.date <= ? AND b.status IN ('pending','confirmed','no_show') ORDER BY b.start_at`,
      [q.from, q.to],
    );
    const blocks = await db.query(
      'SELECT id, room_id, start_at, end_at, reason FROM blocks WHERE start_at < ? AND end_at > ?',
      [`${addDays(q.to, 1)} 00:00`, `${q.from} 00:00`],
    );
    const rooms = (await db.query('SELECT * FROM rooms WHERE active = 1 ORDER BY sort_order, name')).map(presentRoom);
    res.json({
      from: q.from,
      to: q.to,
      step: rules.slot_step_minutes,
      hours: await getBusinessHours(),
      rooms,
      blocks: blocks.map((b) => ({ ...b, id: Number(b.id), room_id: b.room_id == null ? null : Number(b.room_id) })),
      bookings: rows.map((r) => serializeBooking(r, { rules, now, isAdmin: true })),
    });
  }),
);

/* ---------------- reservas ---------------- */

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        from: date.optional(),
        to: date.optional(),
        room_id: id.optional(),
        user_id: id.optional(),
        status: z.enum(['pending', 'confirmed', 'cancelled', 'no_show', 'completed']).optional(),
        payment: z.enum(['none', 'pending', 'paid']).optional(),
        q: z.string().trim().max(80).optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(25),
      }),
      req.query,
    );
    const now = nowLocal();
    const where = ['1=1'];
    const params = [];
    if (q.from) { where.push('b.date >= ?'); params.push(q.from); }
    if (q.to) { where.push('b.date <= ?'); params.push(q.to); }
    if (q.room_id) { where.push('b.room_id = ?'); params.push(q.room_id); }
    if (q.user_id) { where.push('b.user_id = ?'); params.push(q.user_id); }
    if (q.payment) { where.push('b.payment_status = ?'); params.push(q.payment); }
    if (q.status === 'completed') { where.push("b.status = 'confirmed' AND b.end_at < ?"); params.push(now.at); }
    else if (q.status === 'confirmed') { where.push("b.status = 'confirmed' AND b.end_at >= ?"); params.push(now.at); }
    else if (q.status) { where.push('b.status = ?'); params.push(q.status); }
    if (q.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR b.code LIKE ? OR b.title LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }

    const total = await db.get(
      `SELECT COUNT(*) AS n FROM bookings b JOIN users u ON u.id = b.user_id WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await db.query(
      `${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.start_at DESC LIMIT ? OFFSET ?`,
      [...params, q.limit, (q.page - 1) * q.limit],
    );
    const rules = await getSettings();
    res.json({
      total: Number(total.n),
      page: q.page,
      limit: q.limit,
      bookings: rows.map((r) => serializeBooking(r, { rules, now, isAdmin: true })),
    });
  }),
);

router.post(
  '/bookings/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['confirmed', 'no_show']) }), req.body);
    res.json({ booking: await changeStatus({ actor: req.user, id: Number(req.params.id), status }) });
  }),
);

router.post(
  '/bookings/:id/payment',
  asyncHandler(async (req, res) => {
    const { payment_status, method, date: paid_date } = parse(
      z.object({ payment_status: z.enum(['pending', 'paid']), method: z.enum(PAYMENT_METHODS).optional().default('outro'), date: date.optional() }),
      req.body,
    );
    const row = await getBookingRow(Number(req.params.id));
    if (Number(row.price_cents) === 0) throw new HttpError(422, 'Esta reserva não tem valor a cobrar.');
    await db.run(
      'UPDATE bookings SET payment_status = ?, paid_at = ?, payment_method = ?, updated_at = ? WHERE id = ?',
      [payment_status, payment_status === 'paid' ? paidStamp(paid_date) : null, payment_status === 'paid' ? method : null, nowStamp(), row.id],
    );
    res.json({ booking: serializeBooking(await getBookingRow(row.id), { rules: await getSettings(), isAdmin: true }) });
  }),
);

router.post(
  '/bookings/:id/overtime',
  asyncHandler(async (req, res) => {
    const { action } = parse(z.object({ action: z.enum(['waive', 'paid', 'pending']) }), req.body);
    res.json({ booking: await setOvertime({ id: Number(req.params.id), action }) });
  }),
);

/* ---------------- salas ---------------- */

const roomInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome da sala').max(80),
  tagline: z.string().trim().max(160).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  capacity: z.coerce.number().int().min(1).max(500),
  price_cents: z.coerce.number().int().min(0).max(10_000_00),
  image: z.string().trim().max(255).optional().default(''),
  amenities: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  min_minutes: z.coerce.number().int().min(15).max(24 * 60),
  max_minutes: z.coerce.number().int().min(15).max(24 * 60),
  buffer_minutes: z.coerce.number().int().min(0).max(240).optional().default(0),
  active: z.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
}).refine((r) => r.max_minutes >= r.min_minutes, { message: 'A duração máxima não pode ser menor que a mínima.' });

async function uniqueSlug(base, exceptId = null) {
  let slug = slugify(base);
  let n = 1;
  for (;;) {
    const hit = await db.get('SELECT id FROM rooms WHERE slug = ?', [slug]);
    if (!hit || Number(hit.id) === exceptId) return slug;
    slug = `${slugify(base)}-${++n}`;
  }
}

router.get(
  '/rooms',
  asyncHandler(async (_req, res) => {
    const rows = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM bookings b WHERE b.room_id = r.id) AS bookings_count FROM rooms r ORDER BY r.sort_order, r.name`,
    );
    res.json({ rooms: rows.map((r) => ({ ...presentRoom(r), bookings_count: Number(r.bookings_count) })) });
  }),
);

router.post(
  '/rooms',
  asyncHandler(async (req, res) => {
    const d = parse(roomInput, req.body);
    const r = await db.run(
      `INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, buffer_minutes, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, await uniqueSlug(d.name), d.tagline, d.description, d.capacity, d.price_cents, d.image, JSON.stringify(d.amenities), d.min_minutes, d.max_minutes, d.buffer_minutes, d.active ? 1 : 0, d.sort_order, nowStamp()],
    );
    res.status(201).json({ room: presentRoom(await db.get('SELECT * FROM rooms WHERE id = ?', [r.insertId])) });
  }),
);

router.put(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const rid = Number(req.params.id);
    const current = await db.get('SELECT * FROM rooms WHERE id = ?', [rid]);
    if (!current) throw new HttpError(404, 'Sala não encontrada.');
    const d = parse(roomInput, req.body);
    await db.run(
      `UPDATE rooms SET name = ?, slug = ?, tagline = ?, description = ?, capacity = ?, price_cents = ?, image = ?, amenities = ?,
              min_minutes = ?, max_minutes = ?, buffer_minutes = ?, active = ?, sort_order = ? WHERE id = ?`,
      [d.name, await uniqueSlug(d.name, rid), d.tagline, d.description, d.capacity, d.price_cents, d.image, JSON.stringify(d.amenities), d.min_minutes, d.max_minutes, d.buffer_minutes, d.active ? 1 : 0, d.sort_order, rid],
    );
    res.json({ room: presentRoom(await db.get('SELECT * FROM rooms WHERE id = ?', [rid])) });
  }),
);

router.delete(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const rid = Number(req.params.id);
    const used = await db.get('SELECT COUNT(*) AS n FROM bookings WHERE room_id = ?', [rid]);
    if (Number(used.n) > 0) throw new HttpError(409, 'Esta sala tem reservas no histórico. Desative-a em vez de excluir.');
    await db.run('DELETE FROM blocks WHERE room_id = ?', [rid]);
    await db.run('DELETE FROM rooms WHERE id = ?', [rid]);
    res.json({ ok: true });
  }),
);

/* upload de imagem de sala */
fs.mkdirSync(config.uploadsDir, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadsDir),
    filename: (_req, file, cb) => cb(null, `sala-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Envie uma imagem JPG, PNG ou WebP.')),
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Nenhum arquivo enviado.');
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

/* ---------------- clientes ---------------- */

const userInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres').max(100).optional().or(z.literal('')),
  // Acesso ao painel: `profile_id` escolhe o perfil (null = cliente, sem painel). `role: 'admin'` sem perfil = Administrador.
  role: z.enum(['client', 'admin']).optional(),
  profile_id: z.coerce.number().int().positive().nullable().optional(),
  phone: z.string().trim().max(30).optional().default(''),
  document: z.string().trim().max(20).optional().default(''),
  company: z.string().trim().max(120).optional().default(''),
  plan_id: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).optional().default(''),
  active: z.boolean().optional().default(true),
});

const presentUser = (u) => ({
  id: Number(u.id),
  name: u.name,
  email: u.email,
  role: u.role,
  profile_id: u.profile_id == null ? null : Number(u.profile_id),
  profile_name: u.profile_name ?? null,
  phone: u.phone,
  document: u.document,
  company: u.company,
  plan_id: u.plan_id == null ? null : Number(u.plan_id),
  plan_name: u.plan_name ?? null,
  notes: u.notes || '',
  active: Boolean(Number(u.active)),
  last_login_at: u.last_login_at,
  created_at: u.created_at,
  ...(u.bookings_count != null ? { bookings_count: Number(u.bookings_count), next_booking: u.next_booking || null } : {}),
});

const getUserRow = (uid) =>
  db.get(
    `SELECT u.*, p.name AS plan_name, ap.name AS profile_name
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id LEFT JOIN access_profiles ap ON ap.id = u.profile_id WHERE u.id = ?`,
    [uid],
  );

/**
 * Traduz o pedido (profile_id ou role) em { role, profile_id } e confere se quem pede pode mudar o acesso.
 * Só quem edita "Perfis de usuário" altera o acesso de alguém ao painel — editar Clientes não basta.
 */
async function resolveAccess(d, current, actor) {
  let profileId;
  if (d.profile_id !== undefined) profileId = d.profile_id;
  else if (d.role === 'admin') profileId = current?.profile_id ? Number(current.profile_id) : (await adminProfileId());
  else if (d.role === 'client') profileId = null;
  else profileId = current?.profile_id == null ? null : Number(current.profile_id);

  if (profileId && !(await db.get('SELECT id FROM access_profiles WHERE id = ?', [profileId]))) throw new HttpError(400, 'Perfil inválido.');
  const next = { role: profileId ? 'admin' : 'client', profile_id: profileId ?? null };

  const before = { role: current?.role ?? 'client', profile_id: current?.profile_id == null ? null : Number(current.profile_id) };
  if (next.role !== before.role || next.profile_id !== before.profile_id) {
    if (!hasAccess(actor.permissions, 'profiles', 'edit')) throw new HttpError(403, 'Seu perfil não permite alterar o acesso de usuários ao painel.');
    if (current && Number(current.id) === actor.id) throw new HttpError(422, 'Você não pode alterar o seu próprio perfil de acesso.');
  }
  return next;
}

const adminProfileId = async () => Number((await db.get('SELECT id FROM access_profiles WHERE is_system = 1 ORDER BY id LIMIT 1')).id);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(80).optional(),
        role: z.enum(['client', 'admin']).optional(),
        plan_id: id.optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const where = ['1=1'];
    const params = [nowLocal().at];
    if (q.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR u.phone LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    if (q.role) { where.push('u.role = ?'); params.push(q.role); }
    if (q.plan_id) { where.push('u.plan_id = ?'); params.push(q.plan_id); }
    if (q.active) { where.push('u.active = ?'); params.push(q.active === 'true' ? 1 : 0); }

    const rows = await db.query(
      `SELECT u.*, p.name AS plan_name, ap.name AS profile_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status <> 'cancelled') AS bookings_count,
              (SELECT MIN(b.start_at) FROM bookings b WHERE b.user_id = u.id AND b.status IN ('pending','confirmed') AND b.start_at >= ?) AS next_booking
         FROM users u LEFT JOIN plans p ON p.id = u.plan_id LEFT JOIN access_profiles ap ON ap.id = u.profile_id
        WHERE ${where.join(' AND ')} ORDER BY u.name LIMIT 500`,
      params,
    );
    res.json({ users: rows.map(presentUser) });
  }),
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const uid = Number(req.params.id);
    const u = await getUserRow(uid);
    if (!u) throw new HttpError(404, 'Cliente não encontrado.');
    const rules = await getSettings();
    const now = nowLocal();
    const month = req.query.month && /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : now.date.slice(0, 7);
    const history = await db.query(`${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY b.start_at DESC LIMIT 30`, [uid]);
    const life = await db.get(
      `SELECT COUNT(*) AS bookings, COALESCE(SUM(total_minutes), 0) AS minutes, COALESCE(SUM(price_cents + overtime_cents), 0) AS amount,
              COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN price_cents ELSE 0 END + CASE WHEN overtime_payment_status = 'pending' THEN overtime_cents ELSE 0 END), 0) AS pending
         FROM bookings WHERE user_id = ? AND status IN (${inList(CONSUMING)})`,
      [uid],
    );
    res.json({
      user: presentUser(u),
      statement: await monthStatement(uid, month, rules, req.user.id),
      history: history.map((r) => serializeBooking(r, { rules, now, isAdmin: true })),
      lifetime: { bookings: Number(life.bookings), minutes: Number(life.minutes), amount_cents: Number(life.amount), pending_cents: Number(life.pending) },
    });
  }),
);

async function assertPlanExists(planId) {
  if (planId && !(await db.get('SELECT id FROM plans WHERE id = ?', [planId]))) throw new HttpError(400, 'Plano inválido.');
}

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const d = parse(userInput, req.body);
    if (!d.password) throw new HttpError(400, 'Defina uma senha inicial (mín. 8 caracteres).');
    if (await db.get('SELECT id FROM users WHERE email = ?', [d.email])) throw new HttpError(409, 'Já existe um usuário com esse e-mail.');
    await assertPlanExists(d.plan_id);
    const access = await resolveAccess(d, null, req.user);
    const r = await db.run(
      `INSERT INTO users (name, email, password, role, profile_id, phone, document, company, plan_id, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.email, await bcrypt.hash(d.password, 10), access.role, access.profile_id, d.phone, d.document, d.company, d.plan_id ?? null, d.notes, d.active ? 1 : 0, nowStamp(), nowStamp()],
    );
    res.status(201).json({ user: presentUser(await getUserRow(r.insertId)) });
  }),
);

router.put(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const uid = Number(req.params.id);
    const current = await db.get('SELECT * FROM users WHERE id = ?', [uid]);
    if (!current) throw new HttpError(404, 'Cliente não encontrado.');
    const d = parse(userInput, req.body);
    const clash = await db.get('SELECT id FROM users WHERE email = ? AND id <> ?', [d.email, uid]);
    if (clash) throw new HttpError(409, 'Já existe um usuário com esse e-mail.');
    await assertPlanExists(d.plan_id);

    if (uid === req.user.id && !d.active) {
      throw new HttpError(422, 'Você não pode desativar a própria conta.');
    }
    const access = await resolveAccess(d, current, req.user);
    // Quem só edita Clientes não pode tomar a conta de alguém com acesso ao painel (trocar senha ou e-mail).
    if (current.role === 'admin' && uid !== req.user.id && !hasAccess(req.user.permissions, 'profiles', 'edit') && (d.password || d.email !== current.email)) {
      throw new HttpError(403, 'Só quem gerencia perfis de usuário pode alterar o e-mail ou a senha de um usuário do painel.');
    }

    await db.run(
      `UPDATE users SET name = ?, email = ?, role = ?, profile_id = ?, phone = ?, document = ?, company = ?, plan_id = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?`,
      [d.name, d.email, access.role, access.profile_id, d.phone, d.document, d.company, d.plan_id ?? null, d.notes, d.active ? 1 : 0, nowStamp(), uid],
    );
    if (d.password) await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(d.password, 10), uid]);

    res.json({ user: presentUser(await getUserRow(uid)) });
  }),
);

router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const uid = Number(req.params.id);
    if (uid === req.user.id) throw new HttpError(422, 'Você não pode excluir a própria conta.');
    const target = await db.get('SELECT role FROM users WHERE id = ?', [uid]);
    if (target?.role === 'admin' && !hasAccess(req.user.permissions, 'profiles', 'edit')) {
      throw new HttpError(403, 'Só quem gerencia perfis de usuário pode excluir um usuário do painel.');
    }
    const used = await db.get('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?', [uid]);
    if (Number(used.n) > 0) throw new HttpError(409, 'Este cliente tem reservas no histórico. Desative a conta em vez de excluir.');
    await db.run('DELETE FROM users WHERE id = ?', [uid]);
    res.json({ ok: true });
  }),
);

router.post(
  '/users/:id/pay',
  asyncHandler(async (req, res) => {
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
    res.json({ updated: await payInvoice({ userId: Number(req.params.id), month, method: 'outro' }) });
  }),
);

/* ---------------- perfis de usuário (acesso ao painel) ---------------- */

const profileInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome do perfil').max(60),
  description: z.string().trim().max(200).optional().default(''),
  permissions: z.record(z.string(), z.enum(LEVELS)),
});

const presentProfile = (p) => ({
  id: Number(p.id),
  name: p.name,
  description: p.description,
  is_system: Boolean(Number(p.is_system)),
  permissions: normalizePermissions(p.permissions),
  users_count: Number(p.users_count ?? 0),
});

const profileRow = (pid) =>
  db.get('SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.profile_id = p.id) AS users_count FROM access_profiles p WHERE p.id = ?', [pid]);

function parseProfile(body) {
  const d = parse(profileInput, body);
  const permissions = normalizePermissions(d.permissions);
  if (!canEnterPanel(permissions)) throw new HttpError(422, 'Libere ao menos uma área do painel para este perfil.');
  return { ...d, permissions };
}

router.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    const rows = await db.query(
      'SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.profile_id = p.id) AS users_count FROM access_profiles p ORDER BY p.is_system DESC, p.name',
    );
    res.json({ profiles: rows.map(presentProfile), modules: MODULES, levels: LEVELS });
  }),
);

router.post(
  '/profiles',
  asyncHandler(async (req, res) => {
    const d = parseProfile(req.body);
    if (await db.get('SELECT id FROM access_profiles WHERE name = ?', [d.name])) throw new HttpError(409, 'Já existe um perfil com esse nome.');
    const r = await db.run(
      'INSERT INTO access_profiles (name, description, permissions, is_system, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      [d.name, d.description, JSON.stringify(d.permissions), nowStamp(), nowStamp()],
    );
    res.status(201).json({ profile: presentProfile(await profileRow(r.insertId)) });
  }),
);

router.put(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    const current = await profileRow(pid);
    if (!current) throw new HttpError(404, 'Perfil não encontrado.');
    if (Number(current.is_system)) throw new HttpError(403, 'O perfil Administrador é fixo e não pode ser alterado.');
    const d = parseProfile(req.body);
    if (await db.get('SELECT id FROM access_profiles WHERE name = ? AND id <> ?', [d.name, pid])) throw new HttpError(409, 'Já existe um perfil com esse nome.');
    if (req.user.profile_id === pid && d.permissions.profiles !== 'edit') {
      throw new HttpError(422, 'Este é o seu perfil: mantenha "Perfis de usuário" em Editar para não perder o acesso a esta tela.');
    }
    await db.run('UPDATE access_profiles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?', [
      d.name, d.description, JSON.stringify(d.permissions), nowStamp(), pid,
    ]);
    res.json({ profile: presentProfile(await profileRow(pid)) });
  }),
);

router.delete(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    const current = await profileRow(pid);
    if (!current) throw new HttpError(404, 'Perfil não encontrado.');
    if (Number(current.is_system)) throw new HttpError(403, 'O perfil Administrador é fixo e não pode ser excluído.');
    if (Number(current.users_count) > 0) throw new HttpError(409, 'Há usuários com este perfil. Mude o perfil deles antes de excluir.');
    await db.run('DELETE FROM access_profiles WHERE id = ?', [pid]);
    res.json({ ok: true });
  }),
);

/** Todos os usuários (clientes e equipe) com o perfil de acesso de cada um. */
router.get(
  '/profiles-users',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), profile_id: z.string().max(10).optional() }), req.query);
    const where = ['u.active = 1'];
    const params = [];
    if (q.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`);
    }
    if (q.profile_id === 'none') where.push('u.profile_id IS NULL');
    else if (q.profile_id && /^\d+$/.test(q.profile_id)) { where.push('u.profile_id = ?'); params.push(Number(q.profile_id)); }
    const rows = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.profile_id, u.last_login_at, ap.name AS profile_name
         FROM users u LEFT JOIN access_profiles ap ON ap.id = u.profile_id
        WHERE ${where.join(' AND ')} ORDER BY (u.profile_id IS NULL), u.name LIMIT 500`,
      params,
    );
    res.json({
      users: rows.map((u) => ({
        id: Number(u.id), name: u.name, email: u.email, role: u.role, last_login_at: u.last_login_at,
        profile_id: u.profile_id == null ? null : Number(u.profile_id), profile_name: u.profile_name ?? null,
      })),
    });
  }),
);

router.put(
  '/profiles-users/:id',
  asyncHandler(async (req, res) => {
    const uid = Number(req.params.id);
    const { profile_id } = parse(z.object({ profile_id: z.coerce.number().int().positive().nullable() }), req.body);
    const current = await db.get('SELECT id, role, profile_id FROM users WHERE id = ?', [uid]);
    if (!current) throw new HttpError(404, 'Usuário não encontrado.');
    const access = await resolveAccess({ profile_id }, current, req.user);
    await db.run('UPDATE users SET role = ?, profile_id = ?, updated_at = ? WHERE id = ?', [access.role, access.profile_id, nowStamp(), uid]);
    const u = await db.get(
      'SELECT u.id, u.name, u.email, u.role, u.profile_id, u.last_login_at, ap.name AS profile_name FROM users u LEFT JOIN access_profiles ap ON ap.id = u.profile_id WHERE u.id = ?',
      [uid],
    );
    res.json({
      user: {
        id: Number(u.id), name: u.name, email: u.email, role: u.role, last_login_at: u.last_login_at,
        profile_id: u.profile_id == null ? null : Number(u.profile_id), profile_name: u.profile_name ?? null,
      },
    });
  }),
);

/* ---------------- planos ---------------- */

const planInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome do plano').max(80),
  description: z.string().trim().max(255).optional().default(''),
  included_minutes: z.coerce.number().int().min(0).max(100_000).optional().default(0),
  unlimited: z.boolean().optional().default(false),
  room_discount_percent: z.coerce.number().int().min(0).max(100).optional().default(0),
  price_cents: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
  active: z.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
});

const presentPlan = (p) => ({
  id: Number(p.id),
  name: p.name,
  description: p.description,
  included_minutes: Number(p.included_minutes),
  unlimited: Boolean(Number(p.unlimited)),
  room_discount_percent: Number(p.room_discount_percent),
  price_cents: Number(p.price_cents),
  active: Boolean(Number(p.active)),
  sort_order: Number(p.sort_order),
  ...(p.users_count != null ? { users_count: Number(p.users_count) } : {}),
});

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const rows = await db.query('SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.plan_id = p.id) AS users_count FROM plans p ORDER BY p.sort_order, p.name');
    res.json({ plans: rows.map(presentPlan) });
  }),
);

router.post(
  '/plans',
  asyncHandler(async (req, res) => {
    const d = parse(planInput, req.body);
    const r = await db.run(
      'INSERT INTO plans (name, description, included_minutes, unlimited, room_discount_percent, price_cents, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [d.name, d.description, d.included_minutes, d.unlimited ? 1 : 0, d.room_discount_percent, d.price_cents, d.active ? 1 : 0, d.sort_order],
    );
    res.status(201).json({ plan: presentPlan(await db.get('SELECT * FROM plans WHERE id = ?', [r.insertId])) });
  }),
);

router.put(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    if (!(await db.get('SELECT id FROM plans WHERE id = ?', [pid]))) throw new HttpError(404, 'Plano não encontrado.');
    const d = parse(planInput, req.body);
    await db.run(
      'UPDATE plans SET name = ?, description = ?, included_minutes = ?, unlimited = ?, room_discount_percent = ?, price_cents = ?, active = ?, sort_order = ? WHERE id = ?',
      [d.name, d.description, d.included_minutes, d.unlimited ? 1 : 0, d.room_discount_percent, d.price_cents, d.active ? 1 : 0, d.sort_order, pid],
    );
    res.json({ plan: presentPlan(await db.get('SELECT * FROM plans WHERE id = ?', [pid])) });
  }),
);

router.delete(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    const used = await db.get('SELECT COUNT(*) AS n FROM users WHERE plan_id = ?', [pid]);
    if (Number(used.n) > 0) throw new HttpError(409, 'Há clientes neste plano. Mova-os para outro plano ou desative este.');
    await db.run('DELETE FROM plans WHERE id = ?', [pid]);
    res.json({ ok: true });
  }),
);

/* ---------------- bloqueios ---------------- */

router.get(
  '/blocks',
  asyncHandler(async (_req, res) => {
    const from = `${addDays(nowLocal().date, -30)} 00:00`;
    const rows = await db.query(
      `SELECT k.*, r.name AS room_name FROM blocks k LEFT JOIN rooms r ON r.id = k.room_id WHERE k.end_at >= ? ORDER BY k.start_at`,
      [from],
    );
    res.json({
      blocks: rows.map((b) => ({ id: Number(b.id), room_id: b.room_id == null ? null : Number(b.room_id), room_name: b.room_name, start_at: b.start_at, end_at: b.end_at, reason: b.reason })),
    });
  }),
);

router.post(
  '/blocks',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        room_id: z.coerce.number().int().positive().nullable().optional(),
        start_date: date,
        start_time: time,
        end_date: date,
        end_time: time,
        reason: z.string().trim().max(200).optional().default(''),
        force: z.boolean().optional().default(false),
      }),
      req.body,
    );
    const startAt = `${d.start_date} ${d.start_time}`;
    const endAt = `${d.end_date} ${d.end_time}`;
    if (endAt <= startAt) throw new HttpError(422, 'O fim do bloqueio precisa ser depois do início.');

    const affected = await db.query(
      `SELECT b.code, b.date, b.start_time FROM bookings b
        WHERE b.status IN (${inList(OCCUPYING)}) AND b.start_at < ? AND b.end_at > ?${d.room_id ? ' AND b.room_id = ?' : ''}`,
      d.room_id ? [endAt, startAt, d.room_id] : [endAt, startAt],
    );
    if (affected.length && !d.force) {
      throw new HttpError(409, `Existem ${affected.length} reserva(s) nesse período. Elas não serão canceladas automaticamente.`, {
        code: 'HAS_BOOKINGS',
        count: affected.length,
      });
    }
    const r = await db.run(
      'INSERT INTO blocks (room_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [d.room_id ?? null, startAt, endAt, d.reason, req.user.id, nowStamp()],
    );
    res.status(201).json({ id: r.insertId, affected: affected.length });
  }),
);

router.delete(
  '/blocks/:id',
  asyncHandler(async (req, res) => {
    await db.run('DELETE FROM blocks WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  }),
);

/* ---------------- configurações ---------------- */

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings(), hours: await getBusinessHours() });
  }),
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        business_name: z.string().trim().min(1).max(80),
        business_address: z.string().trim().max(200),
        business_phone: z.string().trim().max(30),
        business_whatsapp: z.string().trim().max(20),
        business_email: z.string().trim().max(160),
        slot_step_minutes: z.coerce.number().int().refine((n) => [15, 30, 60].includes(n), 'Intervalo deve ser 15, 30 ou 60 minutos'),
        min_notice_minutes: z.coerce.number().int().min(0).max(7 * 24 * 60),
        max_advance_days: z.coerce.number().int().min(1).max(365),
        cancel_min_hours: z.coerce.number().int().min(0).max(168),
        max_upcoming_bookings: z.coerce.number().int().min(0).max(500),
        max_recurrence_weeks: z.coerce.number().int().min(0).max(52),
        require_approval: z.boolean(),
        allow_signup: z.boolean(),
        notice_message: z.string().trim().max(300),
        usage_policy: z.string().trim().max(2000).default(''),
        invoice_due_day: z.coerce.number().int().min(1).max(28),
        pay_on_booking: z.boolean().default(false),
        booking_hold_minutes: z.coerce.number().int().min(5).max(60).default(15),
        pagarme_enabled: z.boolean().default(false),
        pagarme_methods: z.string().trim().max(60).default('pix,credit_card,boleto').refine(
          (v) => v.split(',').filter(Boolean).length > 0 && v.split(',').every((m) => ['pix', 'credit_card', 'boleto'].includes(m)),
          'Escolha ao menos uma forma de pagamento.',
        ),
        pagarme_expires_minutes: z.coerce.number().int().min(30).max(10080).default(1440),
        pagarme_max_installments: z.coerce.number().int().min(1).max(12).default(1),
        checkin_window_minutes: z.coerce.number().int().min(0).max(240),
        overtime_grace_minutes: z.coerce.number().int().min(0).max(120),
        overtime_charge: z.boolean(),
        auto_close_minutes: z.coerce.number().int().min(30).max(24 * 60),
      }),
      req.body,
    );
    res.json({ settings: await saveSettings(d) });
  }),
);

router.put(
  '/hours',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.array(z.object({ weekday: z.coerce.number().int().min(0).max(6), is_open: z.boolean(), open_time: time, close_time: time })).length(7),
      req.body,
    );
    for (const h of d) {
      if (h.is_open && toMin(h.close_time) <= toMin(h.open_time)) {
        throw new HttpError(422, 'O horário de fechamento precisa ser depois da abertura.');
      }
    }
    for (const h of d) {
      await db.run('UPDATE business_hours SET is_open = ?, open_time = ?, close_time = ? WHERE weekday = ?', [h.is_open ? 1 : 0, h.open_time, h.close_time, h.weekday]);
    }
    res.json({ hours: await getBusinessHours() });
  }),
);

/* ---------------- modelos de e-mail ---------------- */

const templateBody = z.object({
  subject: z.string().trim().min(1, 'Informe o assunto').max(FIELD_LIMITS.subject),
  title: z.string().trim().min(1, 'Informe o título').max(FIELD_LIMITS.title),
  body: z.string().trim().min(1, 'Escreva o texto do e-mail').max(FIELD_LIMITS.body),
  cta_label: z.string().trim().max(FIELD_LIMITS.cta_label).default(''),
  enabled: z.boolean().default(true),
});

router.get(
  '/email-templates',
  asyncHandler(async (_req, res) => {
    res.json({ templates: await listEmailTemplates(), smtp_configured: Boolean(config.mail.host && config.mail.user), notify_email: config.mail.notify });
  }),
);

router.put(
  '/email-templates/:key',
  asyncHandler(async (req, res) => {
    res.json({ template: await saveEmailTemplate(req.params.key, parse(templateBody, req.body)) });
  }),
);

/** Volta ao texto padrão do sistema. */
router.delete(
  '/email-templates/:key',
  asyncHandler(async (req, res) => {
    res.json({ template: await resetEmailTemplate(req.params.key) });
  }),
);

/** Prévia com dados de exemplo, usando o texto que está sendo editado (ainda sem salvar). */
router.post(
  '/email-templates/:key/preview',
  asyncHandler(async (req, res) => {
    const def = getDefinition(req.params.key);
    const draft = parse(templateBody.omit({ enabled: true }), req.body);
    const mail = await renderEmail(def.key, { ...sampleData(def.key), draft });
    res.json({ subject: mail.subject, html: mail.html });
  }),
);

/** Manda o e-mail de exemplo para o próprio administrador que está logado. */
router.post(
  '/email-templates/:key/test',
  asyncHandler(async (req, res) => {
    const def = getDefinition(req.params.key);
    const me = await db.get('SELECT name, email FROM users WHERE id = ?', [req.user.id]);
    const draft = parse(templateBody.omit({ enabled: true }), req.body);
    const mail = await renderEmail(def.key, { ...sampleData(def.key, me), draft });
    const result = await sendMail({ to: me.email, subject: `[TESTE] ${mail.subject}`, html: mail.html, text: mail.text });
    if (result.skipped) throw new HttpError(409, 'O envio de e-mails (SMTP) ainda não está configurado neste servidor.');
    if (!result.success) throw new HttpError(502, 'O servidor de e-mail recusou o envio. Confira as credenciais de SMTP.');
    res.json({ message: `E-mail de teste enviado para ${me.email}.` });
  }),
);

/* ---------------- relatórios ---------------- */

async function reportRows(from, to) {
  return db.query(
    `${BOOKING_SELECT} WHERE b.date >= ? AND b.date <= ? ORDER BY b.start_at`,
    [from, to],
  );
}

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const now = nowLocal();
    const q = parse(z.object({ from: date.optional(), to: date.optional() }), req.query);
    const from = q.from ?? `${now.date.slice(0, 7)}-01`;
    const to = q.to ?? now.date;
    if (to < from || daysBetween(from, to) > 400) throw new HttpError(400, 'Período inválido.');

    const rows = await reportRows(from, to);
    const hoursList = await getBusinessHours();
    const rooms = await db.query('SELECT id, name FROM rooms WHERE active = 1 ORDER BY sort_order, name');

    let openMinutes = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const h = hoursList.find((x) => x.weekday === weekdayOf(d));
      if (h?.is_open) openMinutes += toMin(h.close_time) - toMin(h.open_time);
    }

    const counted = rows.filter((r) => CONSUMING.includes(r.status));
    const totals = {
      bookings: counted.length,
      cancelled: rows.filter((r) => r.status === 'cancelled').length,
      no_show: rows.filter((r) => r.status === 'no_show').length,
      minutes: counted.reduce((a, r) => a + Number(r.total_minutes), 0),
      revenue_cents: counted.reduce((a, r) => a + Number(r.price_cents), 0),
      paid_cents: counted.reduce((a, r) => a + (r.payment_status === 'paid' ? Number(r.price_cents) : 0), 0),
      included_minutes: counted.reduce((a, r) => a + Number(r.included_minutes), 0),
      occupancy: rooms.length && openMinutes ? counted.reduce((a, r) => a + Number(r.total_minutes), 0) / (openMinutes * rooms.length) : 0,
    };

    // Capacidade de cada "célula" (dia da semana x hora): quantos minutos o espaço esteve aberto naquele dia/hora no período.
    const HOUR_FROM = 6;
    const HOUR_COUNT = 18; // 6h … 23h
    const matrix = () => Array.from({ length: 7 }, () => Array(HOUR_COUNT).fill(0));
    const capacity = matrix();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const h = hoursList.find((x) => x.weekday === weekdayOf(d));
      if (!h?.is_open) continue;
      const open = toMin(h.open_time);
      const close = toMin(h.close_time);
      for (let i = 0; i < HOUR_COUNT; i++) {
        const start = (HOUR_FROM + i) * 60;
        capacity[weekdayOf(d)][i] += Math.max(0, Math.min(close, start + 60) - Math.max(open, start));
      }
    }

    const byRoom = rooms.map((room) => {
      const rs = counted.filter((r) => Number(r.room_id) === Number(room.id));
      const minutes = rs.reduce((a, r) => a + Number(r.total_minutes), 0);

      const heat = matrix();
      const weekdayStats = Array.from({ length: 7 }, (_, weekday) => ({ weekday, bookings: 0, minutes: 0 }));
      const hourBookings = Array(HOUR_COUNT).fill(0);
      for (const r of rs) {
        const w = weekdayOf(r.date);
        weekdayStats[w].bookings += 1;
        weekdayStats[w].minutes += Number(r.total_minutes);
        const touched = new Set();
        for (let m = toMin(r.start_time); m < toMin(r.end_time); m += 30) {
          const i = Math.floor(m / 60) - HOUR_FROM;
          if (i < 0 || i >= HOUR_COUNT) continue;
          heat[w][i] += 30;
          touched.add(i);
        }
        for (const i of touched) hourBookings[i] += 1; // reservas que passam por essa hora
      }

      return {
        id: Number(room.id),
        name: room.name,
        bookings: rs.length,
        minutes,
        revenue_cents: rs.reduce((a, r) => a + Number(r.price_cents), 0),
        occupancy: openMinutes ? minutes / openMinutes : 0,
        by_weekday: weekdayStats.map((w) => ({ ...w, capacity_minutes: capacity[w.weekday].reduce((a, v) => a + v, 0) })),
        by_hour: Array.from({ length: HOUR_COUNT }, (_, i) => ({
          hour: HOUR_FROM + i,
          bookings: hourBookings[i],
          minutes: heat.reduce((a, row) => a + row[i], 0),
          capacity_minutes: capacity.reduce((a, row) => a + row[i], 0),
        })),
        heat,
      };
    });

    const clientMap = new Map();
    for (const r of counted) {
      const c = clientMap.get(r.user_id) ?? { id: Number(r.user_id), name: r.user_name, bookings: 0, minutes: 0, revenue_cents: 0 };
      c.bookings += 1;
      c.minutes += Number(r.total_minutes);
      c.revenue_cents += Number(r.price_cents);
      clientMap.set(r.user_id, c);
    }

    const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, bookings: 0, minutes: 0 }));
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0 }));
    for (const r of counted) {
      const w = byWeekday[weekdayOf(r.date)];
      w.bookings += 1;
      w.minutes += Number(r.total_minutes);
      for (let m = toMin(r.start_time); m < toMin(r.end_time); m += 30) byHour[Math.floor(m / 60)].minutes += 30;
    }

    res.json({
      from,
      to,
      totals,
      by_room: byRoom,
      heat_capacity: { hour_from: HOUR_FROM, matrix: capacity },
      by_client: [...clientMap.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 15),
      by_weekday: byWeekday,
      by_hour: byHour.filter((h) => h.hour >= 6 && h.hour <= 22),
    });
  }),
);

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula no Excel
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const now = nowLocal();
    const q = parse(z.object({ from: date.optional(), to: date.optional() }), req.query);
    const from = q.from ?? `${now.date.slice(0, 7)}-01`;
    const to = q.to ?? now.date;
    const rows = await reportRows(from, to);
    const statusLabel = { pending: 'Pendente', confirmed: 'Confirmada', cancelled: 'Cancelada', no_show: 'Não compareceu' };
    const payLabel = { none: 'Sem cobrança', pending: 'A pagar', paid: 'Pago' };
    const header = ['Código', 'Data', 'Início', 'Fim', 'Sala', 'Cliente', 'E-mail', 'Status', 'Horas', 'Horas incluídas', 'Valor', 'Pagamento'];
    const lines = [header, ...rows.map((r) => [
      r.code, r.date.split('-').reverse().join('/'), r.start_time, r.end_time, r.room_name, r.user_name, r.user_email,
      statusLabel[r.status] ?? r.status, (Number(r.total_minutes) / 60).toFixed(2).replace('.', ','),
      (Number(r.included_minutes) / 60).toFixed(2).replace('.', ','), formatBRL(Number(r.price_cents)).replace(/ /g, ' '), payLabel[r.payment_status] ?? r.payment_status,
    ])];
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservas-${from}_${to}.csv"`,
    });
    res.send(`﻿${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}`);
  }),
);

export default router;
