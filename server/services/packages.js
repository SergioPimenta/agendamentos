import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { addDays, nowLocal, nowStamp } from '../utils/time.js';
import { getSettings, onlinePaymentsReady } from './settings.js';

/**
 * Pacotes de horas.
 *  - A administração monta o catálogo (`hour_packages`): horas, preço, validade e textos.
 *  - O cliente compra pelo Pagar.me: nasce uma compra pendente e a conta a receber correspondente; quando o pagamento
 *    é confirmado (online ou baixa manual) a compra vira saldo de horas, com validade.
 *  - Nas reservas, o saldo é usado depois das horas incluídas no plano, da compra que vence primeiro para a última.
 *    Cada uso fica em `package_usage`; reserva cancelada deixa de contar e as horas voltam sozinhas ao saldo.
 */

const COUNTING = "'pending','confirmed','no_show'"; // mesmas reservas que ocupam a agenda e consomem horas

const jsonList = (s) => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const presentPackage = (p) => ({
  id: Number(p.id),
  name: p.name,
  subtitle: p.subtitle ?? '',
  description: p.description ?? '',
  minutes: Number(p.minutes),
  price_cents: Number(p.price_cents),
  validity_days: Number(p.validity_days),
  icon: p.icon ?? '',
  featured: Boolean(Number(p.featured)),
  features: jsonList(p.features),
  active: Boolean(Number(p.active)),
  sort_order: Number(p.sort_order),
  ...(p.sold_count != null ? { sold_count: Number(p.sold_count) } : {}),
});

/* ---------------- saldo e consumo ---------------- */

/** De onde vieram as horas de um lote do banco de horas. */
export const LOT_SOURCES = ['package', 'cancellation', 'manual'];

/** Lote do banco de horas como a API devolve (com a reserva de origem, quando houver). */
const presentLot = (r) => ({
  id: Number(r.id),
  source: LOT_SOURCES.includes(r.source) ? r.source : 'package',
  name: r.name,
  note: r.note ?? '',
  minutes_total: Number(r.minutes_total),
  remaining: Number(r.remaining),
  expires_at: r.expires_at,
  created_at: r.created_at,
  origin_booking: r.origin_code
    ? { code: r.origin_code, room: r.origin_room, date: r.origin_date, start_time: r.origin_start }
    : null,
});

const LOT_SELECT = `SELECT p.id, p.user_id, p.source, p.name, p.note, p.minutes_total, p.expires_at, p.created_at,
            ob.code AS origin_code, ob.date AS origin_date, ob.start_time AS origin_start, orr.name AS origin_room,
            p.minutes_total - COALESCE((
              SELECT SUM(u.minutes) FROM package_usage u JOIN bookings b ON b.id = u.booking_id
               WHERE u.purchase_id = p.id AND b.status IN (${COUNTING})__EXCLUDE__
            ), 0) AS remaining
       FROM package_purchases p
       LEFT JOIN bookings ob ON ob.id = p.booking_id
       LEFT JOIN rooms orr ON orr.id = ob.room_id`;

/** Lotes pagos e ainda válidos na data, com as horas que sobram em cada um (o que vence primeiro vem antes). */
export async function packageLots(conn, userId, date, excludeBookingId = null) {
  const rows = await conn.query(
    `${LOT_SELECT.replace('__EXCLUDE__', excludeBookingId ? ' AND b.id <> ?' : '')}
      WHERE p.user_id = ? AND p.status = 'paid' AND (p.expires_at IS NULL OR p.expires_at >= ?)
      ORDER BY CASE WHEN p.expires_at IS NULL THEN 1 ELSE 0 END, p.expires_at, p.id`,
    excludeBookingId ? [excludeBookingId, userId, date] : [userId, date],
  );
  return rows.map(presentLot).filter((r) => r.remaining > 0);
}

/** Quanto do saldo cobre `minutes` numa reserva na data, e de qual compra sai cada parte. Não grava nada. */
export async function planPackageUse(conn, { userId, date, minutes, excludeId = null }) {
  const allocations = [];
  let left = minutes;
  if (left > 0) {
    for (const lot of await packageLots(conn, userId, date, excludeId)) {
      if (left <= 0) break;
      const take = Math.min(left, lot.remaining);
      allocations.push({ purchase_id: lot.id, minutes: take });
      left -= take;
    }
  }
  return { used: minutes - left, allocations };
}

