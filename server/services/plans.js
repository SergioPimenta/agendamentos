import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { nowLocal, nowStamp } from '../utils/time.js';
import { createCharge } from './onlinePayments.js';
import { getSettings, onlinePaymentsReady } from './settings.js';

/**
 * Troca de plano pelo próprio cliente.
 *  - Plano sem mensalidade: vale na hora.
 *  - Plano pago: geramos a mensalidade (conta a receber ligada ao plano) e o link de pagamento online.
 *    O plano só muda quando o pagamento é confirmado (`activatePlanForReceivable`, chamado na baixa).
 */

/** Ícones que a administração pode escolher para o cartão do plano. */
export const PLAN_ICONS = ['leaf', 'sprout', 'tree', 'flower', 'sun', 'mountain', 'building'];
export const PLAN_LAYOUTS = ['card', 'banner'];

const jsonList = (s) => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** A "vitrine" do plano: ícone, textos, benefícios e tabela de descontos (tudo editável no painel). */
export const presentShowcase = (p) => ({
  subtitle: p.subtitle ?? '',
  icon: p.icon ?? '',
  price_label: p.price_label ?? '',
  price_note: p.price_note ?? '',
  featured: Boolean(Number(p.featured ?? 0)),
  features: jsonList(p.features),
  tiers: jsonList(p.tiers),
  tiers_note: p.tiers_note ?? '',
  layout: PLAN_LAYOUTS.includes(p.layout) ? p.layout : 'card',
  headline: p.headline ?? '',
  cta_label: p.cta_label ?? '',
  contact_only: Boolean(Number(p.contact_only ?? 0)),
});

const presentPlan = (p) => ({
  ...presentShowcase(p),
  id: Number(p.id),
  name: p.name,
  description: p.description,
  included_minutes: Number(p.included_minutes),
  unlimited: Boolean(Number(p.unlimited)),
  room_discount_percent: Number(p.room_discount_percent),
  price_cents: Number(p.price_cents),
});

/** Planos que o cliente pode escolher, o atual e a troca que está aguardando pagamento (se houver). */
export async function plansForClient(userId) {
  const rows = await db.query('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order, id');
  const user = await db.get('SELECT plan_id FROM users WHERE id = ?', [userId]);
  const pending = await db.get(
    "SELECT plan_id FROM receivables WHERE user_id = ? AND status = 'pending' AND plan_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    [userId],
  );
  return {
    plans: rows.map(presentPlan),
    current_plan_id: user?.plan_id == null ? null : Number(user.plan_id),
    pending_plan_id: pending ? Number(pending.plan_id) : null,
    online_payments: onlinePaymentsReady(await getSettings()),
  };
}

/** Escolhe um plano. Devolve `{ activated: true }` quando já valeu, ou `{ payment }` com o link para pagar. */
export async function subscribeToPlan({ actor, planId }) {
  const plan = await db.get('SELECT * FROM plans WHERE id = ? AND active = 1', [planId]);
  if (!plan) throw new HttpError(404, 'Plano não encontrado.');
  const user = await db.get('SELECT id, plan_id FROM users WHERE id = ? AND active = 1', [actor.id]);
  if (user.plan_id != null && Number(user.plan_id) === Number(plan.id)) throw new HttpError(409, 'Este já é o seu plano.');
  if (Number(plan.contact_only)) throw new HttpError(422, 'Este plano é contratado com a recepção. Fale com a gente pelo WhatsApp.');

  // Qualquer troca anterior que ficou sem pagar perde o sentido ao escolher outro plano.
  await db.run("DELETE FROM receivables WHERE user_id = ? AND status = 'pending' AND plan_id IS NOT NULL AND plan_id <> ?", [actor.id, plan.id]);

  const price = Number(plan.price_cents);
  if (price <= 0) {
    await db.run('UPDATE users SET plan_id = ?, updated_at = ? WHERE id = ?', [plan.id, nowStamp(), actor.id]);
    return { activated: true };
  }

  if (!onlinePaymentsReady(await getSettings())) {
    throw new HttpError(422, 'O pagamento online ainda não está ativado. Fale com a recepção para mudar de plano.');
  }

  const month = nowLocal().date.slice(0, 7);
  let receivable = await db.get("SELECT id FROM receivables WHERE user_id = ? AND status = 'pending' AND plan_id = ? ORDER BY id DESC LIMIT 1", [actor.id, plan.id]);
  if (!receivable) {
    // `plan:<cliente>:<mês>` é a mesma referência da geração de mensalidades, que assim não cobra o mês duas vezes.
    const base = `plan:${actor.id}:${month}`;
    const ref = (await db.get('SELECT id FROM receivables WHERE ref = ?', [base])) ? `${base}:${plan.id}:${Date.now()}` : base;
    const today = nowLocal().date;
    const r = await db.run(
      `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, ref, plan_id, created_at, updated_at)
       VALUES (?, ?, 'Mensalidade de plano', ?, ?, 'pending', ?, ?, ?, ?)`,
      [actor.id, `Mensalidade ${plan.name} — ${month.slice(5)}/${month.slice(0, 4)}`, price, today, ref, plan.id, nowStamp(), nowStamp()],
    );
    receivable = { id: r.insertId };
  }

  const payment = await createCharge({
    actor, userId: actor.id, scope: 'receivable', receivableId: Number(receivable.id), trusted: true, successPath: '/app/planos',
  });
  return { activated: false, payment };
}

/** Chamado quando a mensalidade é paga (online ou baixa manual): se ela veio de uma troca de plano, o plano passa a valer. */
export async function activatePlanForReceivable(receivableId, conn = db) {
  const r = await conn.get('SELECT user_id, plan_id FROM receivables WHERE id = ?', [receivableId]);
  if (!r?.plan_id || !r.user_id) return false;
  const plan = await conn.get('SELECT id FROM plans WHERE id = ?', [r.plan_id]);
  if (!plan) return false;
  await conn.run('UPDATE users SET plan_id = ?, updated_at = ? WHERE id = ?', [r.plan_id, nowStamp(), r.user_id]);
  return true;
}
