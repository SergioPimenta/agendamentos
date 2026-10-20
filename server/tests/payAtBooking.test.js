import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Pagar.me de mentira (Pix e cartão tokenizado) ---------- */
const KEY = 'sk_test_mock_key_direct';
const orders = new Map();
const received = [];
let nextOrder = 1;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    if (auth !== `${KEY}:`) return send(401, { message: 'Authorization has been denied for this request.' });
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/core/v5/orders') {
      const body = JSON.parse(raw);
      const pay = body.payments[0];
      const id = `or_direct${nextOrder++}`;
      const amount = pay.amount ?? body.items.reduce((a, i) => a + i.amount * i.quantity, 0);
      received.push({ id, body });
      let order;
      if (pay.payment_method === 'pix') {
        order = {
          id, code: body.code, amount, status: 'pending',
          charges: [{ id: `ch_${id}`, status: 'pending', payment_method: 'pix', amount, last_transaction: { status: 'waiting_payment', qr_code: `00020101021226PIX${id}`, qr_code_url: `https://pagarme.test/qr/${id}.png`, expires_at: new Date(Date.now() + pay.pix.expires_in * 1000).toISOString() } }],
        };
      } else if (pay.credit_card.card_token === 'token_denied') {
        order = { id, code: body.code, amount, status: 'failed', charges: [{ id: `ch_${id}`, status: 'failed', payment_method: 'credit_card', amount, last_transaction: { status: 'not_authorized', success: false, acquirer_message: 'Cartão sem limite disponível' } }] };
      } else {
        order = { id, code: body.code, amount, status: 'paid', charges: [{ id: `ch_${id}`, status: 'paid', payment_method: 'credit_card', amount, paid_amount: amount, paid_at: new Date().toISOString(), last_transaction: { status: 'captured', success: true } }] };
      }
      orders.set(id, order);
      return send(200, order);
    }
    const m = url.pathname.match(/^\/core\/v5\/orders\/([^/]+)$/);
    if (req.method === 'GET' && m) return orders.has(m[1]) ? send(200, orders.get(m[1])) : send(404, { message: 'Order not found.' });
    send(404, { message: 'rota do mock não existe' });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

const payPix = (orderId) => {
  const o = orders.get(orderId);
  o.status = 'paid';
  o.charges[0] = { ...o.charges[0], status: 'paid', paid_amount: o.amount, paid_at: new Date().toISOString(), last_transaction: { ...o.charges[0].last_transaction, status: 'paid' } };
};

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.PAGARME_SECRET_KEY = KEY;
process.env.PAGARME_PUBLIC_KEY = 'pk_test_mock_public';
process.env.PAGARME_API_URL = `http://127.0.0.1:${mock.address().port}/core/v5`;
process.env.PAGARME_WEBHOOK_TOKEN = 'whk_direct_token';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { saveSettings } = await import('../services/settings.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let other;
let me;
let rooms;
let dayOffset = 3;

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

/** Próximo dia útil, diferente a cada chamada, para os testes não colidirem. */
const nextDay = () => {
  let d = addDays(nowLocal().date, dayOffset++);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};

const CPF = '529.982.247-25';
const PHONE = '(41) 99999-0001';

const book = async (over = {}, token = client) => {
  const body = { room_id: rooms[0].id, date: nextDay(), start_time: '10:00', end_time: '11:00', attendees: 1, ...over };
  const r = await call('POST', '/bookings', { token, body });
  return { ...r, booking: r.body.bookings?.[0], date: body.date };
};

const payWithPix = (bookingId, over = {}) => call('POST', '/payments/booking', { token: client, body: { booking_id: bookingId, method: 'pix', document: CPF, phone: PHONE, ...over } });
const payWithCard = (bookingId, token, over = {}) => call('POST', '/payments/booking', { token: client, body: { booking_id: bookingId, method: 'credit_card', card_token: token, installments: 1, document: CPF, phone: PHONE, ...over } });
const orderOf = async (paymentId) => (await db.get('SELECT provider_order_id FROM online_payments WHERE id = ?', [paymentId])).provider_order_id;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1' } })).body.token;
  other = (await call('POST', '/auth/register', { body: { name: 'Outra Pessoa', email: 'outra@exemplo.com', password: 'senha-forte-2' } })).body.token;
  me = (await call('GET', '/auth/me', { token: client })).body.user;
  rooms = (await call('GET', '/rooms')).body.rooms;
});

after(() => { server.close(); mock.close(); });