/** Guarda (substituindo o que havia) de onde saíram as horas de pacote de uma reserva. */
export async function savePackageUse(conn, bookingId, allocations) {
  await conn.run('DELETE FROM package_usage WHERE booking_id = ?', [bookingId]);
  for (const a of allocations) {
    await conn.run('INSERT INTO package_usage (purchase_id, booking_id, minutes) VALUES (?, ?, ?)', [a.purchase_id, bookingId, a.minutes]);
  }
}

/** Saldo atual do cliente: o que sobra em cada compra válida hoje. */
export async function balanceFor(userId) {
  const lots = await packageLots(db, userId, nowLocal().date);
  return { minutes_available: lots.reduce((a, l) => a + l.remaining, 0), lots };
}

/* ---------------- compra pelo cliente ---------------- */

/** Pacotes à venda, o saldo do cliente e se o pagamento online está ligado. */
export async function packagesForClient(userId) {
  const rows = await db.query('SELECT * FROM hour_packages WHERE active = 1 ORDER BY sort_order, id');
  const pending = await db.get("SELECT package_id FROM package_purchases WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", [userId]);
  return {
    packages: rows.map(presentPackage),
    balance: await balanceFor(userId),
    pending_package_id: pending?.package_id == null ? null : Number(pending.package_id),
    online_payments: onlinePaymentsReady(await getSettings()),
  };
}

