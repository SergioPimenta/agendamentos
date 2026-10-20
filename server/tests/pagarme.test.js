import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Pagar.me de mentira: imita só o que o sistema usa ---------- */
const KEY = 'sk_test_mock_key';
const orders = new Map();
const received = []; // pedidos criados, como o Pagar.me os recebeu
let nextOrder = 1;
let rejectNext = false;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    if (auth !== `${KEY}:`) return send(401, { message: 'Authorization has been denied for this request.' });

    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/core/v5/orders') {
      if (rejectNext) { rejectNext = false; return send(422, { message: 'The request is invalid.', errors: { 'customer.email': ['O e-mail é inválido.'] } }); }
      const body = JSON.parse(raw);
      const id = `or_mock${nextOrder++}`;
      received.push({ id, body });
      const order = { id, code: body.code, amount: body.payments[0].amount, status: 'pending', charges: [], checkouts: [{ id: `chk_${id}`, status: 'open', payment_url: `https://pay.example.test/${id}` }] };
      orders.set(id, order);
      return send(200, order);
    }
    const m = url.pathname.match(/^\/core\/v5\/orders\/([^/]+)$/);
    if (req.method === 'GET' && m) return orders.has(m[1]) ? send(200, orders.get(m[1])) : send(404, { message: 'Order not found.' });
    if (req.method === 'GET' && url.pathname === '/core/v5/orders') return send(200, { data: [], paging: { total: 0 } });
    send(404, { message: 'rota do mock não existe' });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

const payOrder = (id, { method = 'pix', amount, paidAt = new Date().toISOString() } = {}) => {
  const o = orders.get(id);
  o.status = 'paid';
  o.charges = [{ id: `ch_${id}`, status: 'paid', payment_method: method, amount: amount ?? o.amount, paid_amount: amount ?? o.amount, paid_at: paidAt }];
};

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.PAGARME_SECRET_KEY = KEY;
process.env.PAGARME_API_URL = `http://127.0.0.1:${mock.address().port}/core/v5`;
process.env.PAGARME_WEBHOOK_TOKEN = 'whk_test_token_123';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { saveSettings } = await import('../services/settings.js');
const { nowLocal, nowStamp } = await import('../utils/time.js');
const { payInvoice } = await import('../services/finance.js');

let server;
let base;
let admin;
let client;
let other;
let me;
let rooms;
let codeN = 0;
const month = nowLocal().date.slice(0, 7);

const call = async (method, url, { token, body, raw } = {}) => {
  const res = await fetch(`${base}${raw ? '' : '/api'}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

const insertBooking = async ({ price = 10000, overtime = 0, day = '01', userId = me.id }) => {
  const date = `${month}-${day}`;
  const r = await db.run(
    `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
       total_minutes, included_minutes, price_cents, payment_status, overtime_minutes, overtime_cents, overtime_payment_status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, '10:00', '11:00', ?, ?, 'confirmed', '', '', 1, 60, 0, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [`P-${++codeN}-${Date.now() % 100000}`, rooms[0].id, userId, date, `${date} 10:00`, `${date} 11:00`, price, overtime ? 10 : 0, overtime, overtime ? 'pending' : 'none', userId, nowStamp(), nowStamp()],
  );
  return r.insertId;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1', } })).body.token;
  other = (await call('POST', '/auth/register', { body: { name: 'Outra Pessoa', email: 'outra@exemplo.com', password: 'senha-forte-2' } })).body.token;
  me = (await call('GET', '/auth/me', { token: client })).body.user;
  rooms = (await call('GET', '/rooms')).body.rooms;
});

after(() => { server.close(); mock.close(); });

