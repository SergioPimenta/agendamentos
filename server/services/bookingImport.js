import { z } from 'zod';
import { db } from '../db/index.js';
import { DATE_RE, TIME_RE, isValidDate, nowLocal, nowStamp, toMin } from '../utils/time.js';

/**
 * Importa reservas do sistema anterior (já lidas do relatório). Cada linha vira uma reserva de verdade, com o horário,
 * a sala, o cliente (pelo código antigo) e a cobrança. Não aplica as regras de agendamento (horário de funcionamento,
 * antecedência, conflito): o que já aconteceu ou já foi combinado lá precisa constar aqui como está.
 */

export const MAX_BOOKING_ROWS = 300;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/^sala\s+/, '').replace(/\s+/g, ' ').trim();

const row = z.object({
  codigo: z.string().trim().min(1, 'Sem número da reserva').max(20),
  cadastrado_por: z.string().trim().max(120).optional().default(''),
  codigo_cliente: z.string().trim().min(1, 'Sem código do cliente').max(20),
  cliente: z.string().trim().max(120).optional().default(''),
  pessoa: z.string().trim().max(120).optional().default(''),
  sala: z.string().trim().min(1, 'Sem sala').max(120),
  data: z.string().regex(DATE_RE, 'Data inválida').refine(isValidDate, 'Data inválida'),
  inicio: z.string().regex(TIME_RE, 'Horário de início inválido'),
  fim: z.string().regex(TIME_RE, 'Horário de término inválido'),
  valor_centavos: z.coerce.number().int().min(0).optional().default(0),
  origem: z.string().trim().max(60).optional().default(''),
  obs: z.string().trim().max(500).optional().default(''),
  status: z.string().trim().optional().default('Ativa'),
  cobranca: z.string().trim().optional().default(''),
});

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Cobrança do sistema anterior → situação aqui. */
function billing(cobranca, cancelled, cents, minutes) {
  if (cancelled) return { payment: 'none', price: 0, included: 0, note: '' };
  const c = norm(cobranca);
  if (c.includes('cota')) return { payment: 'none', price: 0, included: minutes, note: `Descontada da cota do cliente (valor de tabela ${brl(cents)}).` };
  if (cents === 0) return { payment: 'none', price: 0, included: 0, note: '' };
  if (c.startsWith('quitada parcial')) return { payment: 'pending', price: cents, included: 0, note: 'Quitada parcialmente no sistema anterior.' };
  if (c.startsWith('quitada')) return { payment: 'paid', price: cents, included: 0, note: '' };
  return { payment: 'pending', price: cents, included: 0, note: '' };
}

export async function importBookings({ rows, dryRun = false, actorId = null }) {
  const out = { dry_run: dryRun, total: rows.length, created: 0, skipped: [], errors: [], missing_rooms: {}, missing_clients: {} };

  const rooms = await db.query('SELECT id, name FROM rooms');
  const roomByKey = new Map();
  for (const r of rooms) roomByKey.set(norm(r.name), Number(r.id));
  const findRoom = (name) => {
    const key = norm(name);
    if (roomByKey.has(key)) return roomByKey.get(key);
    const first = key.split(' - ')[0]; // "Oceano - Salão de Festas" → "oceano"
    return first !== key ? roomByKey.get(first) ?? [...roomByKey].find(([k]) => k.split(' - ')[0] === first)?.[1] : undefined;
  };

  const clients = new Map();
  const clientId = async (code) => {
    if (!clients.has(code)) clients.set(code, (await db.get('SELECT id FROM users WHERE legacy_code = ?', [code]))?.id ?? null);
    return clients.get(code);
  };

  const seen = new Set();
  const toInsert = [];
  for (const [line, raw] of rows.entries()) {
    const label = `${raw?.cliente ?? ''} · ${raw?.sala ?? ''} ${raw?.data ?? ''} ${raw?.inicio ?? ''}`.trim();
    const parsed = row.safeParse(Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])));
    if (!parsed.success) { out.errors.push({ line, name: label, reason: parsed.error.issues[0].message }); continue; }
    const r = parsed.data;
    if (toMin(r.fim) <= toMin(r.inicio)) { out.errors.push({ line, name: label, reason: 'O término precisa ser depois do início.' }); continue; }
    if (seen.has(r.codigo) || (await db.get('SELECT id FROM bookings WHERE legacy_id = ?', [r.codigo]))) {
      out.skipped.push({ line, name: label, reason: 'Já importada.' });
      continue;
    }
    const roomId = findRoom(r.sala);
    if (!roomId) {
      out.missing_rooms[r.sala] = (out.missing_rooms[r.sala] ?? 0) + 1;
      out.errors.push({ line, name: label, reason: `Sala "${r.sala}" não cadastrada.` });
      continue;
    }
    const userId = await clientId(r.codigo_cliente);
    if (!userId) {
      const key = `${r.codigo_cliente} - ${r.cliente}`;
      out.missing_clients[key] = (out.missing_clients[key] ?? 0) + 1;
      out.errors.push({ line, name: label, reason: `Cliente nº ${r.codigo_cliente} não cadastrado.` });
      continue;
    }
    seen.add(r.codigo);
    toInsert.push({ ...r, roomId, userId });
    out.created += 1;
  }
  if (dryRun || !toInsert.length) return out;

  const today = nowLocal().date;
  const stamp = nowStamp();
  await db.transaction(async (tx) => {
    for (const r of toInsert) {
      const cancelled = /^cancel/i.test(r.status);
      const minutes = toMin(r.fim) - toMin(r.inicio);
      const b = billing(r.cobranca, cancelled, r.valor_centavos, minutes);
      const series = /recorrente\s*\((\d+)\)/i.exec(r.origem)?.[1];
      const notes = [r.obs, b.note, `Reserva nº ${r.codigo} do sistema anterior${r.cadastrado_por ? `, cadastrada por ${r.cadastrado_por}` : ''}.`].filter(Boolean).join(' ');
      const paidAt = b.payment === 'paid' ? `${r.data < today ? r.data : today} 12:00:00` : null;
      await tx.run(
        `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees, total_minutes, included_minutes,
                               price_cents, payment_status, paid_at, payment_method, series_id, created_by, cancelled_at, cancel_reason, created_at, updated_at, legacy_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `L${r.codigo}`, r.roomId, r.userId, r.data, r.inicio, r.fim, `${r.data} ${r.inicio}`, `${r.data} ${r.fim}`,
          cancelled ? 'cancelled' : 'confirmed', notes, minutes, b.included, b.price, b.payment, paidAt, paidAt ? 'outro' : null,
          series ? `L${series}` : null, actorId, cancelled ? stamp : null, cancelled ? 'Cancelada no sistema anterior' : null, stamp, stamp, r.codigo,
        ],
      );
    }
  });
  return out;
}
