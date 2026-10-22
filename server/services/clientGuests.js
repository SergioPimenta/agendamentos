import { z } from 'zod';
import { db } from '../db/index.js';
import { DATE_RE, isValidDate, nowStamp } from '../utils/time.js';
import { parseGuestList } from '../utils/guests.js';

/**
 * Convidados dos clientes: quem foi convidado, por qual cliente (e pessoa anfitriã), para qual reserva e quando.
 * Vem do relatório do sistema anterior (importação) e, daqui em diante, é gravado a cada reserva com convidados.
 */

export const UNIT = 'Coworking Harmonize o Ser';
export const MAX_GUEST_ROWS = 300;

export const presentGuest = (g) => ({
  id: Number(g.id),
  user_id: g.user_id == null ? null : Number(g.user_id),
  client_code: g.client_code ?? '',
  client_name: g.client_name ?? '',
  host_name: g.host_name ?? '',
  name: g.name ?? '',
  email: g.email,
  unit: g.unit ?? '',
  invite_date: g.invite_date ?? '',
  invite_start: g.invite_start ?? '',
  invite_end: g.invite_end ?? '',
  linked: Boolean(Number(g.linked)),
  booking_id: g.booking_id == null ? null : Number(g.booking_id),
  legacy_id: g.legacy_id ?? '',
  created_at: g.created_at,
});

export async function listGuests({ q, userId, page, perPage }) {
  const where = ['1=1'];
  const params = [];
  if (q) {
    where.push('(g.name LIKE ? OR g.email LIKE ? OR g.client_name LIKE ? OR g.host_name LIKE ? OR g.client_code = ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, q);
  }
  if (userId) { where.push('g.user_id = ?'); params.push(userId); }
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM client_guests g WHERE ${where.join(' AND ')}`, params)).n);
  const rows = await db.query(
    `SELECT g.* FROM client_guests g WHERE ${where.join(' AND ')}
      ORDER BY g.invite_date DESC, g.id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params,
  );
  return { guests: rows.map(presentGuest), total };
}

/**
 * Grava os convidados de uma reserva na seção Convidados (um registro por reserva e e-mail). Chamar depois de criar
 * ou alterar a reserva: atualiza data/horário e nome de quem já estava, inclui os novos e desvincula quem saiu da lista.
 */
export async function recordBookingGuests(bookingId, conn = db) {
  const b = await conn.get(
    `SELECT b.id, b.user_id, b.date, b.start_time, b.end_time, b.guests, u.name AS user_name, u.legacy_code
       FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?`,
    [bookingId],
  );
  if (!b) return;
  const list = parseGuestList(b.guests);
  const host = (await conn.get('SELECT name FROM client_people WHERE user_id = ? AND is_primary = 1', [b.user_id]))?.name || b.user_name;
  const saved = await conn.query('SELECT id, email FROM client_guests WHERE booking_id = ?', [bookingId]);
  const byEmail = new Map(saved.map((r) => [r.email, Number(r.id)]));

  for (const g of list) {
    const id = byEmail.get(g.email);
    if (id) {
      await conn.run(
        `UPDATE client_guests SET name = CASE WHEN ? <> '' THEN ? ELSE name END, host_name = ?, client_name = ?, invite_date = ?, invite_start = ?, invite_end = ?, linked = 1 WHERE id = ?`,
        [g.name, g.name, host, b.user_name, b.date, b.start_time, b.end_time, id],
      );
    } else {
      await conn.run(
        `INSERT INTO client_guests (user_id, client_code, client_name, host_name, name, email, unit, invite_date, invite_start, invite_end, linked, booking_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [b.user_id, b.legacy_code ?? null, b.user_name, host, g.name, g.email, UNIT, b.date, b.start_time, b.end_time, bookingId, nowStamp()],
      );
    }
  }
  const keep = new Set(list.map((g) => g.email));
  for (const [email, id] of byEmail) if (!keep.has(email)) await conn.run('UPDATE client_guests SET linked = 0 WHERE id = ?', [id]);
}

/* ---------------- importação ---------------- */

const row = z.object({
  codigo: z.string().trim().max(20).optional().default(''),
  unidade: z.string().trim().max(80).optional().default(''),
  codigo_cliente: z.string().trim().max(20).optional().default(''),
  cliente: z.string().trim().max(120).optional().default(''),
  anfitriao: z.string().trim().max(120).optional().default(''),
  nome: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
  data_convite: z.union([z.literal(''), z.string().regex(DATE_RE).refine(isValidDate)]).optional().default(''),
  inicio: z.string().trim().max(5).optional().default(''),
  fim: z.string().trim().max(5).optional().default(''),
  vinculado: z.string().trim().optional().default('Sim'),
  cadastro: z.string().trim().max(19).optional().default(''),
});

/** Importa convidados de outro sistema. Quem já foi importado (mesmo código) é pulado, então dá para repetir. */
export async function importGuests({ rows, dryRun = false }) {
  const out = { dry_run: dryRun, total: rows.length, created: 0, skipped: [], errors: [] };
  const seen = new Set();
  const toInsert = [];
  for (const [line, raw] of rows.entries()) {
    const label = String(raw?.nome ?? raw?.email ?? '');
    const parsed = row.safeParse(Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])));
    if (!parsed.success) { out.errors.push({ line, name: label, reason: parsed.error.issues[0].message }); continue; }
    const r = parsed.data;
    const dup = r.codigo && (seen.has(r.codigo) || (await db.get('SELECT id FROM client_guests WHERE legacy_id = ?', [r.codigo])));
    if (dup) { out.skipped.push({ line, name: r.nome || r.email, reason: 'Já importado.' }); continue; }
    if (r.codigo) seen.add(r.codigo);
    toInsert.push(r);
    out.created += 1;
  }
  if (dryRun || !toInsert.length) return out;

  await db.transaction(async (tx) => {
    for (const r of toInsert) {
      const user = r.codigo_cliente ? await tx.get('SELECT id FROM users WHERE legacy_code = ?', [r.codigo_cliente]) : null;
      await tx.run(
        `INSERT INTO client_guests (user_id, client_code, client_name, host_name, name, email, unit, invite_date, invite_start, invite_end, linked, booking_id, legacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          user ? user.id : null, r.codigo_cliente || null, r.cliente, r.anfitriao, r.nome, r.email, r.unidade || UNIT,
          r.data_convite || null, r.inicio, r.fim, /^n/i.test(r.vinculado) ? 0 : 1, r.codigo || null, r.cadastro || nowStamp(),
        ],
      );
    }
  });
  return out;
}
