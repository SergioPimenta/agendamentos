import crypto from 'crypto';

/**
 * Cliente cadastrado sem e-mail (ex.: vindo de outro sistema que não guardava e-mail) recebe um endereço
 * "reservado" que nunca existe de verdade (.invalid), para manter a regra de e-mail único e obrigatório no banco.
 * Esses endereços nunca recebem mensagem e não aparecem nas telas.
 */
export const PLACEHOLDER_DOMAIN = 'sem-email.invalid';

export const isPlaceholderEmail = (email) => String(email ?? '').toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);

export const placeholderEmail = (hint = '') =>
  `sem-email-${String(hint).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'x'}-${crypto.randomBytes(4).toString('hex')}@${PLACEHOLDER_DOMAIN}`;

/** O e-mail como deve aparecer: vazio quando é um endereço reservado. */
export const shownEmail = (email) => (isPlaceholderEmail(email) ? '' : email ?? '');
