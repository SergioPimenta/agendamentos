import { config } from '../config.js';
import { db } from '../db/index.js';
import { addDays, nowLocal, nowStamp, toMin } from '../utils/time.js';

/**
 * Integração com a Conexa (sistema anterior), em um sentido só: o que é reservado lá aparece aqui.
 *  - Webhook: a Conexa avisa cada reserva cadastrada, editada ou cancelada (tempo real).
 *  - API (com token): relê as reservas de tempos em tempos e corrige o que algum aviso perdeu.
 * A reserva daqui carrega o número da Conexa em `legacy_id` (o mesmo campo da importação do relatório), então nunca duplica.
 * Não aplica as regras de agendamento (horário, antecedência, conflito): o que já foi combinado lá precisa constar aqui.
 */

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/^sala\s+/, '').replace(/\s+/g, ' ').trim();
const str = (v, n) => String(v ?? '').trim().slice(0, n);

/* ---------------- configuração ---------------- */

export function conexaBaseUrl() {
  const raw = config.conexa.url.trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.includes('.')) return `https://${raw}.conexa.app/index.php/api/v2`; // só o subdomínio
  return `https://${raw}`;
}
export const apiConfigured = () => Boolean(conexaBaseUrl() && config.conexa.token);
export const webhookConfigured = () => Boolean(config.conexa.webhookToken);

/* ---------------- cliente da API ---------------- */

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET na API v2 da Conexa (Bearer). Respeita o limite de chamadas por minuto. */
export async function conexaGet(path, query = {}) {
  if (!apiConfigured()) throw new Error('A API da Conexa não está configurada (CONEXA_URL e CONEXA_TOKEN).');
  const wait = lastCall + config.conexa.minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${conexaBaseUrl()}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${config.conexa.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) {
    await sleep(15_000);
    return conexaGet(path, query);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* resposta que não é JSON */ }
  if (!res.ok) throw new Error(`Conexa respondeu ${res.status}${json?.message ? `: ${String(json.message).slice(0, 160)}` : ''}`);
  return json;
}

/** Testa o token lendo uma reserva. */
export async function testConnection() {
  const r = await conexaGet('/room/bookings', { limit: 1 });
  return { ok: true, has_data: Array.isArray(r?.data) && r.data.length > 0 };
}

/* ---------------- leitura do aviso / da API ---------------- */

/** Aviso de webhook e item da API têm formatos parecidos; aqui viram um só. */
export function normalizeBooking(src) {
  const s = src ?? {};
  const place = s.place ?? {};
  const customer = s.customer ?? {};
  const emails = [...(customer.emails ?? []), ...(customer.emailsFinancialMessages ?? [])].map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const value = s.sale?.value;
  return {
    id: s.bookingId != null ? String(s.bookingId) : s.id != null && s.startTime ? String(s.id) : '',
    type: s.type ? String(s.type) : '',
    placeId: place.id != null ? String(place.id) : '',
    placeName: str(place.name, 160),
    customerId: customer.id != null ? String(customer.id) : s.customerId != null ? String(s.customerId) : '',
    customerName: str(customer.name || customer.tradeName, 120),
    emails,
    personName: str(s.person?.name, 120),
    notes: str(s.notes, 400),
    start: str(s.startTime, 40),
    end: str(s.finalTime, 40),
    // O aviso de cancelamento traz o motivo; a listagem da API traz isActive/cancellationReason.
    cancelled: Boolean(s.cancellationReason) || s.isActive === false,
    cancelReason: str(s.cancellationReason, 250),
    value: value == null || value === '' || Number.isNaN(Number(value)) ? null : Math.round(Number(value) * 100),
    online: Boolean(s.isOnlinePayment),
    recurringId: s.idRecurringBooking != null ? String(s.idRecurringBooking) : '',
  };
}

/** "2026-11-04T10:30:00-03:00" → { date, time } no horário da própria Conexa. */
const localParts = (iso) => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso || '');
  return m ? { date: m[1], time: m[2] } : null;
};

/* ---------------- salas ---------------- */