describe('pagamento no ato da reserva', () => {
  it('desligado: a reserva confirma na hora, como sempre', async () => {
    await saveSettings({ pagarme_enabled: 'true', pagarme_methods: 'pix,credit_card', pay_on_booking: 'false' });
    const r = await book({ start_time: '08:00', end_time: '09:00' });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment_required, false);
    assert.equal(r.booking.status, 'confirmed');
    assert.equal(r.booking.awaiting_payment, false);
    assert.equal((await call('GET', '/payments/config', { token: client })).body.pay_on_booking, false);
  });

  it('ligado: a configuração mostra as formas e a chave pública para o popup', async () => {
    await saveSettings({ pay_on_booking: 'true', booking_hold_minutes: '15' });
    const c = (await call('GET', '/payments/config', { token: client })).body;
    assert.equal(c.pay_on_booking, true);
    assert.deepEqual(c.methods, ['pix', 'credit_card']);
    assert.equal(c.public_key, 'pk_test_mock_public');
    assert.equal(c.hold_minutes, 15);
    assert.equal((await call('GET', '/public')).body.settings.pay_on_booking, true);
  });

  it('o cliente reserva e o horário fica segurado, aguardando pagamento', async () => {
    const r = await book({ start_time: '10:00', end_time: '11:00' });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment_required, true);
    assert.equal(r.booking.status, 'pending');
    assert.equal(r.booking.awaiting_payment, true);
    assert.ok(r.booking.hold_until);

    // ninguém mais consegue o mesmo horário, e ele aparece como ocupado para visitantes
    const day = (await call('GET', `/availability/day?date=${r.date}&room_id=${rooms[0].id}`)).body.rooms[0].slots.find((s) => s.time === '10:00');
    assert.equal(day.state, 'booked');
    assert.equal((await book({ start_time: '10:00', end_time: '11:00', date: r.date }, other)).status, 409);

    // não é "aprovação": o painel não conta e a recepção não pode aprovar
    assert.equal((await call('GET', '/admin/dashboard', { token: admin })).body.kpis.pending_approvals, 0);
    const approve = await call('POST', `/admin/bookings/${r.booking.id}/status`, { token: admin, body: { status: 'confirmed' } });
    assert.equal(approve.status, 422);
    assert.match(approve.body.message, /aguarda o pagamento/);
  });

  it('reserva da recepção e reserva recorrente não passam pelo pagamento na hora', async () => {
    const date = nextDay();
    const viaAdmin = await call('POST', '/bookings', { token: admin, body: { room_id: rooms[1].id, user_id: me.id, date, start_time: '14:00', end_time: '15:00', attendees: 1 } });
    assert.equal(viaAdmin.body.payment_required, false);
    assert.equal(viaAdmin.body.bookings[0].status, 'confirmed');

    const weekly = await book({ room_id: rooms[2].id, start_time: '16:00', end_time: '17:00', repeat_weeks: 2 });
    assert.equal(weekly.body.payment_required, false);
    assert.equal(weekly.body.bookings.length, 3);
    assert.ok(weekly.body.bookings.every((b) => b.status === 'confirmed'));
  });

  it('Pix: valida CPF e celular, devolve o QR code e reaproveita o mesmo pedido', async () => {
    const { booking } = await book({ room_id: rooms[3].id, start_time: '09:00', end_time: '10:00' });
    assert.equal((await payWithPix(booking.id, { document: '111.111.111-11' })).status, 422);
    assert.equal((await payWithPix(booking.id, { phone: '123' })).status, 422);

    const r = await payWithPix(booking.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.payment.status, 'pending');
    assert.match(r.body.payment.pix_qr_code, /^00020101/);
    assert.equal(r.body.booking.status, 'pending');

    const sent = received.at(-1).body;
    assert.equal(sent.payments[0].payment_method, 'pix');
    assert.equal(sent.payments[0].pix.expires_in >= 120, true);
    assert.equal(sent.customer.document, '52998224725');
    assert.equal(sent.customer.document_type, 'CPF');
    assert.equal(sent.customer.phones.mobile_phone.area_code, '41');
    assert.equal(sent.items[0].amount, Number(rooms[3].price_cents));

    const before = received.length;
    const again = await payWithPix(booking.id);
    assert.equal(again.body.payment.id, r.body.payment.id);
    assert.equal(received.length, before, 'não pode gerar outro Pix');

    // CPF e telefone ficam no cadastro para a próxima vez
    const u = (await call('GET', '/auth/me', { token: client })).body.user;
    assert.equal(u.document, '52998224725');
  });

  it('Pix pago: a confirmação do Pagar.me confirma a reserva', async () => {
    const { booking } = await book({ room_id: rooms[4].id, start_time: '09:00', end_time: '10:00' });
    const p = (await payWithPix(booking.id)).body.payment;
    const orderId = await orderOf(p.id);

    const waiting = await call('POST', `/payments/${p.id}/sync`, { token: client });
    assert.equal(waiting.body.payment.status, 'pending');
    assert.equal(waiting.body.booking.status, 'pending');

    payPix(orderId);
    const done = await call('POST', `/payments/${p.id}/sync`, { token: client });
    assert.equal(done.body.payment.status, 'paid');
    assert.equal(done.body.booking.status, 'confirmed');
    assert.equal(done.body.booking.awaiting_payment, false);
    assert.equal(done.body.booking.payment_status, 'paid');
    const row = await db.get('SELECT payment_method, paid_at, hold_until FROM bookings WHERE id = ?', [booking.id]);
    assert.equal(row.payment_method, 'pix');
    assert.ok(row.paid_at);
    assert.equal(row.hold_until, null);

    // entra no fluxo de caixa
    const cash = (await call('GET', `/admin/finance/cashflow?from=${nowLocal().date}&to=${nowLocal().date}`, { token: admin })).body;
    assert.ok(cash.movements.some((m) => m.type === 'in' && m.method === 'pix'));
  });

  it('cartão: recusado mantém o horário segurado; aprovado confirma na hora', async () => {
    const { booking } = await book({ room_id: rooms[5].id, start_time: '09:00', end_time: '10:00' });
    assert.equal((await payWithCard(booking.id, 'numero-do-cartao-cru')).status, 422); // só aceita token do Pagar.me

    const denied = await payWithCard(booking.id, 'token_denied');
    assert.equal(denied.status, 422);
    assert.match(denied.body.message, /Cartão sem limite disponível/);
    assert.equal((await call('GET', `/bookings/${booking.id}`, { token: client })).body.booking.status, 'pending');
    assert.equal((await db.get("SELECT status FROM online_payments WHERE description LIKE ? ORDER BY id DESC LIMIT 1", [`%${booking.code}%`])).status, 'failed');

    const ok = await payWithCard(booking.id, 'token_ok');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.payment.status, 'paid');
    assert.equal(ok.body.booking.status, 'confirmed');
    assert.equal((await db.get('SELECT payment_method FROM bookings WHERE id = ?', [booking.id])).payment_method, 'cartao');

    const sent = received.at(-1).body;
    assert.equal(sent.payments[0].credit_card.card_token, 'token_ok');
    assert.equal(sent.payments[0].credit_card.operation_type, 'auth_and_capture');
    assert.ok(sent.payments[0].credit_card.statement_descriptor.length <= 13);
    assert.equal((await payWithCard(booking.id, 'token_ok')).status, 409); // já pago
  });

  it('desistir libera o horário na hora, só para o dono e só enquanto não pago', async () => {
    const r = await book({ room_id: rooms[0].id, start_time: '12:00', end_time: '13:00' });
    assert.equal((await call('POST', `/bookings/${r.booking.id}/release-hold`, { token: other })).status, 404);
    const released = await call('POST', `/bookings/${r.booking.id}/release-hold`, { token: client });
    assert.equal(released.body.released, true);
    assert.equal((await call('GET', `/bookings/${r.booking.id}`, { token: client })).body.booking.status, 'cancelled');
    const slot = (await call('GET', `/availability/day?date=${r.date}&room_id=${rooms[0].id}`)).body.rooms[0].slots.find((s) => s.time === '12:00');
    assert.equal(slot.state, 'free');

    const paid = await book({ room_id: rooms[1].id, start_time: '12:00', end_time: '13:00' });
    await payWithCard(paid.booking.id, 'token_ok');
    assert.equal((await call('POST', `/bookings/${paid.booking.id}/release-hold`, { token: client })).body.released, false);
    assert.equal((await call('GET', `/bookings/${paid.booking.id}`, { token: client })).body.booking.status, 'confirmed');
  });

  it('prazo vencido: o horário volta a ficar livre e não dá mais para pagar', async () => {
    const r = await book({ room_id: rooms[2].id, start_time: '12:00', end_time: '13:00' });
    await db.run("UPDATE bookings SET hold_until = '2020-01-01 00:00:00' WHERE id = ?", [r.booking.id]);

    const slot = (await call('GET', `/availability/day?date=${r.date}&room_id=${rooms[2].id}`)).body.rooms[0].slots.find((s) => s.time === '12:00');
    assert.equal(slot.state, 'free');
    const row = await db.get('SELECT status, cancel_reason FROM bookings WHERE id = ?', [r.booking.id]);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancel_reason, 'Pagamento não concluído');

    const late = await payWithPix(r.booking.id);
    assert.equal(late.status, 422);
    assert.match(late.body.message, /O tempo para pagar/);
  });

  it('Pix pago depois que o horário foi liberado: não reativa a reserva e vai para revisão', async () => {
    const r = await book({ room_id: rooms[3].id, start_time: '12:00', end_time: '13:00' });
    const p = (await payWithPix(r.booking.id)).body.payment;
    const orderId = await orderOf(p.id);
    await call('POST', `/bookings/${r.booking.id}/release-hold`, { token: client });

    payPix(orderId);
    const hook = await call('POST', '/webhooks/pagarme/whk_direct_token', { body: { type: 'order.paid', data: { id: orderId } } }).catch(() => null);
    const sync = await call('POST', `/payments/${p.id}/sync`, { token: client });
    assert.equal(sync.body.payment.status, 'paid');
    assert.equal(sync.body.payment.needs_review, true);
    assert.match(sync.body.payment.note, /já tinha sido liberada/);
    assert.equal((await call('GET', `/bookings/${r.booking.id}`, { token: client })).body.booking.status, 'cancelled');
    assert.ok(hook === null || hook.status === 200 || hook.status === 404);
  });
});
