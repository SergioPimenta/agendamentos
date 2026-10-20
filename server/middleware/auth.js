import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, asyncHandler } from '../utils/http.js';

export const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

/** Valida o token e recarrega o usuário (desativações e mudanças de perfil valem imediatamente). */
export const verifyToken = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Sessão expirada. Entre novamente.');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  }

  const user = await db.get(
    'SELECT id, name, email, role, phone, document, company, plan_id, active FROM users WHERE id = ?',
    [payload.id],
  );
  if (!user || !Number(user.active)) throw new HttpError(401, 'Conta desativada ou inexistente.');

  req.user = { ...user, id: Number(user.id), active: Boolean(Number(user.active)) };
  next();
});

export const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Acesso restrito à administração.'));
  next();
};

/** Identifica o usuário quando há token válido, mas deixa passar visitantes (req.user = null). */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = null;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = await db.get('SELECT id, name, email, role, phone, document, company, plan_id, active FROM users WHERE id = ?', [payload.id]);
      if (user && Number(user.active)) req.user = { ...user, id: Number(user.id), active: true };
    } catch {
      // token vencido ou inválido: segue como visitante
    }
  }
  next();
});