/** Sala daqui para o local da Conexa: pelo vínculo salvo; se não houver, pelo nome. Guarda o local para a tela de salas. */
async function roomFor(placeId, placeName) {
  if (!placeId) return null;
  let row = await db.get('SELECT * FROM conexa_places WHERE place_id = ?', [placeId]);
  if (!row) {
    await db.run('INSERT INTO conexa_places (place_id, name, room_id, created_at) VALUES (?, ?, NULL, ?)', [placeId, placeName, nowStamp()]);
    row = { place_id: placeId, name: placeName, room_id: null };
  } else if (placeName && row.name !== placeName) {
    await db.run('UPDATE conexa_places SET name = ? WHERE place_id = ?', [placeName, placeId]);
  }
  if (row.room_id) return Number(row.room_id);
  const key = norm(placeName);
  if (!key) return null;
  const rooms = await db.query('SELECT id, name FROM rooms');
  const hit = rooms.find((r) => norm(r.name) === key);
  if (!hit) return null;
  await db.run('UPDATE conexa_places SET room_id = ? WHERE place_id = ?', [Number(hit.id), placeId]);
  return Number(hit.id);
}

/** Cliente daqui: pelo código antigo (legacy_code = número do cliente na Conexa); na falta, por e-mail (e já guarda o vínculo). */
async function clientFor(customerId, emails) {
  if (customerId) {
    const u = await db.get('SELECT id FROM users WHERE legacy_code = ?', [customerId]);
    if (u) return Number(u.id);
  }
  for (const email of emails) {
    const u = await db.get("SELECT id, legacy_code FROM users WHERE role = 'client' AND LOWER(email) = ?", [email]);
    if (u) {
      if (customerId && !u.legacy_code) await db.run('UPDATE users SET legacy_code = ? WHERE id = ?', [customerId, u.id]);
      return Number(u.id);
    }
  }
  return null;
}

/* ---------------- gravação ---------------- */

const result = (status, kind, message = '') => ({ status, kind, message });

/**
 * Grava (ou atualiza, ou cancela) uma reserva da Conexa.
 * status: created | updated | cancelled | unchanged | ignored | error
 */
