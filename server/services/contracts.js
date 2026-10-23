import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { DATE_RE, addDays, isValidDate, nowLocal, nowStamp } from '../utils/time.js';

/**
 * Contratos dos clientes. Por enquanto é só cadastro: guarda o que foi combinado (tipo, período, valor, vencimento,
 * fidelidade, reajuste) e não gera cobranças. O cliente continua com o plano que já tem; o contrato registra o acordo.
 */

export const PERIODS = ['Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'];
export const MAX_CONTRACT_ROWS = 100;

const optDate = z.union([z.literal(''), z.string().regex(DATE_RE, 'Data inválida').refine(isValidDate, 'Data inválida')]).optional().default('').transform((v) => v || null);

export const contractSchema = z.object({
  kind: z.string().trim().min(2, 'Informe o tipo do contrato').max(80),
  unit: z.string().trim().max(80).optional().default(''),
  period: z.enum(PERIODS).optional().default('Mensal'),
  signed_at: optDate,
  start_date: z.string().regex(DATE_RE, 'Informe o início do contrato').refine(isValidDate, 'Data de início inválida'),
  end_date: optDate,
  fidelity_until: optDate,
  amount_cents: z.coerce.number().int().min(0).max(100_000_000).optional().default(0),
  due_day: z.union([z.literal(''), z.coerce.number().int().min(1).max(31)]).nullable().optional().transform((v) => (v === '' || v == null ? null : v)),
  private_office: z.string().trim().max(80).optional().default(''),
  created_by_name: z.string().trim().max(120).optional().default(''),
  last_adjustment: optDate,
  adjustment_index: z.string().trim().max(20).optional().default(''),
  active: z.boolean().optional().default(true),
  notes: z.string().trim().max(1000).optional().default(''),
}).refine((c) => !c.end_date || c.end_date >= c.start_date, { message: 'O fim não pode ser antes do início', path: ['end_date'] });

/** Situação calculada: encerrado (inativo ou já passou do fim), vencendo (fim nos próximos 30 dias) ou vigente. */
export function contractStatus(c, today = nowLocal().date) {
  if (!Number(c.active)) return 'inactive';
  if (c.end_date && c.end_date < today) return 'ended';
  if (c.end_date && c.end_date <= addDays(today, 30)) return 'ending';
  return 'active';
}

export const presentContract = (c) => ({
  id: Number(c.id),
  user_id: Number(c.user_id),
  client_name: c.client_name ?? '',
  client_code: c.client_code ?? '',
  kind: c.kind,
  unit: c.unit ?? '',
  period: c.period,
  signed_at: c.signed_at ?? '',
  start_date: c.start_date,
  end_date: c.end_date ?? '',
  fidelity_until: c.fidelity_until ?? '',
  amount_cents: Number(c.amount_cents),
  due_day: c.due_day == null ? null : Number(c.due_day),
  private_office: c.private_office ?? '',
  created_by_name: c.created_by_name ?? '',
  last_adjustment: c.last_adjustment ?? '',
  adjustment_index: c.adjustment_index ?? '',
  active: Boolean(Number(c.active)),
  notes: c.notes ?? '',
  status: contractStatus(c),
  created_at: c.created_at,
});

const SELECT = `SELECT c.*, u.name AS client_name, u.legacy_code AS client_code FROM contracts c JOIN users u ON u.id = c.user_id`;

export const getContract = (id) => db.get(`${SELECT} WHERE c.id = ?`, [id]);

export async function contractsOf(userId) {
  return (await db.query(`${SELECT} WHERE c.user_id = ? ORDER BY c.active DESC, c.start_date DESC, c.id DESC`, [userId])).map(presentContract);
}

export async function listContracts({ q, status, kind, page, perPage }) {
  const where = ['1=1'];
  const params = [];
  if (q) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR c.kind LIKE ? OR u.legacy_code = ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, q);
  }
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  const today = nowLocal().date;
  if (status === 'active') { where.push('c.active = 1 AND (c.end_date IS NULL OR c.end_date >= ?)'); params.push(today); }
  if (status === 'ending') { where.push('c.active = 1 AND c.end_date IS NOT NULL AND c.end_date >= ? AND c.end_date <= ?'); params.push(today, addDays(today, 30)); }
  if (status === 'fidelity') { where.push('c.active = 1 AND c.fidelity_until IS NOT NULL AND c.fidelity_until >= ?'); params.push(today); }
  if (status === 'closed') { where.push('(c.active = 0 OR (c.end_date IS NOT NULL AND c.end_date < ?))'); params.push(today); }
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM contracts c JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')}`, params)).n);
  const rows = await db.query(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY u.name, c.start_date DESC, c.id LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    params,
  );
  const kinds = (await db.query('SELECT DISTINCT kind FROM contracts ORDER BY kind')).map((r) => r.kind);
  return { contracts: rows.map(presentContract), total, kinds };
}

const values = (d) => [
  d.kind, d.unit, d.period, d.signed_at, d.start_date, d.end_date, d.fidelity_until, d.amount_cents, d.due_day, d.private_office,
  d.created_by_name, d.last_adjustment, d.adjustment_index, d.active ? 1 : 0, d.notes,
];

