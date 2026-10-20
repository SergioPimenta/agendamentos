import { config } from '../config.js';
import { db } from '../db/index.js';
import { digits, isValidCnpj, isValidCpf, parsePhone } from '../utils/documents.js';
import { HttpError } from '../utils/http.js';
import { addMinutesAt, localStampFromIso, nowLocal, nowStamp } from '../utils/time.js';
import { CONSUMING, inList } from './availability.js';
import { MIN_ONLINE_CENTS, formatBRL, getBookingRow, notifyBookingPaid, releaseExpiredHolds } from './bookings.js';
import { sendTemplated } from './emailTemplates.js';
import { METHOD_MAP, createCheckoutOrder, createDirectOrder, getOrder, pagarmeConfigured, pagarmeMode } from './pagarme.js';
import { activatePlanForReceivable } from './plans.js';
import { getSettings, onlinePaymentsReady } from './settings.js';

/**
 * Cobrança online (Pagar.me) das faturas e reservas dos clientes.
 *
 *  1. Criamos o link de pagamento (checkout hospedado) para o valor em aberto e guardamos o que ele quita (`items`).
 *  2. O cliente paga no Pagar.me (Pix, cartão ou boleto).
 *  3. O webhook (ou o retorno do cliente) manda consultar o pedido no Pagar.me. Só depois dessa consulta damos baixa.
 *  4. A baixa grava data e forma de pagamento, então entra sozinha no Financeiro (contas a receber e fluxo de caixa).
 */

const MIN_CENTS = MIN_ONLINE_CENTS; // o Pagar.me não aceita cobranças abaixo de R$ 1,00

const parseItems = (row) => {
  try { return JSON.parse(row.items); } catch { return { bookings: [], receivables: [] }; }
};

/** Cobrança como a API devolve. `checkout_url` só aparece enquanto ainda dá para pagar. */
export function presentPayment(row) {
  const expired = row.status === 'pending' && row.expires_at && row.expires_at < nowLocal().stamp;
  const open = row.status === 'pending' && !expired;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    user_name: row.user_name ?? undefined,
    user_email: row.user_email ?? undefined,
    kind: row.kind,
    description: row.description,
    amount_cents: Number(row.amount_cents),
    status: row.status,
    display_status: expired ? 'expired' : row.status,
    method: row.method,
    paid_at: row.paid_at,
    expires_at: row.expires_at,
    checkout_url: open ? row.checkout_url : null,
    pix_qr_code: open ? row.pix_qr_code ?? null : null,
    needs_review: Boolean(Number(row.needs_review)),
    note: row.note,
    created_at: row.created_at,
  };
}