/** Compra um pacote: cria a compra pendente, a conta a receber e o link de pagamento online. */
export async function purchasePackage({ actor, packageId }) {
  const pkg = await db.get('SELECT * FROM hour_packages WHERE id = ? AND active = 1', [packageId]);
  if (!pkg) throw new HttpError(404, 'Pacote não encontrado.');
  if (!onlinePaymentsReady(await getSettings())) {
    throw new HttpError(422, 'O pagamento online ainda não está ativado. Fale com a recepção para comprar um pacote.');
  }
  if (Number(pkg.price_cents) <= 0) throw new HttpError(422, 'Este pacote não tem valor para cobrança online. Fale com a recepção.');

  // Compras anteriores que ficaram sem pagar perdem o sentido ao escolher outro pacote.
  const stale = await db.query("SELECT id, receivable_id FROM package_purchases WHERE user_id = ? AND status = 'pending' AND package_id <> ?", [actor.id, pkg.id]);
  for (const s of stale) {
    if (s.receivable_id) await db.run("DELETE FROM receivables WHERE id = ? AND status = 'pending'", [s.receivable_id]);
    await db.run('DELETE FROM package_purchases WHERE id = ?', [s.id]);
  }

  let purchase = await db.get("SELECT * FROM package_purchases WHERE user_id = ? AND status = 'pending' AND package_id = ? ORDER BY id DESC LIMIT 1", [actor.id, pkg.id]);
  let receivableId = purchase?.receivable_id ? Number(purchase.receivable_id) : null;
  if (receivableId && !(await db.get("SELECT id FROM receivables WHERE id = ? AND status = 'pending'", [receivableId]))) {
    await db.run('DELETE FROM package_purchases WHERE id = ?', [purchase.id]); // a conta já não existe mais: recomeça
    purchase = null;
  }
  if (!purchase) {
    const stamp = nowStamp();
    const r = await db.run(
      `INSERT INTO package_purchases (user_id, package_id, name, minutes_total, price_cents, validity_days, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [actor.id, pkg.id, pkg.name, pkg.minutes, pkg.price_cents, pkg.validity_days, actor.id, stamp, stamp],
    );
    const purchaseId = r.insertId;
    const rec = await db.run(
      `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, ref, package_purchase_id, created_at, updated_at)
       VALUES (?, ?, 'Pacotes de horas', ?, ?, 'pending', ?, ?, ?, ?)`,
      [actor.id, `Pacote ${pkg.name}`, pkg.price_cents, nowLocal().date, `pkg:${purchaseId}`, purchaseId, stamp, stamp],
    );
    receivableId = rec.insertId;
    await db.run('UPDATE package_purchases SET receivable_id = ? WHERE id = ?', [receivableId, purchaseId]);
  }

  // Importado aqui para não criar ciclo de módulos (as reservas dependem deste arquivo para calcular o preço).
  const { createCharge } = await import('./onlinePayments.js');
  const payment = await createCharge({ actor, userId: actor.id, scope: 'receivable', receivableId, trusted: true, successPath: '/app/planos' });
  return { payment };
}

/** Chamado quando a conta do pacote é paga (online ou baixa manual): a compra vira saldo, com a validade a partir de hoje. */
export async function activatePackageForReceivable(receivableId, conn = db) {
  const p = await conn.get("SELECT id, validity_days FROM package_purchases WHERE receivable_id = ? AND status = 'pending'", [receivableId]);
  if (!p) return false;
  const today = nowLocal().date;
  const expires = Number(p.validity_days) > 0 ? addDays(today, Number(p.validity_days)) : null;
  await conn.run("UPDATE package_purchases SET status = 'paid', paid_at = ?, expires_at = ?, updated_at = ? WHERE id = ?", [nowStamp(), expires, nowStamp(), p.id]);
  return true;
}

/** Venda registrada pela administração (ex.: paga no balcão): já entra paga, no saldo e no Financeiro. */
export async function grantPackage({ actor, userId, packageId, method = 'outro' }) {
  const pkg = await db.get('SELECT * FROM hour_packages WHERE id = ?', [packageId]);
  if (!pkg) throw new HttpError(404, 'Pacote não encontrado.');
  const user = await db.get("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'client'", [userId]);
  if (!user) throw new HttpError(404, 'Cliente não encontrado.');

  const stamp = nowStamp();
  const today = nowLocal().date;
  const expires = Number(pkg.validity_days) > 0 ? addDays(today, Number(pkg.validity_days)) : null;
  const r = await db.run(
    `INSERT INTO package_purchases (user_id, package_id, name, minutes_total, price_cents, validity_days, status, paid_at, expires_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`,
    [userId, pkg.id, pkg.name, pkg.minutes, pkg.price_cents, pkg.validity_days, stamp, expires, actor.id, stamp, stamp],
  );
  if (Number(pkg.price_cents) > 0) {
    const rec = await db.run(
      `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, paid_at, payment_method, ref, package_purchase_id, created_at, updated_at)
       VALUES (?, ?, 'Pacotes de horas', ?, ?, 'paid', ?, ?, ?, ?, ?, ?)`,
      [userId, `Pacote ${pkg.name}`, pkg.price_cents, today, stamp, method, `pkg:${r.insertId}`, r.insertId, stamp, stamp],
    );
    await db.run('UPDATE package_purchases SET receivable_id = ? WHERE id = ?', [rec.insertId, r.insertId]);
  }
  return r.insertId;
}

/** Compras recentes (todas as pessoas) com o saldo de cada uma, para a administração. */
export async function listPurchases(limit = 100) {
  const rows = await db.query(
    `SELECT p.*, u.name AS user_name, u.email AS user_email,
            p.minutes_total - COALESCE((
              SELECT SUM(x.minutes) FROM package_usage x JOIN bookings b ON b.id = x.booking_id
               WHERE x.purchase_id = p.id AND b.status IN (${COUNTING})
            ), 0) AS used_left
       FROM package_purchases p JOIN users u ON u.id = p.user_id
      WHERE p.source = 'package'
      ORDER BY p.id DESC LIMIT ?`,
    [limit],
  );
  const today = nowLocal().date;
  return rows.map((p) => {
    const expired = p.status === 'paid' && p.expires_at && p.expires_at < today;
    return {
      id: Number(p.id),
      user_id: Number(p.user_id),
      user_name: p.user_name,
      user_email: p.user_email,
      name: p.name,
      minutes_total: Number(p.minutes_total),
      minutes_left: p.status === 'paid' ? Math.max(0, Number(p.used_left)) : Number(p.minutes_total),
      price_cents: Number(p.price_cents),
      status: p.status,
      display_status: expired ? 'expired' : p.status,
      paid_at: p.paid_at,
      expires_at: p.expires_at,
      created_at: p.created_at,
    };
  });
}

/* ---------------- banco de horas: outras origens ---------------- */

/** Cria um lote de horas já pago/válido (reserva cancelada ou ajuste da recepção). */
async function creditLot(conn, { userId, minutes, source, name, note = '', bookingId = null, validityDays, createdBy = null }) {
  const stamp = nowStamp();
  const expires = validityDays > 0 ? addDays(nowLocal().date, validityDays) : null;
  const r = await conn.run(
    `INSERT INTO package_purchases (user_id, package_id, name, minutes_total, price_cents, validity_days, status, paid_at, expires_at, source, booking_id, note, created_by, created_at, updated_at)
     VALUES (?, NULL, ?, ?, 0, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, name, minutes, validityDays, stamp, expires, source, bookingId, note.slice(0, 255), createdBy, stamp, stamp],
  );
  return r.insertId;
}

/**
 * Reserva paga que foi cancelada: as horas pagas voltam como crédito no banco de horas do cliente, em vez de se perderem.
 * Só conta o que foi pago em dinheiro (as horas do plano e as de pacote já voltam sozinhas). Devolve os minutos creditados.
 */
