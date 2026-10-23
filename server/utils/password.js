import { z } from 'zod';

/**
 * Regras das senhas novas (cadastro, redefinição, troca e senha inicial criada pela administração):
 * mínimo de 8 caracteres, com ao menos uma letra e um número. O login não aplica as regras,
 * para quem já tem senha cadastrada continuar entrando.
 */
export const PASSWORD_MIN = 8;

export const passwordField = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa ter ao menos ${PASSWORD_MIN} caracteres`)
  .max(100, 'A senha pode ter no máximo 100 caracteres')
  .refine((v) => /[A-Za-z]/.test(v), 'A senha precisa ter ao menos uma letra')
  .refine((v) => /\d/.test(v), 'A senha precisa ter ao menos um número');
