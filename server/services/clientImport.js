import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { DEFAULT_PLAN_NAME } from '../db/migrate.js';
import { placeholderEmail } from '../utils/email.js';
import { DATE_RE, isValidDate, nowStamp } from '../utils/time.js';

/**
 * Importação de clientes vindos de outro sistema (planilha CSV/JSON).
 * Cada linha vira um cliente (sem acesso ao painel). Quem já existe (mesmo código de origem, e-mail ou documento) é pulado,
 * então repetir a importação não duplica ninguém. Com `dryRun` nada é gravado: só devolve o que aconteceria.
 */

export const MAX_ROWS_PER_REQUEST = 300;

const text = (max) => z.string().trim().max(max).optional().default('');
const optionalDate = z.union([z.literal(''), z.string().regex(DATE_RE).refine(isValidDate)]).optional().default('');

const rowSchema = z.object({
  codigo_antigo: text(20),
  nome: z.string().trim().min(2, 'Nome ausente ou muito curto').max(120, 'Nome longo demais (máx. 120)'),
  nome_fantasia: text(120),
  documento: text(20),
  cidade: text(80),
  uf: text(2),
  telefone: text(30),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(160)]).optional().default(''),
  plano: text(80),
  plano_desde: optionalDate,
  nascimento: optionalDate,
  cadastro: optionalDate,
  tags: text(255),
  observacoes: text(900),
});

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** Mensagem curta do primeiro problema de validação de uma linha. */
const firstIssue = (err) => {
  const i = err.issues[0];
  return i?.message && i.message !== 'Invalid input' ? i.message : `Campo inválido: ${i?.path?.join('.') || 'linha'}`;
};

export async function importClients({ rows, dryRun = false }) {
  const plans = await db.query('SELECT id, name FROM plans');
  const planByName = new Map(plans.map((p) => [fold(p.name), Number(p.id)]));
  const defaultPlan = planByName.get(fold(DEFAULT_PLAN_NAME)) ?? null;

  const codes = rows.map((r) => String(r?.codigo_antigo ?? '').trim()).filter(Boolean);
  const emails = rows.map((r) => String(r?.email ?? '').trim().toLowerCase()).filter(Boolean);
  const takenCodes = new Set();
  const takenEmails = new Set();
  const takenDocs = new Set();
  if (codes.length) {
    for (const u of await db.query(`SELECT legacy_code FROM users WHERE legacy_code IN (${codes.map(() => '?').join(',')})`, codes)) takenCodes.add(String(u.legacy_code));
  }
  if (emails.length) {
    for (const u of await db.query(`SELECT email FROM users WHERE email IN (${emails.map(() => '?').join(',')})`, emails)) takenEmails.add(String(u.email).toLowerCase());
  }
  for (const u of await db.query("SELECT document FROM users WHERE document <> ''")) if (digits(u.document)) takenDocs.add(digits(u.document));

  const created = [];
  const skipped = [];
  const errors = [];
  const toInsert = [];

  rows.forEach((raw, i) => {
    const line = i + 1;
    const parsed = rowSchema.safeParse(raw ?? {});
    const label = String(raw?.nome ?? '').slice(0, 60);
    if (!parsed.success) return errors.push({ line, name: label, reason: firstIssue(parsed.error) });
    const r = parsed.data;

    let planId = defaultPlan;
    if (r.plano) {
      planId = planByName.get(fold(r.plano)) ?? null;
      if (planId == null) return errors.push({ line, name: r.nome, reason: `Plano "${r.plano}" não existe no sistema` });
    }

    const doc = digits(r.documento);
    if (r.codigo_antigo && takenCodes.has(r.codigo_antigo)) return skipped.push({ line, name: r.nome, reason: 'Já importado (mesmo código de origem)' });
    if (r.email && takenEmails.has(r.email)) return skipped.push({ line, name: r.nome, reason: 'E-mail já cadastrado' });
    if (doc && takenDocs.has(doc)) return skipped.push({ line, name: r.nome, reason: 'Documento (CPF/CNPJ) já cadastrado' });

    if (r.codigo_antigo) takenCodes.add(r.codigo_antigo);
    if (r.email) takenEmails.add(r.email);
    if (doc) takenDocs.add(doc);
    toInsert.push({ line, r, planId, doc });
  });

  if (!dryRun && toInsert.length) {
    // Quem é importado ainda não tem senha: recebe uma aleatória que ninguém conhece (entra depois por "esqueci minha senha").
    const password = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
    await db.transaction(async (tx) => {
      for (const { r, planId, doc } of toInsert) {
        const stamp = r.cadastro ? `${r.cadastro} 12:00:00` : nowStamp();
        const notes = [r.codigo_antigo ? `Importado do sistema anterior (nº ${r.codigo_antigo}).` : 'Importado de outro sistema.', r.observacoes].filter(Boolean).join(' ').slice(0, 1000);
        await tx.run(
          `INSERT INTO users (name, email, password, role, phone, document, company, city, state, tags, birth_date, plan_id, plan_since, legacy_code, notes, active, created_at, updated_at)
           VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            r.nome, r.email || placeholderEmail(r.codigo_antigo || r.nome), password, r.telefone, doc, r.nome_fantasia, r.cidade, r.uf.toUpperCase(), r.tags,
            r.nascimento || null, planId, r.plano_desde || null, r.codigo_antigo || null, notes, stamp, stamp,
          ],
        );
      }
    });
  }
  for (const t of toInsert) created.push({ line: t.line, name: t.r.nome });

  return {
    dry_run: Boolean(dryRun),
    total: rows.length,
    created: created.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    skipped: skipped.slice(0, 200),
    errors: errors.slice(0, 200),
  };
}
