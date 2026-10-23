/** Máscaras de digitação (formatam enquanto a pessoa digita). */

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** 000.000.000-00 */
export function maskCpf(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

/** 00.000.000/0000-00 */
export function maskCnpj(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

/** (00) 00000-0000 (celular) ou (00) 0000-0000 (fixo), conforme a quantidade de dígitos. */
export function maskPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Sigla do estado: só letras, maiúsculas, até 2. */
export const maskUf = (v: string) => v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);

/** RG: letras e números (com X no fim), pontos e traço, sem outros símbolos. */
export const maskRg = (v: string) => v.replace(/[^0-9a-zA-Z.\-]/g, '').toUpperCase().slice(0, 20);