const paymentRow = (id) =>
  db.get(
    `SELECT p.*, u.name AS user_name, u.email AS user_email FROM online_payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [id],
  );

/* ---------------- criar cobrança ---------------- */

/** Monta o que a cobrança vai quitar: partes em aberto de reservas (valor e excedente) e lançamentos avulsos. */
async function collectItems({ userId, scope, month, bookingId, receivableId }) {
  const items = { bookings: [], receivables: [] };
  let description = '';

  if (scope === 'month' || scope === 'booking') {
    const where = scope === 'month' ? 'SUBSTR(b.date, 1, 7) = ?' : 'b.id = ?';
    const rows = await db.query(
      `SELECT b.id, b.code, b.date, b.price_cents, b.payment_status, b.overtime_cents, b.overtime_payment_status
         FROM bookings b
        WHERE b.user_id = ? AND ${where} AND b.status IN (${inList(CONSUMING)})
          AND ((b.price_cents > 0 AND b.payment_status = 'pending') OR (b.overtime_cents > 0 AND b.overtime_payment_status = 'pending'))
        ORDER BY b.start_at`,
      [userId, scope === 'month' ? month : bookingId],
    );
    for (const b of rows) {
      if (Number(b.price_cents) > 0 && b.payment_status === 'pending') items.bookings.push({ id: Number(b.id), part: 'price', cents: Number(b.price_cents) });
      if (Number(b.overtime_cents) > 0 && b.overtime_payment_status === 'pending') items.bookings.push({ id: Number(b.id), part: 'overtime', cents: Number(b.overtime_cents) });
    }
    description = scope === 'month' ? `Fatura de ${month.slice(5)}/${month.slice(0, 4)}` : rows[0] ? `Reserva ${rows[0].code} (${rows[0].date.split('-').reverse().join('/')})` : '';
  } else if (scope === 'receivable') {
    const r = await db.get("SELECT id, description, amount_cents FROM receivables WHERE id = ? AND status = 'pending' AND (user_id = ? OR user_id IS NULL)", [receivableId, userId]);
    if (r) {
      items.receivables.push({ id: Number(r.id), cents: Number(r.amount_cents) });
      description = r.description;
    }
  }

  const total = [...items.bookings, ...items.receivables].reduce((a, i) => a + i.cents, 0);
  return { items, total, description };
}

/**
 * Gera (ou reaproveita) o link de pagamento. `actor` é quem pediu: o próprio cliente ou a administração.
 * Um cliente só cobra a si mesmo.
 */
export async function createCharge({ actor, userId, scope, month, bookingId, receivableId, trusted = false, successPath = '/app/consumo' }) {
  const rules = await getSettings();
  if (!onlinePaymentsReady(rules)) throw new HttpError(422, 'O pagamento online não está ativado.');
  if (actor.role !== 'admin' && Number(actor.id) !== Number(userId)) throw new HttpError(403, 'Você só pode pagar as suas próprias contas.');
  // `trusted`: o próprio servidor gerou o lançamento (ex.: mensalidade de troca de plano) para este cliente.
  if (scope === 'receivable' && actor.role !== 'admin' && !trusted) throw new HttpError(403, 'Apenas a administração gera cobrança de lançamentos avulsos.');

  const user = await db.get('SELECT id, name, email, document FROM users WHERE id = ? AND active = 1', [userId]);
  if (!user) throw new HttpError(404, 'Cliente não encontrado.');

  const { items, total, description } = await collectItems({ userId, scope, month, bookingId, receivableId });
  if (total <= 0) throw new HttpError(422, 'Não há nada em aberto para pagar.');
  if (total < MIN_CENTS) throw new HttpError(422, 'O valor mínimo para pagamento online é R$ 1,00.');

  // Já existe um link válido para exatamente isto? Reaproveita, em vez de gerar outro.
  const key = JSON.stringify(items);
  const existing = await db.query(
    "SELECT id, items, expires_at FROM online_payments WHERE user_id = ? AND status = 'pending' AND provider_order_id IS NOT NULL AND expires_at > ?",
    [userId, nowLocal().stamp],
  );
  const same = existing.find((e) => JSON.stringify(parseItems(e)) === key);
  if (same) return presentPayment(await paymentRow(same.id));

  const methods = String(rules.pagarme_methods || 'pix,credit_card,boleto').split(',').filter(Boolean);
  const now = nowStamp();
  const created = await db.run(
    `INSERT INTO online_payments (user_id, kind, description, items, amount_cents, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [userId, scope === 'month' ? 'invoice' : scope, description, key, total, actor.id, now, now],
  );
  const id = created.insertId;

  const doc = String(user.document || '').replace(/\D/g, '');
  const customer = { name: user.name.slice(0, 64), email: user.email.slice(0, 64) };
  if (doc.length === 11) Object.assign(customer, { type: 'individual', document: doc, document_type: 'CPF' });
  else if (doc.length === 14) Object.assign(customer, { type: 'company', document: doc, document_type: 'CNPJ' });

  try {
    const { orderId, checkoutUrl } = await createCheckoutOrder({
      code: `HZ-${id}`,
      description: `${description} — ${rules.business_name}`,
      amount_cents: total,
      customer,
      methods,
      expiresMinutes: rules.pagarme_expires_minutes,
      installments: methods.includes('credit_card') ? rules.pagarme_max_installments : 1,
      successUrl: `${config.appUrl}${successPath}?pagamento=${id}`,
      metadata: { online_payment_id: String(id), user_id: String(userId) },
      statementDescriptor: String(rules.business_name || 'HARMONIZEOSER').toUpperCase().replace(/[^A-Z0-9 ]/g, ''),
    });
    await db.run(
      'UPDATE online_payments SET provider_order_id = ?, checkout_url = ?, expires_at = ?, updated_at = ? WHERE id = ?',
      [orderId, checkoutUrl, `${addMinutesAt(nowLocal().at, rules.pagarme_expires_minutes)}:00`, nowStamp(), id],
    );
  } catch (err) {
    await db.run('DELETE FROM online_payments WHERE id = ?', [id]); // não deixa cobrança "fantasma" sem link
    throw err;
  }
  return presentPayment(await paymentRow(id));
}

/* ---------------- confirmar pagamento ---------------- */

