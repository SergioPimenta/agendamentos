import { z } from 'zod';
import { DATE_RE, isValidDate, nowLocal } from './time.js';

const invalid = 'Data de nascimento inválida';

/** Data de nascimento (YYYY-MM-DD) opcional: vazio limpa o campo, ausente não mexe no que já está salvo. */
export const birthDateField = z
  .union([z.literal(''), z.string().regex(DATE_RE, invalid).refine(isValidDate, invalid)])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => !v || (v >= '1900-01-01' && v <= nowLocal().date), invalid);