export async function applyBooking(b) {
  if (!b.id) return result('ignored', 'outro', 'O aviso não traz uma reserva (outro tipo de evento).');
  if (b.type && b.type !== 'room') return result('ignored', 'reserva', 'Reserva de coworking (não é de sala).');
  const existing = await db.get('SELECT * FROM bookings WHERE legacy_id = ?', [b.id]);
  const stamp = nowStamp();

  if (b.cancelled) {
    if (!existing) return result('ignored', 'reserva_cancelada', `A reserva nº ${b.id} não existe aqui; nada a cancelar.`);
    if (existing.status === 'cancelled') return result('unchanged', 'reserva_cancelada');
    await db.run("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", [stamp, (b.cancelReason || 'Cancelada na Conexa').slice(0, 255), stamp, existing.id]);
    return result('cancelled', 'reserva_cancelada');
  }

  const start = localParts(b.start);
  const end = localParts(b.end);
  if (!start || !end || start.date !== end.date) return result('error', 'reserva', 'Horário da reserva ausente ou atravessa a meia-noite.');
  if (toMin(end.time) <= toMin(start.time)) return result('error', 'reserva', 'O término precisa ser depois do início.');
  const kind = existing ? 'reserva_editada' : 'reserva_cadastrada';

  const roomId = await roomFor(b.placeId, b.placeName);
  if (!roomId) return result('error', kind, `O local "${b.placeName || b.placeId}" da Conexa ainda não tem sala correspondente. Relacione em Integração Conexa e reprocesse.`);
  const resolved = await clientFor(b.customerId, b.emails);
  const userId = resolved ?? (existing ? Number(existing.user_id) : null);
  if (!userId) return result('error', kind, `O cliente nº ${b.customerId || '?'}${b.customerName ? ` (${b.customerName})` : ''} não está cadastrado aqui. Cadastre ou importe o cliente e reprocesse.`);

  const minutes = toMin(end.time) - toMin(start.time);
  const notes = [b.notes, `Reserva nº ${b.id} da Conexa${b.personName ? `, pessoa: ${b.personName}` : ''}.`].filter(Boolean).join(' ');
  const series = b.recurringId ? `L${b.recurringId}` : null;

  if (existing) {
    const same = Number(existing.room_id) === roomId && existing.date === start.date && existing.start_time === start.time && existing.end_time === end.time
      && existing.status !== 'cancelled' && Number(existing.user_id) === userId && (b.value == null || Number(existing.price_cents) === b.value);
    if (same) return result('unchanged', kind);
    const price = b.value ?? Number(existing.price_cents);
    await db.run(
      `UPDATE bookings SET room_id = ?, user_id = ?, date = ?, start_time = ?, end_time = ?, start_at = ?, end_at = ?, status = 'confirmed', notes = ?, total_minutes = ?,
              price_cents = ?, cancelled_at = NULL, cancel_reason = NULL, series_id = COALESCE(series_id, ?), updated_at = ? WHERE id = ?`,
      [roomId, userId, start.date, start.time, end.time, `${start.date} ${start.time}`, `${start.date} ${end.time}`, notes, minutes, price, series, stamp, existing.id],
    );
    return result('updated', kind);
  }

  const price = b.value ?? 0;
  const payment = b.online ? 'paid' : price > 0 ? 'pending' : 'none';
  const today = nowLocal().date;
  const paidAt = payment === 'paid' ? `${start.date < today ? start.date : today} 12:00:00` : null;
  await db.run(
    `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees, total_minutes, included_minutes,
                           price_cents, payment_status, paid_at, payment_method, series_id, created_by, created_at, updated_at, legacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '', ?, 1, ?, 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [`L${b.id}`, roomId, userId, start.date, start.time, end.time, `${start.date} ${start.time}`, `${start.date} ${end.time}`, notes, minutes, price, payment, paidAt, paidAt ? 'outro' : null, series, stamp, stamp, b.id],
  );
  return result('created', kind);
}

/* ---------------- registro ---------------- */

async function logEvent({ source, kind, ref, status, message, payload }) {
  const r = await db.run(
    'INSERT INTO conexa_events (source, kind, booking_ref, status, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [source, kind, ref ? String(ref).slice(0, 20) : null, status, String(message || '').slice(0, 400), payload ? JSON.stringify(payload).slice(0, 20_000) : null, nowStamp()],
  );
  return Number(r.insertId);
}

/** Apaga o registro antigo (60 dias) para a tabela não crescer sem fim. */
export async function pruneEvents() {
  await db.run('DELETE FROM conexa_events WHERE created_at < ?', [`${addDays(nowLocal().date, -60)} 00:00:00`]);
}

const OK_STATUS = new Set(['created', 'updated', 'cancelled', 'unchanged']);

/** Um aviso (ou item) → grava e registra. Nunca lança: o erro vira registro, para a Conexa não bloquear o webhook. */
async function handleItem(item, source) {
  const b = normalizeBooking(item);
  let r;
  try {
    r = await applyBooking(b);
  } catch (err) {
    r = result('error', 'reserva', `Falha ao gravar: ${err instanceof Error ? err.message : String(err)}`.slice(0, 380));
    console.error('[conexa] falha ao gravar a reserva', b.id, err);
  }
  // Na leitura da API, o que não mudou não vira registro (senão o histórico se enche a cada rodada).
  if (!(source === 'api' && r.status === 'unchanged')) {
    await logEvent({
      source, kind: r.kind, ref: b.id, status: OK_STATUS.has(r.status) ? 'ok' : r.status,
      message: r.message || ({ created: 'Reserva criada.', updated: 'Reserva atualizada.', cancelled: 'Reserva cancelada.', unchanged: 'Sem mudança.' })[r.status] || '',
      payload: r.status === 'error' || r.status === 'ignored' ? item : null,
    });
  }
  return r;
}

/** Corpo recebido no webhook. Aceita um aviso só ou uma lista (reserva recorrente). */
export async function handleWebhook(body) {
  const items = Array.isArray(body?.bookings) ? body.bookings : Array.isArray(body) ? body : [body];
  const out = { received: items.length, created: 0, updated: 0, cancelled: 0, ignored: 0, errors: 0 };
  for (const item of items) {
    const r = await handleItem(item, 'webhook');
    if (r.status === 'created') out.created += 1;
    else if (r.status === 'updated') out.updated += 1;
    else if (r.status === 'cancelled') out.cancelled += 1;
    else if (r.status === 'error') out.errors += 1;
    else if (r.status === 'ignored') out.ignored += 1;
  }
  return out;
}

/** Reprocessa um registro com erro (depois de relacionar a sala ou cadastrar o cliente). */
export async function retryEvent(eventId) {
  const ev = await db.get('SELECT * FROM conexa_events WHERE id = ?', [eventId]);
  if (!ev || !ev.payload) return null;
  const r = await applyBooking(normalizeBooking(JSON.parse(ev.payload)));
  const status = OK_STATUS.has(r.status) ? 'ok' : r.status;
  await db.run('UPDATE conexa_events SET status = ?, message = ?, kind = ? WHERE id = ?', [status, (r.message || 'Reprocessada.').slice(0, 400), r.kind, eventId]);
  return { status, message: r.message };
}

/** Reprocessa todos os erros que citam o local (ao relacionar uma sala). */
export async function retryPlaceErrors() {
  const rows = await db.query("SELECT id FROM conexa_events WHERE status = 'error' AND payload IS NOT NULL ORDER BY id");
  let fixed = 0;
  for (const r of rows) if ((await retryEvent(Number(r.id)))?.status === 'ok') fixed += 1;
  return fixed;
}

/* ---------------- conferência pela API ---------------- */

let syncing = false;
export const isSyncing = () => syncing;

/**
 * Lê as reservas de sala da Conexa (paginado) e grava as que caem na janela. Rede de segurança dos avisos.
 * A listagem não é filtrada no servidor da Conexa: lê até `maxPages` páginas e filtra aqui pela data.
 */
export async function syncFromApi({ daysBack = 7, daysAhead = 180, maxPages = 60 } = {}) {
  if (!apiConfigured()) throw new Error('A API da Conexa não está configurada (CONEXA_URL e CONEXA_TOKEN).');
  if (syncing) throw new Error('Já existe uma sincronização em andamento.');
  syncing = true;
  const out = { read: 0, in_window: 0, created: 0, updated: 0, cancelled: 0, unchanged: 0, ignored: 0, errors: 0, pages: 0, complete: true };
  try {
    const today = nowLocal().date;
    const from = addDays(today, -daysBack);
    const to = addDays(today, daysAhead);
    for (let page = 0, offset = 0; ; page += 1) {
      if (page >= maxPages) { out.complete = false; break; }
      const res = await conexaGet('/room/bookings', { limit: 100, offset });
      const data = Array.isArray(res?.data) ? res.data : [];
      out.pages += 1;
      for (const item of data) {
        out.read += 1;
        const day = localParts(item.startTime)?.date;
        if (!day || day < from || day > to) continue;
        out.in_window += 1;
        const r = await handleItem(item, 'api');
        if (r.status in out) out[r.status] += 1;
        else if (r.status === 'error') out.errors += 1;
      }
      if (!res?.pagination?.hasNext || !data.length) break;
      offset += data.length;
    }
    await logEvent({
      source: 'api', kind: 'sincronizacao', status: out.errors ? 'error' : 'ok',
      message: `Lidas ${out.read} reservas, ${out.in_window} na janela: ${out.created} novas, ${out.updated} atualizadas, ${out.cancelled} canceladas, ${out.errors} com erro${out.complete ? '' : ' (leitura parcial: limite de páginas)'}.`,
    });
    return out;
  } catch (err) {
    await logEvent({ source: 'api', kind: 'sincronizacao', status: 'error', message: `Falha: ${err instanceof Error ? err.message : String(err)}` });
    throw err;
  } finally {
    syncing = false;
  }
}

/** Rotina periódica (cron/intervalo): só roda se a API estiver configurada e já passou o intervalo desde a última leitura. */
export async function syncIfDue() {
  if (!apiConfigured() || syncing) return null;
  const last = await db.get("SELECT created_at FROM conexa_events WHERE kind = 'sincronizacao' ORDER BY id DESC LIMIT 1");
  if (last) {
    const ageMin = (Date.now() - new Date(`${last.created_at.replace(' ', 'T')}`).getTime()) / 60000;
    if (ageMin < config.conexa.syncMinutes) return null;
  }
  try {
    await pruneEvents();
    return await syncFromApi();
  } catch (err) {
    console.error('[conexa] falha na sincronização periódica', err instanceof Error ? err.message : err);
    return null;
  }
}
