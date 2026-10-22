/** Lê um CSV (separado por ; ou ,) com cabeçalho e devolve uma lista de objetos. Aceita aspas e BOM do Excel. */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Gera um CSV (com BOM, para o Excel abrir com acentos) a partir de cabeçalhos e linhas. */
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
