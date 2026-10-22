import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { DEFAULT_PLAN_NAME } from '../db/migrate.js';
import { isPlaceholderEmail, placeholderEmail } from '../utils/email.js';
import { DATE_RE, isValidDate, nowStamp } from '../utils/time.js';
import { createPerson } from './clientPeople.js';

/**
 * Importação de clientes vindos de outro sistema (planilha CSV ou JSON).
 * Cada linha vira um cliente (sem acesso ao painel) e, opcionalmente, as pessoas dele (titular, sócios, responsáveis).
 * Quem já existe (mesmo código de origem, e-mail ou documento) é pulado, então repetir a importação não duplica ninguém.
 * Com `update`, o cliente já importado é completado: só entra o que estava vazio, nada que já exista é sobrescrito.
 * Com `dryRun` nada é gravado: só devolve o que aconteceria.
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

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const truthy = (v, fallback = false) => (v === undefined || v === null || v === '' ? fallback : v === true || /^(sim|s|true|1|yes|y)$/i.test(String(v).trim()));
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isoOrEmpty = (v) => { const s = str(v, 10); return DATE_RE.test(s) && isValidDate(s) && s >= '1900-01-01' && s <= nowStamp().slice(0, 10) ? s : ''; };
const goodEmail = (v) => { const s = str(v, 160).toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : ''; };

/**
 * Pessoas de uma linha: `pessoas` (lista, no JSON) ou colunas `pessoa_*` / `pessoa2_*` (na planilha).
 * Dado de pessoa é tratado com tolerância (e-mail ou data inválidos são descartados); só o nome é obrigatório.
 */
function peopleOf(raw) {
  const list = Array.isArray(raw.pessoas) ? [...raw.pessoas] : [];
  for (const prefix of ['pessoa_', 'pessoa2_']) {
    if (str(raw[`${prefix}nome`], 120)) {
      const g = (k) => raw[`${prefix}${k}`];
      list.push({ nome: g('nome'), sexo: g('sexo'), nascimento: g('nascimento'), email: g('email'), telefone: g('telefone'), telefone2: g('telefone2'), cargo: g('cargo'), rg: g('rg'), cpf: g('cpf'), assina: g('assina'), fiador: g('fiador'), ativo: g('ativo'), codigo_pessoa: g('codigo') });
    }
  }
  return list.filter((p) => p && typeof p === 'object').map((p) => ({
    name: str(p.nome, 120),
    gender: /^masc/i.test(str(p.sexo, 20)) ? 'Masculino' : /^fem/i.test(str(p.sexo, 20)) ? 'Feminino' : '',
    birth_date: isoOrEmpty(p.nascimento) || null,
    email: goodEmail(p.email),
    phone: str(p.telefone, 30),
    phone2: str(p.telefone2, 30),
    role: str(p.cargo, 80),
    rg: str(p.rg, 20),
    cpf: digits(p.cpf).slice(0, 14),
    signs_contract: truthy(p.assina),
    guarantor: truthy(p.fiador),
    active: truthy(p.ativo, true),
    is_primary: false,
    legacy_id: str(p.codigo_pessoa, 20) || null,
  }));
}

/** Mensagem curta do primeiro problema de validação de uma linha. */
const firstIssue = (err) => {
  const i = err.issues[0];
  return i?.message && i.message !== 'Invalid input' ? i.message : `Campo inválido: ${i?.path?.join('.') || 'linha'}`;
};

const inList = (values) => values.map(() => '?').join(',');