export async function creditCancelledBooking(row, actorId = null, conn = db) {
  if (row.payment_status !== 'paid' || Number(row.price_cents) <= 0) return 0;
  const minutes = Number(row.total_minutes) - Number(row.included_minutes) - Number(row.package_minutes ?? 0);
  if (minutes <= 0) return 0;
  if (await conn.get("SELECT id FROM package_purchases WHERE source = 'cancellation' AND booking_id = ? AND status = 'paid'", [row.id])) return 0;

  const days = (await getSettings()).bank_credit_days ?? 90;
  await creditLot(conn, {
    userId: Number(row.user_id),
    minutes,
    source: 'cancellation',
    name: `Reserva cancelada ${row.code}`,
    note: `${row.room_name ?? 'Sala'} · ${String(row.date).split('-').reverse().join('/')} ${row.start_time}`,
    bookingId: Number(row.id),
    validityDays: Number(days),
    createdBy: actorId,
  });
  return minutes;
}

/** Reserva reativada: o crédito que ela tinha gerado sai do banco, se ainda não foi usado. */
export async function revokeCancellationCredit(bookingId, conn = db) {
  const lot = await conn.get("SELECT id, minutes_total FROM package_purchases WHERE source = 'cancellation' AND booking_id = ? AND status = 'paid'", [bookingId]);
  if (!lot) return false;
  const used = await conn.get('SELECT COALESCE(SUM(minutes), 0) AS n FROM package_usage WHERE purchase_id = ?', [lot.id]);
  if (Number(used.n) > 0) return false;
  await conn.run("UPDATE package_purchases SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowStamp(), lot.id]);
  return true;
}

/** Crédito manual da recepção (cortesia, correção, reposição...). O motivo fica registrado no lote. */
export async function addManualCredit({ actor, userId, minutes, validityDays, note }) {
  const user = await db.get("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'client'", [userId]);
  if (!user) throw new HttpError(404, 'Cliente não encontrado.');
  const days = validityDays ?? Number((await getSettings()).bank_credit_days ?? 90);
  return creditLot(db, { userId, minutes, source: 'manual', name: 'Ajuste da recepção', note, validityDays: days, createdBy: actor.id });
}

/** Tira um lote do banco (o que ainda não foi usado deixa de valer). Reservas já feitas com ele continuam como estão. */
export async function revokeLot(lotId) {
  const lot = await db.get("SELECT id, status FROM package_purchases WHERE id = ? AND status = 'paid'", [lotId]);
  if (!lot) throw new HttpError(404, 'Lote não encontrado ou já encerrado.');
  await db.run("UPDATE package_purchases SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowStamp(), lotId]);
}

/** Visão da administração: cada cliente com saldo e, dentro dele, os lotes e de onde vem cada um. */
export async function bankOverview() {
  const today = nowLocal().date;
  const rows = await db.query(
    `${LOT_SELECT.replace('__EXCLUDE__', '')}
      WHERE p.status = 'paid' AND (p.expires_at IS NULL OR p.expires_at >= ?)
      ORDER BY CASE WHEN p.expires_at IS NULL THEN 1 ELSE 0 END, p.expires_at, p.id`,
    [today],
  );
  const lots = rows.map((r) => ({ user_id: Number(r.user_id), ...presentLot(r) })).filter((l) => l.remaining > 0);
  const ids = [...new Set(lots.map((l) => l.user_id))];
  const users = ids.length
    ? await db.query(`SELECT id, name, email, phone FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    : [];
  const byId = new Map(users.map((u) => [Number(u.id), u]));
  const soon = addDays(today, 30);

  const clients = ids.map((uid) => {
    const mine = lots.filter((l) => l.user_id === uid);
    const u = byId.get(uid);
    return {
      user_id: uid,
      name: u?.name ?? '—',
      email: u?.email ?? '',
      phone: u?.phone ?? '',
      minutes_available: mine.reduce((a, l) => a + l.remaining, 0),
      lots: mine,
    };
  }).sort((a, b) => b.minutes_available - a.minutes_available || a.name.localeCompare(b.name, 'pt-BR'));

  return {
    clients,
    totals: {
      clients: clients.length,
      minutes: clients.reduce((a, c) => a + c.minutes_available, 0),
      expiring_minutes: lots.filter((l) => l.expires_at && l.expires_at <= soon).reduce((a, l) => a + l.remaining, 0),
      by_source: Object.fromEntries(LOT_SOURCES.map((s) => [s, lots.filter((l) => l.source === s).reduce((a, l) => a + l.remaining, 0)])),
    },
  };
}
