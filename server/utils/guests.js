/**
 * Convidados de uma reserva: lista de { name, email } guardada como JSON na coluna `bookings.guests`.
 * Reservas antigas guardavam só o e-mail (texto); elas continuam sendo lidas, com o nome vazio.
 */

export const MAX_GUESTS = 10;

const asGuest = (x) => {
  if (typeof x === 'string') return { name: '', email: x };
  if (x && typeof x === 'object' && typeof x.email === 'string') return { name: typeof x.name === 'string' ? x.name : '', email: x.email };
  return null;
};

/** Texto gravado no banco → lista de convidados { name, email }. */
export function parseGuestList(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(asGuest).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Só os e-mails dos convidados gravados. */
export const parseGuests = (raw) => parseGuestList(raw).map((g) => g.email);

/**
 * Limpa a lista informada (e-mails ou { name, email }): e-mail em minúsculas, sem repetição, sem o e-mail do
 * próprio dono da reserva, nome sem espaços sobrando, no máximo MAX_GUESTS.
 */
export function normalizeGuestList(list, ownerEmail = '') {
  const owner = String(ownerEmail).trim().toLowerCase();
  const seen = new Set();
  const out = [];
  for (const item of list ?? []) {
    const g = asGuest(item);
    if (!g) continue;
    const email = g.email.trim().toLowerCase();
    if (!email || email === owner || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: g.name.replace(/\s+/g, ' ').trim().slice(0, 120), email });
  }
  return out.slice(0, MAX_GUESTS);
}

export const normalizeGuests = (list, ownerEmail = '') => normalizeGuestList(list, ownerEmail).map((g) => g.email);

export const guestsToDb = (list) => (list.length ? JSON.stringify(list) : null);