describe('pagamento online (Pagar.me)', () => {
  it('fica desligado até a administração ativar', async () => {
    await insertBooking({ day: '01' });
    const r = await call('POST', '/payments', { token: client, body: { scope: 'month', month } });
    assert.equal(r.status, 422);
    assert.match(r.body.message, /não está ativado/);
    assert.equal((await call('GET', '/public')).body.settings.online_payments, false);
  });

  it('a tela de configuração vê o estado da integração sem receber a chave', async () => {
    const g = await call('GET', '/admin/finance/gateway', { token: admin });
    assert.equal(g.body.secret_key_configured, true);
    assert.equal(g.body.mode, 'test');
    assert.match(g.body.webhook_url, /\/api\/webhooks\/pagarme\/whk_test_token_123$/);
    assert.ok(!JSON.stringify(g.body).includes(KEY));
    assert.equal((await call('GET', '/admin/finance/gateway', { token: client })).status, 403);
    const t = await call('POST', '/admin/finance/gateway/test', { token: admin });
    assert.equal(t.status, 200);
  });

  it('gera o link da fatura com o valor em aberto e reaproveita o mesmo link', async () => {
    await saveSettings({ pagarme_enabled: 'true' });
    assert.equal((await call('GET', '/public')).body.settings.online_payments, true);
    await insertBooking({ price: 5000, overtime: 2000, day: '02' }); // 10000 + 5000 + 2000

    const a = await call('POST', '/payments', { token: client, body: { scope: 'month', month } });
    assert.equal(a.status, 201);
    assert.equal(a.body.payment.amount_cents, 17000);
    assert.equal(a.body.payment.status, 'pending');
    assert.match(a.body.payment.checkout_url, /^https:\/\/pay\.example\.test\/or_mock/);

    const sent = received.at(-1).body;
    assert.equal(sent.payments[0].payment_method, 'checkout');
    assert.equal(sent.payments[0].amount, 17000);
    assert.equal(sent.items[0].amount, 17000);
    assert.equal(sent.customer.name, 'Cliente Teste');
    assert.deepEqual(sent.payments[0].checkout.accepted_payment_methods, ['pix', 'credit_card', 'boleto']);
    assert.match(sent.payments[0].checkout.success_url, /\/app\/consumo\?pagamento=\d+$/);
    assert.equal(sent.payments[0].checkout.credit_card.installments.length, 1);
    assert.equal(sent.metadata.online_payment_id, String(a.body.payment.id));

    const before = received.length;
    const b = await call('POST', '/payments', { token: client, body: { scope: 'month', month } });
    assert.equal(b.body.payment.id, a.body.payment.id);
    assert.equal(received.length, before, 'não pode criar outro pedido no Pagar.me');
  });

  it('cliente só enxerga e confirma as próprias cobranças', async () => {
    const id = (await call('POST', '/payments', { token: client, body: { scope: 'month', month } })).body.payment.id;
    assert.equal((await call('GET', `/payments/${id}`, { token: other })).status, 404);
    assert.equal((await call('POST', `/payments/${id}/sync`, { token: other })).status, 404);
    assert.equal((await call('GET', `/payments/${id}`, { token: client })).status, 200);
    assert.equal((await call('POST', '/payments', { token: other, body: { scope: 'month', month } })).status, 422); // nada em aberto para ele
  });

  it('webhook: token errado é recusado e evento falso não dá baixa', async () => {
    assert.equal((await call('POST', '/webhooks/pagarme/token-errado', { body: { type: 'order.paid', data: { id: 'or_x' } }, raw: false })).status, 404);

    const open = (await call('GET', '/admin/finance/payments?status=pending', { token: admin })).body.payments[0];
    const orderId = (await db.get('SELECT provider_order_id FROM online_payments WHERE id = ?', [open.id])).provider_order_id;
    // Alguém forja um "order.paid", mas o pedido no Pagar.me continua pendente.
    const forged = await call('POST', '/webhooks/pagarme/whk_test_token_123', { body: { type: 'order.paid', data: { id: orderId, status: 'paid' } } });
    assert.equal(forged.status, 200);
    assert.equal((await db.get('SELECT status FROM online_payments WHERE id = ?', [open.id])).status, 'pending');
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND payment_status = 'paid'", [me.id])).n, 0);

    const unknown = await call('POST', '/webhooks/pagarme/whk_test_token_123', { body: { type: 'order.paid', data: { id: 'or_desconhecido' } } });
    assert.equal(unknown.body.handled, false);
    const ignored = await call('POST', '/webhooks/pagarme/whk_test_token_123', { body: { type: 'customer.created', data: {} } });
    assert.equal(ignored.body.reason, 'ignored_event');
  });

  it('pagamento confirmado no Pagar.me dá baixa nas reservas e entra no Financeiro', async () => {
    const pay = (await call('GET', '/admin/finance/payments?status=pending', { token: admin })).body.payments[0];
    const orderId = (await db.get('SELECT provider_order_id FROM online_payments WHERE id = ?', [pay.id])).provider_order_id;
    payOrder(orderId, { method: 'pix', paidAt: '2026-10-19T15:30:00Z' }); // 12:30 em Curitiba

    const hook = await call('POST', '/webhooks/pagarme/whk_test_token_123', { body: { type: 'charge.paid', data: { id: `ch_${orderId}`, order: { id: orderId } } } });
    assert.equal(hook.body.handled, true);

    const row = await db.get('SELECT * FROM online_payments WHERE id = ?', [pay.id]);
    assert.equal(row.status, 'paid');
    assert.equal(row.method, 'pix');
    assert.equal(row.paid_at, '2026-10-19 12:30:00');
    assert.equal(row.needs_review, 0);

    const bk = await db.query('SELECT payment_status, payment_method, paid_at, overtime_payment_status, overtime_payment_method FROM bookings WHERE user_id = ?', [me.id]);
    assert.ok(bk.every((b) => b.payment_status === 'paid' && b.payment_method === 'pix' && b.paid_at === '2026-10-19 12:30:00'));
    assert.ok(bk.some((b) => b.overtime_payment_status === 'paid' && b.overtime_payment_method === 'pix'));

    const inv = (await call('GET', '/admin/finance/receivables?status=paid', { token: admin })).body.rows.find((r) => r.month === month);
    assert.equal(inv.status, 'paid');
    const cash = (await call('GET', '/admin/finance/cashflow?from=2026-10-19&to=2026-10-19', { token: admin })).body;
    assert.ok(cash.movements.some((m) => m.type === 'in' && m.method === 'pix'));

    // Reenvio do mesmo evento não muda nada (idempotente).
    const again = await call('POST', '/webhooks/pagarme/whk_test_token_123', { body: { type: 'order.paid', data: { id: orderId } } });
    assert.equal(again.status, 200);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM online_payments WHERE status = ?', ['paid'])).n, 1);
  });

  it('valor pago menor que o cobrado não dá baixa e vai para revisão', async () => {
    await insertBooking({ price: 8000, day: '03' });
    const p = (await call('POST', '/payments', { token: client, body: { scope: 'booking', booking_id: (await db.get("SELECT id FROM bookings WHERE price_cents = 8000 AND user_id = ?", [me.id])).id } })).body.payment;
    const orderId = (await db.get('SELECT provider_order_id FROM online_payments WHERE id = ?', [p.id])).provider_order_id;
    payOrder(orderId, { method: 'boleto', amount: 5000 });
    const r = await call('POST', `/payments/${p.id}/sync`, { token: client });
    assert.equal(r.body.payment.status, 'pending');
    assert.equal(r.body.payment.needs_review, true);
    assert.match(r.body.payment.note, /Pago a menos/);
    assert.equal((await db.get("SELECT payment_status FROM bookings WHERE price_cents = 8000 AND user_id = ?", [me.id])).payment_status, 'pending');
  });

  it('pago online o que já estava quitado manualmente é sinalizado para a administração', async () => {
    const bid = await insertBooking({ price: 3000, day: '04' });
    const p = (await call('POST', '/payments', { token: client, body: { scope: 'booking', booking_id: bid } })).body.payment;
    await payInvoice({ userId: me.id, month, method: 'dinheiro' }); // a recepção recebeu em mãos antes
    const orderId = (await db.get('SELECT provider_order_id FROM online_payments WHERE id = ?', [p.id])).provider_order_id;
    payOrder(orderId, { method: 'credit_card' });
    const r = await call('POST', `/payments/${p.id}/sync`, { token: client });
    assert.equal(r.body.payment.status, 'paid');
    assert.equal(r.body.payment.needs_review, true);
    assert.match(r.body.payment.note, /já estavam quitadas/);
    assert.equal((await db.get('SELECT payment_method FROM bookings WHERE id = ?', [bid])).payment_method, 'dinheiro'); // não sobrescreve
  });

  it('administração gera o link de cobrança e vê a lista com filtro de revisão', async () => {
    const bid = await insertBooking({ price: 4000, day: '05' });
    const r = await call('POST', '/admin/finance/payments', { token: admin, body: { user_id: me.id, scope: 'booking', booking_id: bid } });
    assert.equal(r.status, 201);
    assert.ok(r.body.payment.checkout_url);
    const review = (await call('GET', '/admin/finance/payments?status=review', { token: admin })).body.payments;
    assert.ok(review.length >= 2);
    assert.ok(review.every((p) => p.needs_review));
    assert.equal((await call('POST', '/admin/finance/payments', { token: client, body: { user_id: me.id, scope: 'booking', booking_id: bid } })).status, 403);
  });

  it('recusa do Pagar.me vira erro claro e não deixa cobrança fantasma', async () => {
    const bid = await insertBooking({ price: 2500, day: '06' });
    rejectNext = true;
    const before = (await db.get('SELECT COUNT(*) AS n FROM online_payments')).n;
    const r = await call('POST', '/payments', { token: client, body: { scope: 'booking', booking_id: bid } });
    assert.equal(r.status, 502);
    assert.match(r.body.message, /e-mail é inválido/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM online_payments')).n, before);
  });

  it('cobrança abaixo de R$ 1,00 é recusada antes de chamar o Pagar.me', async () => {
    const bid = await insertBooking({ price: 50, day: '07' });
    const before = received.length;
    const r = await call('POST', '/payments', { token: client, body: { scope: 'booking', booking_id: bid } });
    assert.equal(r.status, 422);
    assert.equal(received.length, before);
  });
});