async function assertClient(userId, conn = db) {
  if (!(await conn.get("SELECT id FROM users WHERE id = ? AND role = 'client'", [userId]))) throw new HttpError(404, 'Cliente não encontrado.');
}

export async function createContract(userId, d, conn = db, extra = {}) {
  await assertClient(userId, conn);
  const stamp = nowStamp();
  const r = await conn.run(
    `INSERT INTO contracts (user_id, kind, unit, period, signed_at, start_date, end_date, fidelity_until, amount_cents, due_day, private_office,
                            created_by_name, last_adjustment, adjustment_index, active, notes, legacy_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, ...values(d), extra.legacy_key ?? null, stamp, stamp],
  );
  return r.insertId;
}

export async function updateContract(id, d) {
  const r = await db.run(
    `UPDATE contracts SET kind = ?, unit = ?, period = ?, signed_at = ?, start_date = ?, end_date = ?, fidelity_until = ?, amount_cents = ?, due_day = ?,
            private_office = ?, created_by_name = ?, last_adjustment = ?, adjustment_index = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [...values(d), nowStamp(), id],
  );
  return r.changes > 0;
}

/* ---------------- importação ---------------- */

const text = (max) => z.string().trim().max(max).optional().default('');
const importRow = z.object({
  codigo_cliente: z.string().trim().min(1, 'Sem código do cliente').max(20),
  cliente: text(120),
  tipo: z.string().trim().min(2, 'Sem tipo de contrato').max(80),
  unidade: text(80),
  periodicidade: text(12),
  assinatura: text(10),
  inicio: z.string().regex(DATE_RE, 'Início inválido').refine(isValidDate, 'Início inválido'),
  fim: text(10),
  fidelidade_ate: text(10),
  valor_centavos: z.coerce.number().int().min(0).optional().default(0),
  vencimento_dia: text(2),
  escritorio_privativo: text(80),
  cadastrado_por: text(120),
  ultimo_reajuste: text(10),
  indice_reajuste: text(20),
  ativo: text(5),
});

/** Importa contratos de outro sistema. O mesmo cliente + tipo + início não entra duas vezes (dá para repetir sem duplicar). */
export async function importContracts({ rows, dryRun = false }) {
  const out = { dry_run: dryRun, total: rows.length, created: 0, skipped: [], errors: [], missing_clients: {} };
  const seen = new Set();
  const toInsert = [];
  const clients = new Map();
  for (const [line, raw] of rows.entries()) {
    const label = `${raw?.cliente ?? ''} · ${raw?.tipo ?? ''}`.trim();
    const parsed = importRow.safeParse(Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])));
    if (!parsed.success) { out.errors.push({ line, name: label, reason: parsed.error.issues[0].message }); continue; }
    const r = parsed.data;
    if (!clients.has(r.codigo_cliente)) clients.set(r.codigo_cliente, (await db.get("SELECT id FROM users WHERE legacy_code = ? AND role = 'client'", [r.codigo_cliente]))?.id ?? null);
    const userId = clients.get(r.codigo_cliente);
    if (!userId) {
      const key = `${r.codigo_cliente} - ${r.cliente}`;
      out.missing_clients[key] = (out.missing_clients[key] ?? 0) + 1;
      out.errors.push({ line, name: label, reason: `Cliente nº ${r.codigo_cliente} não cadastrado.` });
      continue;
    }
    const key = `${r.codigo_cliente}|${r.tipo}|${r.periodicidade}|${r.inicio}`;
    if (seen.has(key) || (await db.get('SELECT id FROM contracts WHERE legacy_key = ?', [key]))) { out.skipped.push({ line, name: label, reason: 'Já importado.' }); continue; }
    seen.add(key);
    const period = PERIODS.includes(r.periodicidade) ? r.periodicidade : 'Mensal';
    const dueDay = Number(r.vencimento_dia);
    const candidate = contractSchema.safeParse({
      kind: r.tipo, unit: r.unidade, period, signed_at: r.assinatura, start_date: r.inicio, end_date: r.fim, fidelity_until: r.fidelidade_ate,
      amount_cents: r.valor_centavos, due_day: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : '', private_office: r.escritorio_privativo,
      created_by_name: r.cadastrado_por, last_adjustment: r.ultimo_reajuste, adjustment_index: r.indice_reajuste, active: !/^n/i.test(r.ativo),
      notes: PERIODS.includes(r.periodicidade) || !r.periodicidade ? '' : `Periodicidade no sistema anterior: ${r.periodicidade}.`,
    });
    if (!candidate.success) { out.errors.push({ line, name: label, reason: candidate.error.issues[0].message }); continue; }
    toInsert.push({ userId, data: candidate.data, key });
    out.created += 1;
  }
  if (dryRun || !toInsert.length) return out;
  await db.transaction(async (tx) => {
    for (const t of toInsert) await createContract(t.userId, t.data, tx, { legacy_key: t.key });
  });
  return out;
}