/** Dá baixa no que a cobrança quita. Tudo numa transação, e só uma vez (idempotente). */
async function settle(payment, order, charge) {
  const paidCents = Number(charge?.paid_amount ?? charge?.amount ?? order.amount ?? 0);
  if (paidCents < Number(payment.amount_cents)) {
    await db.run('UPDATE online_payments SET needs_review = 1, note = ?, last_event = ?, updated_at = ? WHERE id = ?', [
      `Pago a menos: ${formatBRL(paidCents)} de ${formatBRL(Number(payment.amount_cents))}. Confira no Pagar.me.`, 'underpaid', nowStamp(), payment.id,
    ]);
    return false;
  }

  const rules = await getSettings();
  const method = METHOD_MAP[charge?.payment_method?.toLowerCase?.()] ?? 'outro';
  const stamp = charge?.paid_at ? localStampFromIso(charge.paid_at) : nowStamp();
  const items = parseItems(payment);
  let settled = 0;
  let skipped = 0;
  let cancelledPaid = 0;
  const confirmed = [];

  const done = await db.transaction(async (tx) => {
    const current = await tx.get(tx.forUpdate('SELECT status FROM online_payments WHERE id = ?'), [payment.id]);
    if (current.status === 'paid') return false;

    for (const it of items.bookings) {
      const bk = await tx.get('SELECT status, hold_until FROM bookings WHERE id = ?', [it.id]);
      if (bk?.status === 'cancelled') { cancelledPaid++; continue; } // o prazo para pagar acabou e o horário foi liberado

      const r = it.part === 'overtime'
        ? await tx.run(
            "UPDATE bookings SET overtime_payment_status = 'paid', overtime_paid_at = ?, overtime_payment_method = ?, updated_at = ? WHERE id = ? AND overtime_payment_status = 'pending'",
            [stamp, method, nowStamp(), it.id],
          )
        : await tx.run(
            "UPDATE bookings SET payment_status = 'paid', paid_at = ?, payment_method = ?, updated_at = ? WHERE id = ? AND payment_status = 'pending'",
            [stamp, method, nowStamp(), it.id],
          );
      if (r.changes > 0) settled++; else skipped++;

      // Reserva que estava segurada à espera do pagamento: agora confirma (ou fica para aprovação, se for o caso).
      if (it.part === 'price' && bk?.hold_until) {
        await tx.run('UPDATE bookings SET status = ?, hold_until = NULL, updated_at = ? WHERE id = ?', [rules.require_approval ? 'pending' : 'confirmed', nowStamp(), it.id]);
        confirmed.push(it.id);
      }
    }
    for (const it of items.receivables) {
      const r = await tx.run("UPDATE receivables SET status = 'paid', paid_at = ?, payment_method = ?, updated_at = ? WHERE id = ? AND status = 'pending'", [stamp, method, nowStamp(), it.id]);
      if (r.changes > 0) {
        settled++;
        await activatePlanForReceivable(it.id, tx); // mensalidade de troca de plano: o novo plano passa a valer
      } else skipped++;
    }

    const review = skipped > 0 || cancelledPaid > 0;
    const note = cancelledPaid > 0
      ? 'Pagamento recebido para uma reserva que já tinha sido liberada (o prazo para pagar acabou). Faça a reserva de novo para o cliente ou estorne no Pagar.me.'
      : settled === 0
        ? 'Pago online, mas as contas já estavam quitadas. Verifique se é preciso estornar no Pagar.me.'
        : skipped > 0 ? 'Parte das contas já estava quitada manualmente.' : null;
    await tx.run(
      `UPDATE online_payments SET status = 'paid', method = ?, paid_at = ?, provider_charge_id = ?, needs_review = ?, note = ?, last_event = 'paid', updated_at = ? WHERE id = ?`,
      [method, stamp, charge?.id ?? null, review ? 1 : 0, note, nowStamp(), payment.id],
    );
    return true;
  });

  if (done) {
    for (const id of confirmed) notifyBookingPaid(id).catch(() => {});
    const row = await paymentRow(payment.id);
    sendTemplated('payment_received', {
      to: row.user_email,
      vars: {
        nome: String(row.user_name).trim().split(' ')[0],
        nome_completo: row.user_name,
        email: row.user_email,
        descricao: row.description,
        valor_pago: formatBRL(Number(row.amount_cents)),
        forma: { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', outro: 'Outro' }[method] ?? 'Outro',
      },
    }).catch(() => {});
  }
  return done;
}

/** Atualiza a cobrança com o que o Pagar.me diz agora (consulta o pedido na API). */
export async function syncPayment(id) {
  const payment = await paymentRow(id);
  if (!payment) throw new HttpError(404, 'Pagamento não encontrado.');
  if (!payment.provider_order_id) return presentPayment(payment);

  const order = await getOrder(payment.provider_order_id);
  const charges = order?.charges ?? [];
  const paidCharge = charges.find((c) => c.status === 'paid');

  if (paidCharge && payment.status !== 'paid') {
    await settle(payment, order, paidCharge);
  } else if (payment.status === 'paid') {
    // Já quitado aqui; se o Pagar.me estornou depois, avisa a administração (não desfazemos a baixa sozinhos).
    if (!paidCharge && charges.some((c) => c.status === 'canceled')) {
      await db.run('UPDATE online_payments SET needs_review = 1, note = ?, last_event = ?, updated_at = ? WHERE id = ?', [
        'Este pagamento foi estornado ou cancelado no Pagar.me. Reabra a cobrança no Financeiro, se for o caso.', 'refunded', nowStamp(), payment.id,
      ]);
    }
  } else if (order?.status === 'canceled') {
    await db.run("UPDATE online_payments SET status = 'canceled', last_event = 'canceled', updated_at = ? WHERE id = ?", [nowStamp(), payment.id]);
  } else if (order?.status === 'failed') {
    // O cliente pode tentar de novo no mesmo link; só registramos a falha.
    await db.run("UPDATE online_payments SET last_event = 'failed', note = ?, updated_at = ? WHERE id = ?", ['Última tentativa de pagamento foi recusada.', nowStamp(), payment.id]);
  } else {
    await db.run('UPDATE online_payments SET last_event = ?, updated_at = ? WHERE id = ?', [String(order?.status ?? 'pending').slice(0, 40), nowStamp(), payment.id]);
  }
  return presentPayment(await paymentRow(id));
}

/** Evento do webhook → descobre a cobrança pelo pedido e sincroniza. Eventos de outros assuntos são ignorados. */
export async function handleWebhookEvent(event) {
  const type = String(event?.type || '');
  if (!/^(order|charge|checkout)\./.test(type)) return { handled: false, reason: 'ignored_event' };
  const data = event?.data ?? {};
  const orderId = type.startsWith('order.') ? data.id : data.order?.id ?? data.order_id ?? null;
  if (!orderId) return { handled: false, reason: 'no_order' };
  const row = await db.get('SELECT id FROM online_payments WHERE provider_order_id = ?', [String(orderId)]);
  if (!row) return { handled: false, reason: 'unknown_order' };
  await syncPayment(row.id);
  return { handled: true };
}

/* ---------------- pagamento da reserva dentro do popup (Pix / cartão) ---------------- */

const secondsUntil = (stamp) => Math.max(0, (Date.parse(`${stamp.replace(' ', 'T')}Z`) - Date.parse(`${nowLocal().stamp.replace(' ', 'T')}Z`)) / 1000);

/**
 * Cobra a reserva que está "segurada" aguardando pagamento. Pix devolve o QR code; cartão (já tokenizado
 * no navegador) é aprovado ou recusado na hora. Quando o pagamento cai, a reserva é confirmada.
 */
export async function payBookingDirect({ actor, bookingId, method, cardToken, installments = 1, document, phone }) {
  await releaseExpiredHolds();
  const rules = await getSettings();
  if (!onlinePaymentsReady(rules)) throw new HttpError(422, 'O pagamento online não está ativado.');
  const methods = String(rules.pagarme_methods || '').split(',');
  if (!['pix', 'credit_card'].includes(method) || !methods.includes(method)) throw new HttpError(422, 'Esta forma de pagamento não está disponível.');

  const row = await getBookingRow(bookingId);
  if (actor.role !== 'admin' && Number(row.user_id) !== Number(actor.id)) throw new HttpError(404, 'Reserva não encontrada.');
  if (row.payment_status === 'paid') throw new HttpError(409, 'Esta reserva já foi paga.');
  if (row.status !== 'pending' || !row.hold_until) throw new HttpError(422, 'O tempo para pagar esta reserva acabou. Escolha o horário de novo.');

  const price = Number(row.price_cents);
  if (price < MIN_CENTS) throw new HttpError(422, 'Não há valor a cobrar nesta reserva.');

  const doc = digits(document || '');
  if (!(isValidCpf(doc) || isValidCnpj(doc))) throw new HttpError(422, 'Informe um CPF ou CNPJ válido.');
  const ph = parsePhone(phone);
  if (!ph) throw new HttpError(422, 'Informe um celular com DDD.');
  if (method === 'credit_card') {
    if (!/^token_[A-Za-z0-9]+$/.test(String(cardToken || ''))) throw new HttpError(422, 'Não foi possível ler os dados do cartão. Tente de novo.');
    installments = Math.min(Math.max(1, Number(installments) || 1), Number(rules.pagarme_max_installments) || 1);
  }

  // Guarda CPF e telefone no cadastro para o próximo pagamento.
  await db.run('UPDATE users SET document = ?, phone = ?, updated_at = ? WHERE id = ?', [doc, `(${ph.area_code}) ${ph.number}`, nowStamp(), row.user_id]);

  // Pix já gerado e ainda válido para esta reserva: mostra o mesmo QR em vez de criar outro pedido.
  if (method === 'pix') {
    const open = await db.query(
      "SELECT id FROM online_payments WHERE kind = 'booking' AND user_id = ? AND status = 'pending' AND pix_qr_code IS NOT NULL AND expires_at > ? AND items LIKE ?",
      [row.user_id, nowLocal().stamp, `%"id":${Number(bookingId)},%`],
    );
    if (open.length) return syncPayment(open[0].id);
  }

  const description = `Reserva ${row.code} — ${row.room_name}, ${row.date.split('-').reverse().join('/')} ${row.start_time}`;
  const now = nowStamp();
  const created = await db.run(
    `INSERT INTO online_payments (user_id, kind, description, items, amount_cents, status, created_by, created_at, updated_at)
     VALUES (?, 'booking', ?, ?, ?, 'pending', ?, ?, ?)`,
    [row.user_id, description, JSON.stringify({ bookings: [{ id: Number(bookingId), part: 'price', cents: price }], receivables: [] }), price, actor.id, now, now],
  );
  const id = created.insertId;

  let order;
  try {
    order = await createDirectOrder({
      code: `HZ-${id}`,
      description,
      amount_cents: price,
      customer: {
        name: String(row.user_name).slice(0, 64),
        email: String(row.user_email).slice(0, 64),
        type: doc.length === 14 ? 'company' : 'individual',
        document: doc,
        document_type: doc.length === 14 ? 'CNPJ' : 'CPF',
        phones: { mobile_phone: ph },
      },
      method,
      cardToken,
      installments,
      expiresSeconds: Math.max(120, Math.floor(secondsUntil(row.hold_until))),
      metadata: { online_payment_id: String(id), booking_id: String(bookingId), user_id: String(row.user_id) },
      statementDescriptor: String(rules.business_name || 'HARMONIZEOSER').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    });
  } catch (err) {
    await db.run('DELETE FROM online_payments WHERE id = ?', [id]);
    throw err;
  }

  const charge = order?.charges?.[0];
  const tx = charge?.last_transaction;
  await db.run(
    'UPDATE online_payments SET provider_order_id = ?, provider_charge_id = ?, pix_qr_code = ?, expires_at = ?, updated_at = ? WHERE id = ?',
    [order.id, charge?.id ?? null, tx?.qr_code ?? null, method === 'pix' && tx?.expires_at ? localStampFromIso(tx.expires_at) : row.hold_until, nowStamp(), id],
  );

  if (method === 'credit_card' && (order.status === 'failed' || charge?.status === 'failed' || tx?.success === false)) {
    const why = tx?.acquirer_message || tx?.gateway_response?.errors?.[0]?.message || '';
    await db.run("UPDATE online_payments SET status = 'failed', note = ?, last_event = 'failed', updated_at = ? WHERE id = ?", [String(why).slice(0, 250) || 'Cartão recusado.', nowStamp(), id]);
    throw new HttpError(422, `Pagamento recusado${why ? `: ${why}` : '.'} Confira os dados ou use outro cartão.`);
  }

  return syncPayment(id); // confirma direto no Pagar.me; se já está pago, a reserva é confirmada aqui
}

/* ---------------- consultas ---------------- */

export async function listPayments({ status = 'all', limit = 100 } = {}) {
  const rows = await db.query(
    `SELECT p.*, u.name AS user_name, u.email AS user_email FROM online_payments p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT ?`,
    [Math.min(limit, 300)],
  );
  const list = rows.map(presentPayment);
  if (status === 'all') return list;
  if (status === 'review') return list.filter((p) => p.needs_review);
  return list.filter((p) => p.display_status === status);
}

export async function getPaymentFor(actor, id) {
  const row = await paymentRow(id);
  if (!row || (actor.role !== 'admin' && Number(row.user_id) !== Number(actor.id))) throw new HttpError(404, 'Pagamento não encontrado.');
  return row;
}

/** Situação da integração para a tela de configurações (nunca devolve a chave). */
export function gatewayStatus() {
  const token = config.pagarme.webhookToken;
  return {
    secret_key_configured: pagarmeConfigured(),
    mode: pagarmeMode(),
    public_key_configured: Boolean(config.pagarme.publicKey),
    webhook_token_configured: Boolean(token),
    webhook_url: token ? `${config.appUrl}/api/webhooks/pagarme/${token}` : null,
    api_url: config.pagarme.apiUrl,
  };
}
