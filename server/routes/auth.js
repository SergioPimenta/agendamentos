import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { DEFAULT_PLAN_NAME } from '../db/migrate.js';
import { signToken, verifyToken } from '../middleware/auth.js';
import { permissionsFor } from '../services/access.js';
import { getSettings } from '../services/settings.js';
import { HttpError, asyncHandler, parse, rateLimit } from '../utils/http.js';
import { sendTemplated } from '../services/emailTemplates.js';
import { birthDateField } from '../utils/birthDate.js';
import { addMinutesAt, nowLocal, nowStamp } from '../utils/time.js';

const router = express.Router();

const email = z.string().trim().toLowerCase().email('E-mail inválido').max(160);
const password = z.string().min(8, 'A senha precisa ter ao menos 8 caracteres').max(100);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: (req) => String(req.body?.email || '').toLowerCase() });

export async function publicUser(id) {
  const u = await db.get(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.document, u.company, u.plan_id, p.name AS plan_name,
            p.included_minutes AS plan_included_minutes, p.unlimited AS plan_unlimited,
            u.birth_date, ap.name AS profile_name, ap.permissions AS profile_permissions, ap.is_system AS profile_is_system
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id LEFT JOIN access_profiles ap ON ap.id = u.profile_id WHERE u.id = ?`,
    [id],
  );
  return {
    id: Number(u.id),
    name: u.name,
    email: u.email,
    role: u.role,
    profile_name: u.role === 'admin' ? (u.profile_name ?? 'Administrador') : null,
    permissions: permissionsFor(u),
    birth_date: u.birth_date ?? '',
    phone: u.phone,
    document: u.document,
    company: u.company,
    plan: u.plan_id
      ? { id: Number(u.plan_id), name: u.plan_name, included_minutes: Number(u.plan_included_minutes), unlimited: Boolean(Number(u.plan_unlimited)) }
      : null,
  };
}

router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const rules = await getSettings();
    if (!rules.allow_signup) throw new HttpError(403, 'Cadastros estão fechados no momento. Fale com a recepção.');

    const data = parse(
      z.object({
        name: z.string().trim().min(2, 'Informe seu nome').max(120),
        email,
        password,
        phone: z.string().trim().max(30).optional().default(''),
        company: z.string().trim().max(120).optional().default(''),
      }),
      req.body,
    );

    const exists = await db.get('SELECT id FROM users WHERE email = ?', [data.email]);
    if (exists) throw new HttpError(409, 'Já existe uma conta com esse e-mail. Tente entrar.');

    const avulso = await db.get('SELECT id FROM plans WHERE name = ? AND active = 1', [DEFAULT_PLAN_NAME]);
    const r = await db.run(
      `INSERT INTO users (name, email, password, role, phone, company, plan_id, created_at, updated_at)
       VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?)`,
      [data.name, data.email, await bcrypt.hash(data.password, 10), data.phone, data.company, avulso?.id ?? null, nowStamp(), nowStamp()],
    );

    const user = await publicUser(r.insertId);
    sendTemplated('welcome', {
      to: user.email,
      vars: { nome: user.name.split(' ')[0], nome_completo: user.name, email: user.email },
    }).catch(() => {});
    res.status(201).json({ token: signToken(user), user });
  }),
);

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email, password: z.string().min(1, 'Informe a senha') }), req.body);
    const row = await db.get('SELECT id, password, active FROM users WHERE email = ?', [data.email]);

    // Mesma resposta para e-mail inexistente e senha errada.
    const ok = row && (await bcrypt.compare(data.password, row.password));
    if (!ok) throw new HttpError(401, 'E-mail ou senha incorretos.');
    if (!Number(row.active)) throw new HttpError(403, 'Sua conta está desativada. Fale com a recepção.');

    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowStamp(), row.id]);
    const user = await publicUser(row.id);
    res.json({ token: signToken(user), user });
  }),
);

router.get(
  '/me',
  verifyToken,
  asyncHandler(async (req, res) => {
    res.json({ user: await publicUser(req.user.id) });
  }),
);

router.put(
  '/me',
  verifyToken,
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(2, 'Informe seu nome').max(120),
        phone: z.string().trim().max(30).default(''),
        company: z.string().trim().max(120).default(''),
        document: z.string().trim().max(20).default(''),
        birth_date: birthDateField,
      }),
      req.body,
    );
    await db.run('UPDATE users SET name = ?, phone = ?, company = ?, document = ?, updated_at = ? WHERE id = ?', [
      data.name, data.phone, data.company, data.document, nowStamp(), req.user.id,
    ]);
    if (data.birth_date !== undefined) await db.run('UPDATE users SET birth_date = ? WHERE id = ?', [data.birth_date, req.user.id]);
    res.json({ user: await publicUser(req.user.id) });
  }),
);

router.put(
  '/password',
  verifyToken,
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ current_password: z.string().min(1, 'Informe a senha atual'), new_password: password }), req.body);
    const row = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(data.current_password, row.password))) throw new HttpError(400, 'A senha atual está incorreta.');
    await db.run('UPDATE users SET password = ?, updated_at = ? WHERE id = ?', [await bcrypt.hash(data.new_password, 10), nowStamp(), req.user.id]);
    res.json({ message: 'Senha alterada com sucesso.' });
  }),
);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

router.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email }), req.body);
    const user = await db.get('SELECT id, name, email, active FROM users WHERE email = ?', [data.email]);

    if (user && Number(user.active)) {
      const token = crypto.randomBytes(32).toString('base64url');
      await db.run('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?', [
        sha(token), `${addMinutesAt(nowLocal().at, 60)}:00`, user.id,
      ]);
      const url = `${config.appUrl}/redefinir-senha?token=${token}`;
      await sendTemplated('password_reset', {
        to: user.email,
        vars: { nome: user.name.split(' ')[0], nome_completo: user.name, email: user.email, link: url },
        ctaUrl: url,
        text: `Link para redefinir a senha (vale por 1 hora): ${url}`,
      });
    }
    // Sempre a mesma resposta, para não revelar quais e-mails existem.
    res.json({ message: 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.' });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ token: z.string().min(10), password }), req.body);
    const user = await db.get('SELECT id, reset_expires FROM users WHERE reset_token_hash = ?', [sha(data.token)]);
    if (!user || !user.reset_expires || user.reset_expires < nowStamp()) {
      throw new HttpError(400, 'Link inválido ou expirado. Solicite um novo.');
    }
    await db.run('UPDATE users SET password = ?, reset_token_hash = NULL, reset_expires = NULL, updated_at = ? WHERE id = ?', [
      await bcrypt.hash(data.password, 10), nowStamp(), user.id,
    ]);
    res.json({ message: 'Senha redefinida. Você já pode entrar.' });
  }),
);

export default router;
