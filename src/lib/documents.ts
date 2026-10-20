/** Máscaras e validações dos campos do pagamento (CPF/CNPJ, celular, cartão). */

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function isValidCpf(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((a, w, i) => a + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

export const isValidDocument = (v: string) => isValidCpf(v) || isValidCnpj(v);

export function maskDocument(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskPhone(value: string) {
  let d = onlyDigits(value);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const isValidPhone = (v: string) => {
  const d = onlyDigits(v);
  return d.length === 10 || d.length === 11;
};

export const maskCardNumber = (value: string) => onlyDigits(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

export function maskExpiry(value: string) {
  const d = onlyDigits(value).slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** "MM/AA" → { month, year } (ano com 4 dígitos), ou null se inválido ou vencido. */
export function parseExpiry(value: string) {
  const m = value.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return null;
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null;
  return { month, year };
}

/** Confere o número do cartão pelo algoritmo de Luhn (pega erro de digitação antes de enviar). */
export function isValidCardNumber(value: string) {
  const d = onlyDigits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
