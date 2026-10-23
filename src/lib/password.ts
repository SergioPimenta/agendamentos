/** Regras das senhas novas (as mesmas do servidor): 8+ caracteres, ao menos uma letra e um número. */
export const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 8 caracteres', test: (v: string) => v.length >= 8 },
  { id: 'letter', label: 'Uma letra', test: (v: string) => /[A-Za-z]/.test(v) },
  { id: 'digit', label: 'Um número', test: (v: string) => /\d/.test(v) },
] as const;

/** Primeira regra que a senha não cumpre, como mensagem; '' quando está tudo certo. */
export function passwordError(value: string): string {
  const miss = PASSWORD_RULES.find((r) => !r.test(value));
  if (!miss) return '';
  return miss.id === 'length' ? 'A senha precisa ter ao menos 8 caracteres.' : `A senha precisa ter ${miss.label.toLowerCase().replace('pelo menos ', '')}.`;
}
