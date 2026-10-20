import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { canEnterPanel, hasAccess, permissionsFor } from '../services/access.js';
import { HttpError, asyncHandler } from '../utils/http.js';

export const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

const USER_SQL = `SELECT u.id, u.name, u.email, u.role, u.phone, u.document, u.company, u.plan_id, u.active, u.profile_id,
                         ap.permissions AS profile_permissions, ap.is_system AS profile_is_system
                    FROM users u LEFT JOIN access_profiles ap ON ap.id = u.profile_id WHERE u.id = ?`;

/**
 * `permissions` diz o que a pessoa acessa no painel. `role` é o papel usado nas regras de reserva e cobrança:
 * continua 'admin' só para quem opera reservas ou cobranças; um perfil só de consulta age como cliente fora do painel.
 */
function shapeUser(row) {
  const permissions = permissionsFor(row);
  const operator = row.role === 'admin' && hasAccess(permissions, ['bookings', 'agenda', 'finance'], 'edit');
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: operator ? 'admin' : 'client',
    stored_role: row.role,
    phone: row.phone,
    document: row.document,
    company: row.company,
    plan_id: row.plan_id,
    profile_id: row.profile_id == null ? null : Number(row.profile_id),
    permissions,
    active: Boolean(Number(row.active)),
  };
}

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

  const user = await db.get(USER_SQL, [payload.id]);
  if (!user || !Number(user.active)) throw new HttpError(401, 'Conta desativada ou inexistente.');

  req.user = shapeUser(user);
  next();
});

/** Entra no painel quem tem ao menos um módulo liberado. */
export const requireAdmin = (req, _res, next) => {
  if (!canEnterPanel(req.user?.permissions)) return next(new HttpError(403, 'Acesso restrito à administração.'));
  next();
};

/**
 * Exige acesso a um dos módulos: consulta (GET/HEAD) pede nível "view"; qualquer alteração pede "edit".
 * `modules` vale para consultar e alterar; `readAlso` libera só a consulta para outros módulos
 * (ex.: a lista de planos é lida por Clientes e Financeiro, mas só quem tem Planos altera).
 */
export const requireModule = (modules, readAlso = []) => (req, _res, next) => {
  const level = req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'edit';
  const allowed = level === 'view' ? [...modules, ...readAlso] : modules;
  if (!hasAccess(req.user?.permissions, allowed, level)) {
    return next(new HttpError(403, level === 'edit' ? 'Seu perfil não permite alterar esta área.' : 'Seu perfil não dá acesso a esta área.'));
  }
  next();
};

/** Identifica o usuário quando há token válido, mas deixa passar visitantes (req.user = null). */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = null;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = await db.get(USER_SQL, [payload.id]);
      if (user && Number(user.active)) req.user = shapeUser(user);
    } catch {
      // token vencido ou inválido: segue como visitante
    }
  }
  next();
});
