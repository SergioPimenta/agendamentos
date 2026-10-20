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

/** Compras pagas e ainda válidas na data, com as horas que sobram em cada uma (a que vence primeiro vem antes). */
export async function packageLots(conn, userId, date, excludeBookingId = null) {
  const rows = await conn.query(
    `SELECT p.id, p.name, p.minutes_total, p.expires_at,
            p.minutes_total - COALESCE((
              SELECT SUM(u.minutes) FROM package_usage u JOIN bookings b ON b.id = u.booking_id
               WHERE u.purchase_id = p.id AND b.status IN (${COUNTING})${excludeBookingId ? ' AND b.id <> ?' : ''}
            ), 0) AS remaining
       FROM package_purchases p
      WHERE p.user_id = ? AND p.status = 'paid' AND (p.expires_at IS NULL OR p.expires_at >= ?)
      ORDER BY CASE WHEN p.expires_at IS NULL THEN 1 ELSE 0 END, p.expires_at, p.id`,
    excludeBookingId ? [excludeBookingId, userId, date] : [userId, date],
  );
  return rows
    .map((r) => ({ id: Number(r.id), name: r.name, minutes_total: Number(r.minutes_total), expires_at: r.expires_at, remaining: Number(r.remaining) }))
    .filter((r) => r.remaining > 0);
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
