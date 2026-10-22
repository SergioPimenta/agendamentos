import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { DEFAULT_PLAN_NAME } from '../db/migrate.js';
import { signToken, verifyToken } from '../middleware/auth.js';
import { permissionsFor } from '../services/access.js';
import { createPrimaryPerson, registrationPerson } from '../services/clientPeople.js';
import { getSettings } from '../services/settings.js';
import { HttpError, asyncHandler, parse, rateLimit } from '../utils/http.js';
import { sendTemplated } from '../services/emailTemplates.js';
import { birthDateField } from '../utils/birthDate.js';
import { isPlaceholderEmail } from '../utils/email.js';
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
        document: z.string().trim().max(20).optional().default(''),
        city: z.string().trim().max(80).optional().default(''),
        state: z.string().trim().toUpperCase().max(2).optional().default(''),
        // Pessoa física: a pessoa é o próprio cliente. Empresa: o cadastro é da empresa e a pessoa é o responsável.
        kind: z.enum(['individual', 'company']).optional().default('individual'),
        person: registrationPerson,
      }),
      req.body,
    );
    const company = data.kind === 'company';
    if (company && !data.person.name) throw new HttpError(422, 'Informe o nome do responsável pela empresa.');
    const person = company ? data.person : { ...data.person, name: data.name };
    // Pessoa física: o CPF vale para o cadastro e para a pessoa; o nascimento também.
    const document = data.document || (company ? '' : person.cpf ?? '');
    const birth = company ? null : (person.birth_date ?? null);

    const exists = await db.get('SELECT id FROM users WHERE email = ?', [data.email]);
    if (exists) throw new HttpError(409, 'Já existe uma conta com esse e-mail. Tente entrar.');

    const avulso = await db.get('SELECT id FROM plans WHERE name = ? AND active = 1', [DEFAULT_PLAN_NAME]);
    const userId = await db.transaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO users (name, email, password, role, phone, document, company, city, state, birth_date, plan_id, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.name, data.email, await bcrypt.hash(data.password, 10), data.phone, document, data.company, data.city, data.state, birth, avulso?.id ?? null, nowStamp(), nowStamp(), nowStamp()],
      );
      await createPrimaryPerson(r.insertId, { name: data.name, email: data.email, phone: data.phone, document, birth_date: birth }, person, tx);
      return r.insertId;
    });
    const r = { insertId: userId };

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

/* ---------------- primeiro acesso por código ---------------- */

const CODE_MINUTES = 15;
const CODE_RESEND_SECONDS = 60;
const CODE_MAX_ATTEMPTS = 5;
const FIRST_PASSWORD_MINUTES = 15;
const codeHash = (userId, code) => sha(`${userId}:${code}`);

/** Cliente que ainda não entrou no sistema (ex.: veio do sistema anterior) e tem e-mail de verdade. */
const firstLoginUser = (addr) =>
  db.get(
    `SELECT id, name, email, login_code_hash, login_code_expires, login_code_sent_at, login_code_attempts FROM users
      WHERE email = ? AND role = 'client' AND active = 1 AND last_login_at IS NULL`,
    [addr],
  );

const FIRST_LOGIN_MESSAGE = 'Se este e-mail tiver um primeiro acesso pendente, enviamos um código de 6 números. Quem já entrou antes deve usar a senha ou "Esqueceu sua senha?".';

router.post(
  '/first-login/request',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email }), req.body);
    const user = isPlaceholderEmail(data.email) ? null : await firstLoginUser(data.email);
    const now = nowStamp();
    const asMs = (stamp) => Date.parse(`${stamp.replace(' ', 'T')}Z`);
    const tooSoon = Boolean(user?.login_code_sent_at) && (asMs(now) - asMs(user.login_code_sent_at)) / 1000 < CODE_RESEND_SECONDS;
    if (user && !tooSoon) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await db.run('UPDATE users SET login_code_hash = ?, login_code_expires = ?, login_code_sent_at = ?, login_code_attempts = 0 WHERE id = ?', [
        codeHash(user.id, code), `${addMinutesAt(nowLocal().at, CODE_MINUTES)}:00`, now, user.id,
      ]);
      await sendTemplated('login_code', {
        to: user.email,
        vars: { nome: user.name.split(' ')[0], nome_completo: user.name, email: user.email, codigo_acesso: code },
        text: `Seu código de acesso: ${code} (vale por ${CODE_MINUTES} minutos).`,
      });
    }
    // Sempre a mesma resposta, para não revelar quais e-mails existem nem quem já entrou.
    res.json({ message: FIRST_LOGIN_MESSAGE });
  }),
);

router.post(
  '/first-login/verify',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 números') }), req.body);
    const user = await firstLoginUser(data.email);
    const invalid = new HttpError(400, 'Código inválido ou expirado. Peça um novo.');
    if (!user || !user.login_code_hash || !user.login_code_expires || user.login_code_expires < nowStamp()) throw invalid;
    if (Number(user.login_code_attempts) >= CODE_MAX_ATTEMPTS) throw new HttpError(429, 'Muitas tentativas. Peça um novo código.');
    if (codeHash(user.id, data.code) !== user.login_code_hash) {
      await db.run('UPDATE users SET login_code_attempts = login_code_attempts + 1 WHERE id = ?', [user.id]);
      throw invalid;
    }
    await db.run(
      'UPDATE users SET login_code_hash = NULL, login_code_expires = NULL, login_code_attempts = 0, last_login_at = ?, first_login_until = ? WHERE id = ?',
      [nowStamp(), `${addMinutesAt(nowLocal().at, FIRST_PASSWORD_MINUTES)}:00`, user.id],
    );
    const pub = await publicUser(user.id);
    res.json({ token: signToken(pub), user: pub, set_password: true });
  }),
);

/** Logo depois de entrar pelo código, a pessoa define a própria senha (vale por alguns minutos). */
router.post(
  '/first-login/password',
  verifyToken,
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ password }), req.body);
    const row = await db.get('SELECT first_login_until FROM users WHERE id = ?', [req.user.id]);
    if (!row?.first_login_until || row.first_login_until < nowStamp()) throw new HttpError(403, 'O prazo para definir a senha acabou. Use "Esqueceu sua senha?" na tela de entrada.');
    await db.run('UPDATE users SET password = ?, first_login_until = NULL, updated_at = ? WHERE id = ?', [await bcrypt.hash(data.password, 10), nowStamp(), req.user.id]);
    res.json({ message: 'Senha definida. Da próxima vez, entre com e-mail e senha.' });
  }),
);

export default router;
