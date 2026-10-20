import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Valida com zod e devolve 400 com a primeira mensagem legível. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue.path.join('.');
  const message = issue.message && !/^(Invalid|Too|Required|Expected)/i.test(issue.message)
    ? issue.message
    : field
      ? `Campo inválido: ${field}`
      : 'Dados inválidos';
  throw new HttpError(400, message, { field });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...err.extra });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Dados inválidos' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Arquivo muito grande (máx. 5 MB).' });
  }
  console.error('[erro]', err);
  res.status(500).json({ message: 'Erro interno. Tente novamente em instantes.' });
}

/** Limitador simples em memória (por IP + chave). Suficiente para uma instância única. */
export function rateLimit({ windowMs, max, message = 'Muitas tentativas. Aguarde alguns minutos.', key = () => '' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const id = `${req.ip}|${key(req)}`;
    const now = Date.now();
    const entry = hits.get(id);
    if (!entry || entry.reset < now) {
      hits.set(id, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}
