/** Validação de documentos e telefone (Brasil), usada antes de mandar dados ao Pagar.me. */

export const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function isValidCpf(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value) {
  const d = digits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((a, w, i) => a + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** Celular/fixo brasileiro → { country_code, area_code, number } (formato do Pagar.me), ou null se inválido. */
export function parsePhone(raw) {
  let d = digits(raw);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { country_code: '55', area_code: d.slice(0, 2), number: d.slice(2) };
}
