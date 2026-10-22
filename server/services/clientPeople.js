import { z } from 'zod';
import { db } from '../db/index.js';
import { birthDateField } from '../utils/birthDate.js';
import { nowStamp } from '../utils/time.js';

/**
 * Pessoas de cada cliente: o titular, sócios ou responsáveis. Cada uma tem contato, documentos e se assina o contrato
 * ou é fiador. O cliente (users) guarda os dados "principais" (e-mail, telefone...) vindos da pessoa principal.
 */

export const GENDERS = ['', 'Masculino', 'Feminino'];

export const personSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da pessoa').max(120),
  gender: z.enum(['', 'Masculino', 'Feminino']).optional().default(''),
  birth_date: birthDateField,
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(160)]).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  phone2: z.string().trim().max(30).optional().default(''),
  role: z.string().trim().max(80).optional().default(''),
  rg: z.string().trim().max(20).optional().default(''),
  cpf: z.string().trim().max(14).optional().default(''),
  signs_contract: z.boolean().optional().default(false),
  guarantor: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  is_primary: z.boolean().optional().default(false),
});

export const presentPerson = (p) => ({
  id: Number(p.id),
  user_id: Number(p.user_id),
  name: p.name,
  gender: p.gender ?? '',
  birth_date: p.birth_date ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
  phone2: p.phone2 ?? '',
  role: p.role ?? '',
  rg: p.rg ?? '',
  cpf: p.cpf ?? '',
  signs_contract: Boolean(Number(p.signs_contract)),
  guarantor: Boolean(Number(p.guarantor)),
  active: Boolean(Number(p.active)),
  is_primary: Boolean(Number(p.is_primary)),
  legacy_id: p.legacy_id ?? '',
});

export async function listPeople(userId, conn = db) {
  const rows = await conn.query('SELECT * FROM client_people WHERE user_id = ? ORDER BY is_primary DESC, id', [userId]);
  return rows.map(presentPerson);
}

const values = (d) => [
  d.name, d.gender, d.birth_date ?? null, d.email, d.phone, d.phone2, d.role, d.rg, d.cpf,
  d.signs_contract ? 1 : 0, d.guarantor ? 1 : 0, d.active ? 1 : 0, d.is_primary ? 1 : 0,
];

/** Só uma pessoa é a principal por cliente: marcar uma desmarca as outras. */
async function ensureSinglePrimary(conn, userId, keepId) {
  await conn.run('UPDATE client_people SET is_primary = 0 WHERE user_id = ? AND id <> ?', [userId, keepId]);
}

export async function createPerson(userId, d, conn = db, extra = {}) {
  const r = await conn.run(
    `INSERT INTO client_people (user_id, name, gender, birth_date, email, phone, phone2, role, rg, cpf, signs_contract, guarantor, active, is_primary, legacy_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, ...values(d), extra.legacy_id ?? null, extra.created_at ?? nowStamp()],
  );
  if (d.is_primary) await ensureSinglePrimary(conn, userId, r.insertId);
  return r.insertId;
}

export async function updatePerson(id, d, conn = db) {
  const cur = await conn.get('SELECT user_id FROM client_people WHERE id = ?', [id]);
  if (!cur) return false;
  await conn.run(
    `UPDATE client_people SET name = ?, gender = ?, birth_date = ?, email = ?, phone = ?, phone2 = ?, role = ?, rg = ?, cpf = ?,
            signs_contract = ?, guarantor = ?, active = ?, is_primary = ? WHERE id = ?`,
    [...values(d), id],
  );
  if (d.is_primary) await ensureSinglePrimary(conn, Number(cur.user_id), id);
  return true;
}