export async function importClients({ rows, dryRun = false, update = false }) {
  const plans = await db.query('SELECT id, name FROM plans');
  const planByName = new Map(plans.map((p) => [fold(p.name), Number(p.id)]));
  const defaultPlan = planByName.get(fold(DEFAULT_PLAN_NAME)) ?? null;

  const codes = rows.map((r) => String(r?.codigo_antigo ?? '').trim()).filter(Boolean);
  const wanted = new Set(rows.map((r) => String(r?.email ?? '').trim().toLowerCase()).filter(Boolean));
  for (const r of rows) for (const p of peopleOf(r ?? {})) if (p.email) wanted.add(p.email);

  const existingByCode = new Map();
  if (codes.length) {
    for (const u of await db.query(`SELECT * FROM users WHERE legacy_code IN (${inList(codes)})`, codes)) existingByCode.set(String(u.legacy_code), u);
  }
  const takenEmails = new Set();
  const emails = [...wanted];
  if (emails.length) {
    for (const u of await db.query(`SELECT email FROM users WHERE email IN (${inList(emails)})`, emails)) takenEmails.add(String(u.email).toLowerCase());
  }
  const takenDocs = new Set();
  for (const u of await db.query("SELECT document FROM users WHERE document <> ''")) if (digits(u.document)) takenDocs.add(digits(u.document));
  const peopleCount = new Map();
  const existingIds = [...existingByCode.values()].map((u) => Number(u.id));
  if (existingIds.length) {
    for (const c of await db.query(`SELECT user_id, COUNT(*) AS n FROM client_people WHERE user_id IN (${inList(existingIds)}) GROUP BY user_id`, existingIds)) peopleCount.set(Number(c.user_id), Number(c.n));
  }

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const toInsert = [];
  const toUpdate = [];
  const seenCodes = new Set();

  rows.forEach((raw, i) => {
    const line = i + 1;
    const parsed = rowSchema.safeParse(raw ?? {});
    const label = String(raw?.nome ?? '').slice(0, 60);
    if (!parsed.success) return errors.push({ line, name: label, reason: firstIssue(parsed.error) });
    const r = parsed.data;
    const people = peopleOf(raw);
    if (people.some((p) => p.name.length < 2)) return errors.push({ line, name: r.nome, reason: 'Pessoa sem nome' });

    let planId = defaultPlan;
    if (r.plano) {
      planId = planByName.get(fold(r.plano)) ?? null;
      if (planId == null) return errors.push({ line, name: r.nome, reason: `Plano "${r.plano}" não existe no sistema` });
    }

    // Pessoa principal: quem assina o contrato (ou a primeira ativa). Os dados dela viram os do cliente.
    const main = people.find((p) => p.signs_contract && p.active) ?? people.find((p) => p.active) ?? people[0] ?? null;
    if (main) main.is_primary = true;
    const individual = Boolean(main) && fold(main.name) === fold(r.nome);

    // E-mail: o da planilha tem prioridade (e pula a linha se já existe); senão, o primeiro e-mail livre das pessoas.
    let email = r.email;
    const explicitEmail = Boolean(r.email);
    const notes = [];
    if (!email) {
      const candidates = [main, ...people.filter((p) => p !== main)].filter(Boolean).map((p) => p.email).filter(Boolean);
      email = candidates.find((e) => !takenEmails.has(e)) ?? '';
      if (!email && candidates.length) notes.push(`E-mail ${candidates[0]} já pertence a outro cadastro.`);
    }

    const explicitDoc = digits(r.documento);
    let doc = explicitDoc || (individual ? digits(main.cpf) : '');
    const phone = r.telefone || main?.phone || '';
    const birth = r.nascimento || (individual ? main.birth_date || '' : '');

    const code = r.codigo_antigo;
    const existing = code ? existingByCode.get(code) : null;
    if (code && seenCodes.has(code)) return skipped.push({ line, name: r.nome, reason: 'Código repetido no arquivo' });
    if (code) seenCodes.add(code);

    if (existing) {
      if (!update) return skipped.push({ line, name: r.nome, reason: 'Já importado (mesmo código de origem)' });
      // Completar: só o que está vazio. O e-mail reservado dá lugar a um e-mail real livre.
      const patch = {};
      if (isPlaceholderEmail(existing.email) && email && !takenEmails.has(email)) patch.email = email;
      if (!existing.phone && phone) patch.phone = phone;
      if (!existing.document && doc && !takenDocs.has(doc)) patch.document = doc;
      if (!existing.company && r.nome_fantasia) patch.company = r.nome_fantasia;
      if (!existing.city && r.cidade) patch.city = r.cidade;
      if (!existing.state && r.uf) patch.state = r.uf.toUpperCase();
      if (!existing.tags && r.tags) patch.tags = r.tags;
      if (!existing.birth_date && birth) patch.birth_date = birth;
      if (!existing.plan_since && r.plano_desde) patch.plan_since = r.plano_desde;
      const addPeople = people.length > 0 && !peopleCount.get(Number(existing.id));
      if (!Object.keys(patch).length && !addPeople) return skipped.push({ line, name: r.nome, reason: 'Já importado (nada novo para completar)' });
      if (patch.email) takenEmails.add(patch.email);
      if (patch.document) takenDocs.add(patch.document);
      return toUpdate.push({ line, name: r.nome, id: Number(existing.id), patch, people: addPeople ? people : [] });
    }

    if (explicitEmail && takenEmails.has(r.email)) return skipped.push({ line, name: r.nome, reason: 'E-mail já cadastrado' });
    if (explicitDoc && takenDocs.has(explicitDoc)) return skipped.push({ line, name: r.nome, reason: 'Documento (CPF/CNPJ) já cadastrado' });
    if (doc && takenDocs.has(doc)) doc = ''; // CPF de uma pessoa que já é outro cliente: fica só no cadastro da pessoa

    if (email) takenEmails.add(email);
    if (doc) takenDocs.add(doc);
    toInsert.push({ line, r, planId, doc, email, phone, birth, notes, people });
  });

  if (!dryRun && (toInsert.length || toUpdate.length)) {
    // Quem é importado ainda não tem senha: recebe uma aleatória que ninguém conhece (entra depois por "esqueci minha senha").
    const password = toInsert.length ? await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10) : '';
    await db.transaction(async (tx) => {
      for (const t of toInsert) {
        const { r } = t;
        const stamp = r.cadastro ? `${r.cadastro} 12:00:00` : nowStamp();
        const note = [r.codigo_antigo ? `Importado do sistema anterior (nº ${r.codigo_antigo}).` : 'Importado de outro sistema.', r.observacoes, ...t.notes].filter(Boolean).join(' ').slice(0, 1000);
        const ins = await tx.run(
          `INSERT INTO users (name, email, password, role, phone, document, company, city, state, tags, birth_date, plan_id, plan_since, legacy_code, notes, active, created_at, updated_at)
           VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            r.nome, t.email || placeholderEmail(r.codigo_antigo || r.nome), password, t.phone, t.doc, r.nome_fantasia, r.cidade, r.uf.toUpperCase(), r.tags,
            t.birth || null, t.planId, r.plano_desde || null, r.codigo_antigo || null, note, stamp, stamp,
          ],
        );
        for (const p of t.people) await createPerson(ins.insertId, p, tx, { legacy_id: p.legacy_id, created_at: stamp });
      }
      for (const t of toUpdate) {
        const cols = Object.keys(t.patch);
        if (cols.length) {
          await tx.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => t.patch[c]), nowStamp(), t.id]);
        }
        for (const p of t.people) await createPerson(t.id, p, tx, { legacy_id: p.legacy_id });
      }
    });
  }
  for (const t of toInsert) created.push({ line: t.line, name: t.r.nome });
  for (const t of toUpdate) updated.push({ line: t.line, name: t.name });

  return {
    dry_run: Boolean(dryRun),
    total: rows.length,
    created: created.length,
    updated: updated.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    people: toInsert.reduce((a, t) => a + t.people.length, 0) + toUpdate.reduce((a, t) => a + t.people.length, 0),
    skipped: skipped.slice(0, 200),
    errors: errors.slice(0, 200),
  };
}
