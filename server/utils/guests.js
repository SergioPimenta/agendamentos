/** Convidados de uma reserva: lista de e-mails guardada como JSON na coluna `bookings.guests`. */

export const MAX_GUESTS = 10;

/** Texto gravado no banco → lista de e-mails. */
export function parseGuests(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Limpa a lista informada: minúsculas, sem repetição, sem o e-mail do próprio dono da reserva, no máximo MAX_GUESTS. */
export function normalizeGuests(list, ownerEmail = '') {
  const owner = String(ownerEmail).trim().toLowerCase();
  const seen = new Set();
  const out = [];
  for (const item of list ?? []) {
    const email = String(item).trim().toLowerCase();
    if (!email || email === owner || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out.slice(0, MAX_GUESTS);
}

export const guestsToDb = (list) => (list.length ? JSON.stringify(list) : null);
