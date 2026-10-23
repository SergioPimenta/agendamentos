import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Pagar.me de mentira (só o que a compra de pacote usa) ---------- */
const KEY = 'sk_test_mock_key';
const orders = new Map();
let nextOrder = 1;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/core/v5/orders') {
      const body = JSON.parse(raw);
      const id = `or_pkg${nextOrder++}`;
      const order = { id, code: body.code, amount: body.payments[0].amount, status: 'pending', charges: [], checkouts: [{ id: `chk_${id}`, status: 'open', payment_url: `https://pay.example.test/${id}` }] };
      orders.set(id, order);
      return send(200, order);
    }
    const m = url.pathname.match(/^\/core\/v5\/orders\/([^/]+)$/);
    if (req.method === 'GET' && m) return orders.has(m[1]) ? send(200, orders.get(m[1])) : send(404, { message: 'Order not found.' });
    send(404, { message: 'rota do mock não existe' });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

const payLastOrder = () => {
  const o = [...orders.values()].at(-1);
  o.status = 'paid';
  o.charges = [{ id: `ch_${o.id}`, status: 'paid', payment_method: 'pix', amount: o.amount, paid_amount: o.amount, paid_at: new Date().toISOString() }];
};

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.PAGARME_SECRET_KEY = KEY;
process.env.PAGARME_API_URL = `http://127.0.0.1:${mock.address().port}/core/v5`;
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { saveSettings } = await import('../services/settings.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let clientId;
let room;

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

/** Próxima data (>= n dias à frente) em que o espaço abre (segunda a sexta). */
const weekday = (n = 3) => {
  let d = addDays(nowLocal().date, n);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};
const book = (start, end, date = weekday(10)) =>
  call('POST', '/bookings', { token: client, body: { room_id: room.id, date, start_time: start, end_time: end, attendees: 1 } });
const balance = async () => (await call('GET', '/me/packages', { token: client })).body.balance;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Pacote', email: 'pacote@exemplo.com', password: 'senha-forte-1' } });
  client = reg.body.token;
  clientId = reg.body.user.id;
  room = (await call('GET', '/rooms')).body.rooms.find((r) => r.price_cents === 5500); // Cachoeira, R$ 55/h
});

after(() => { server.close(); mock.close(); });

describe('pacotes de horas', () => {
  let pkg;

  it('a administração cadastra e configura o pacote; o cliente só vê os ativos', async () => {
    const bad = await call('POST', '/admin/packages', { token: admin, body: { name: 'X', minutes: 5, price_cents: 1000 } });
    assert.equal(bad.status, 400);

    const created = await call('POST', '/admin/packages', {
      token: admin,
      body: {
        name: 'Pacote 4 horas', subtitle: 'Para começar', description: 'Quatro horas para usar quando quiser.', minutes: 240, price_cents: 18000,
        validity_days: 60, icon: 'sprout', featured: true, features: ['Use em qualquer sala', 'Vale por 60 dias'],
      },
    });
    assert.equal(created.status, 201);
    pkg = created.body.package;
    assert.equal(pkg.minutes, 240);
    assert.equal(pkg.validity_days, 60);
    assert.deepEqual(pkg.features, ['Use em qualquer sala', 'Vale por 60 dias']);

    const hidden = (await call('POST', '/admin/packages', { token: admin, body: { name: 'Pacote escondido', minutes: 60, price_cents: 5000, active: false } })).body.package;
    const list = await call('GET', '/me/packages', { token: client });
    assert.deepEqual(list.body.packages.map((p) => p.name), ['Pacote 4 horas']);
    assert.equal(list.body.balance.minutes_available, 0);
    assert.equal(list.body.online_payments, false);
    assert.equal((await call('POST', `/me/packages/${hidden.id}/purchase`, { token: client })).status, 404);

    const edited = await call('PUT', `/admin/packages/${pkg.id}`, { token: admin, body: { ...created.body.package, name: 'Pacote 4 horas', price_cents: 17000 } });
    assert.equal(edited.body.package.price_cents, 17000);
    await call('PUT', `/admin/packages/${pkg.id}`, { token: admin, body: { ...edited.body.package, price_cents: 18000 } });
  });

  it('só quem tem o módulo mexe nos pacotes', async () => {
    assert.equal((await call('GET', '/admin/packages', { token: client })).status, 403);
    const profiles = (await call('GET', '/admin/profiles', { token: admin })).body.profiles;
    const financeiro = profiles.find((p) => p.name === 'Financeiro').id; // não tem Pacotes de horas
    await call('POST', '/admin/users', { token: admin, body: { name: 'Fin', email: 'fin@exemplo.com', password: 'senha-forte-1', profile_id: financeiro } });
    const fin = (await call('POST', '/auth/login', { body: { email: 'fin@exemplo.com', password: 'senha-forte-1' } })).body.token;
    assert.equal((await call('GET', '/admin/packages', { token: fin })).status, 403);
  });

  it('comprar exige o pagamento online; pago, vira saldo com validade', async () => {
    const off = await call('POST', `/me/packages/${pkg.id}/purchase`, { token: client });
    assert.equal(off.status, 422);
    assert.match(off.body.message, /recepção/);

    await saveSettings({ pagarme_enabled: 'true' });
    const r = await call('POST', `/me/packages/${pkg.id}/purchase`, { token: client });
    assert.equal(r.status, 201);
    assert.match(r.body.payment.checkout_url, /^https:\/\/pay\.example\.test\//);
    assert.equal(r.body.payment.amount_cents, 18000);
    assert.equal((await balance()).minutes_available, 0); // ainda não pagou
    assert.equal((await call('GET', '/me/packages', { token: client })).body.pending_package_id, pkg.id);

    // Clicar de novo reaproveita o mesmo link.
    assert.equal((await call('POST', `/me/packages/${pkg.id}/purchase`, { token: client })).body.payment.id, r.body.payment.id);

    payLastOrder();
    const sync = await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client });
    assert.equal(sync.body.payment.status, 'paid');
    const b = await balance();
    assert.equal(b.minutes_available, 240);
    assert.equal(b.lots[0].expires_at, addDays(nowLocal().date, 60));

    // A venda entrou no Financeiro como conta a receber paga.
    const rec = await db.get("SELECT * FROM receivables WHERE category = 'Pacotes de horas'");
    assert.equal(rec.status, 'paid');
    assert.equal(Number(rec.amount_cents), 18000);
  });

  it('as horas compradas cobrem a reserva; o que passar do saldo é cobrado', async () => {
    const d = weekday(10);
    const first = await book('09:00', '11:00', d); // 2h, todas do pacote
    assert.equal(first.status, 201);
    const b1 = first.body.bookings[0];
    assert.equal(b1.package_minutes, 120);
    assert.equal(b1.price_cents, 0);
    assert.equal((await balance()).minutes_available, 120);

    const second = await book('13:00', '16:00', d); // 3h: 2h do pacote + 1h paga (R$ 55)
    const b2 = second.body.bookings[0];
    assert.equal(b2.package_minutes, 120);
    assert.equal(b2.price_cents, 5500);
    assert.equal((await balance()).minutes_available, 0);

    const third = await book('17:00', '18:00', d); // sem saldo: tudo pago
    assert.equal(third.body.bookings[0].package_minutes, 0);
    assert.equal(third.body.bookings[0].price_cents, 5500);

    // O orçamento (quote) também mostra o uso do saldo.
    await call('POST', `/bookings/${third.body.bookings[0].id}/cancel`, { token: client, body: {} });
    await call('POST', `/bookings/${b2.id}/cancel`, { token: client, body: {} });
    assert.equal((await balance()).minutes_available, 120); // cancelar devolve as horas
    const quote = await call('POST', '/bookings/quote', { token: client, body: { room_id: room.id, date: d, start_time: '14:00', end_time: '15:00' } });
    assert.equal(quote.body.package_minutes, 60);
    assert.equal(quote.body.price_cents, 0);
    assert.equal(quote.body.package_allocations, undefined);
  });

  it('usa primeiro a compra que vence antes e ignora a vencida', async () => {
    await db.run('DELETE FROM package_usage');
    await db.run('DELETE FROM package_purchases');
    const stamp = '2026-01-01 00:00:00';
    const add = async (minutes, expires) =>
      (await db.run(
        `INSERT INTO package_purchases (user_id, package_id, name, minutes_total, price_cents, status, paid_at, expires_at, created_at, updated_at)
         VALUES (?, NULL, 'Lote', ?, 0, 'paid', ?, ?, ?, ?)`,
        [clientId, minutes, stamp, expires, stamp, stamp],
      )).insertId;
    const forever = await add(60, null);
    const soon = await add(60, addDays(nowLocal().date, 30));
    await add(600, addDays(nowLocal().date, -1)); // vencido: não conta

    assert.equal((await balance()).minutes_available, 120);
    const r = await book('09:00', '10:30', weekday(21)); // 90 min: 60 do que vence primeiro + 30 do sem validade
    assert.equal(r.body.bookings[0].package_minutes, 90);
    const used = await db.query('SELECT purchase_id, minutes FROM package_usage ORDER BY purchase_id');
    assert.deepEqual(used.map((u) => [Number(u.purchase_id), Number(u.minutes)]), [[forever, 30], [soon, 60]]);

    // Uma data depois do vencimento não pode usar o lote que já terá vencido.
    const late = await call('POST', '/bookings/quote', { token: client, body: { room_id: room.id, date: weekday(45), start_time: '09:00', end_time: '10:00' } });
    assert.equal(late.body.package_minutes, 30); // só sobrou o sem validade (30 min)
  });

  it('a administração vende um pacote (pago no balcão) e ele entra no saldo e no Financeiro', async () => {
    const before = (await balance()).minutes_available;
    const g = await call('POST', '/admin/packages/grant', { token: admin, body: { user_id: clientId, package_id: pkg.id, method: 'dinheiro' } });
    assert.equal(g.status, 201);
    assert.equal((await balance()).minutes_available, before + 240);

    const list = await call('GET', '/admin/packages/purchases', { token: admin });
    const mine = list.body.purchases.find((p) => p.id === g.body.id);
    assert.equal(mine.user_name, 'Cliente Pacote');
    assert.equal(mine.minutes_left, 240);
    assert.equal(mine.status, 'paid');
    const rec = await db.get('SELECT * FROM receivables WHERE package_purchase_id = ?', [g.body.id]);
    assert.equal(rec.status, 'paid');
    assert.equal(rec.payment_method, 'dinheiro');
    assert.equal((await call('POST', '/admin/packages/grant', { token: admin, body: { user_id: 999999, package_id: pkg.id } })).status, 404);
  });

  it('o pacote pode valer só em algumas salas; o saldo só cobre reservas nelas', async () => {
    await db.run('DELETE FROM package_usage');
    await db.run('DELETE FROM package_purchases');
    const rooms = (await call('GET', '/admin/rooms', { token: admin })).body.rooms;
    const brisa = rooms.find((r) => r.name === 'Sala Brisa');
    const other = rooms.find((r) => r.id !== brisa.id && r.id !== room.id); // outra sala, fora do pacote
    const body = { name: 'Pacote Brisa', minutes: 120, price_cents: 6000, validity_days: 30, room_ids: [brisa.id, room.id] };

    // Sala que não existe é recusada; sem salas = vale em todas.
    assert.equal((await call('POST', '/admin/packages', { token: admin, body: { ...body, room_ids: [999999] } })).status, 400);
    const open = (await call('POST', '/admin/packages', { token: admin, body: { ...body, name: 'Pacote livre', room_ids: [] } })).body.package;
    assert.deepEqual(open.room_ids, []);
    assert.deepEqual(open.rooms, []);

    const created = await call('POST', '/admin/packages', { token: admin, body });
    assert.equal(created.status, 201);
    const pkg2 = created.body.package;
    assert.deepEqual(pkg2.room_ids.sort(), [brisa.id, room.id].sort());
    assert.deepEqual(pkg2.rooms.sort(), [brisa.name, room.name].sort());
    assert.deepEqual((await call('GET', '/me/packages', { token: client })).body.packages.find((p) => p.id === pkg2.id).rooms.sort(), [brisa.name, room.name].sort());

    await call('POST', '/admin/packages/grant', { token: admin, body: { user_id: clientId, package_id: pkg2.id } });
    const lot = (await call('GET', '/me/packages', { token: client })).body.balance.lots[0];
    assert.deepEqual(lot.rooms.sort(), [brisa.name, room.name].sort()); // o cliente vê onde o lote vale

    const date = weekday(14);
    const quote = (roomId) => call('POST', '/bookings/quote', { token: client, body: { room_id: roomId, date, start_time: '09:00', end_time: '10:00' } });
    assert.equal((await quote(room.id)).body.package_minutes, 60); // sala do pacote: coberta
    assert.equal((await quote(other.id)).body.package_minutes, 0); // fora do pacote: paga
    assert.ok((await quote(other.id)).body.price_cents > 0);

    // Mudar as salas do pacote depois não altera o que o cliente já comprou.
    await call('PUT', `/admin/packages/${pkg2.id}`, { token: admin, body: { ...body, room_ids: [other.id] } });
    assert.equal((await quote(room.id)).body.package_minutes, 60);
    assert.equal((await quote(other.id)).body.package_minutes, 0);

    // A administração enxerga a restrição de cada lote no banco de horas.
    const bankView = (await call('GET', '/admin/hour-bank', { token: admin })).body;
    assert.deepEqual(bankView.clients[0].lots[0].rooms.sort(), [brisa.name, room.name].sort());

    // O pacote do primeiro teste volta a ter uma venda (o próximo teste confere que ele não pode ser excluído).
    await call('POST', '/admin/packages/grant', { token: admin, body: { user_id: clientId, package_id: pkg.id } });
  });

  it('o pacote pode aparecer para todos os clientes ou só para alguns', async () => {
    await call('POST', '/auth/register', { body: { name: 'Outra Cliente', email: 'outra-cliente@exemplo.com', password: 'senha-forte-1' } });
    const other = (await call('POST', '/auth/login', { body: { email: 'outra-cliente@exemplo.com', password: 'senha-forte-1' } })).body.token;
    const otherId = (await db.get("SELECT id FROM users WHERE email = 'outra-cliente@exemplo.com'")).id;
    const base = { name: 'Pacote Exclusivo', minutes: 300, price_cents: 15000, validity_days: 30 };
    const names = async (token) => (await call('GET', '/me/packages', { token })).body.packages.map((p) => p.name);

    // Cliente que não existe é recusado.
    assert.equal((await call('POST', '/admin/packages', { token: admin, body: { ...base, client_ids: [999999] } })).status, 400);

    // Só para uma cliente: a administração vê o nome; as outras não veem nem compram.
    const created = await call('POST', '/admin/packages', { token: admin, body: { ...base, client_ids: [clientId] } });
    assert.equal(created.status, 201);
    const pkg3 = created.body.package;
    assert.deepEqual(pkg3.client_ids, [clientId]);
    assert.equal(pkg3.clients[0].id, clientId);
    assert.ok(pkg3.clients[0].name);
    assert.ok((await names(client)).includes('Pacote Exclusivo'));
    assert.ok(!(await names(other)).includes('Pacote Exclusivo'));
    assert.equal((await call('POST', `/me/packages/${pkg3.id}/purchase`, { token: other })).status, 404);
    assert.equal((await call('POST', `/me/packages/${pkg3.id}/purchase`, { token: client })).status, 201);

    // A administração pode registrar a venda para qualquer cliente, e o catálogo mostra a lista.
    assert.equal((await call('POST', '/admin/packages/grant', { token: admin, body: { user_id: otherId, package_id: pkg3.id } })).status, 201);
    const listed = (await call('GET', '/admin/packages', { token: admin })).body.packages.find((p) => p.id === pkg3.id);
    assert.deepEqual(listed.client_ids, [clientId]);

    // Voltar para "todos os clientes": aparece para as duas.
    const edited = await call('PUT', `/admin/packages/${pkg3.id}`, { token: admin, body: { ...base, client_ids: [] } });
    assert.deepEqual(edited.body.package.client_ids, []);
    assert.ok((await names(other)).includes('Pacote Exclusivo'));
  });

  it('pacote já vendido não é excluído, só desativado; baixa manual também credita', async () => {
    assert.equal((await call('DELETE', `/admin/packages/${pkg.id}`, { token: admin })).status, 409);

    // Compra pendente paga manualmente pela administração (Contas a receber) vira saldo.
    const p2 = (await call('POST', '/admin/packages', { token: admin, body: { name: 'Pacote 2 horas', minutes: 120, price_cents: 9000 } })).body.package;
    const r = await call('POST', `/me/packages/${p2.id}/purchase`, { token: client });
    assert.equal(r.status, 201);
    const rec = await db.get("SELECT id FROM receivables WHERE status = 'pending' AND package_purchase_id IS NOT NULL");
    const before = (await balance()).minutes_available;
    assert.equal((await call('POST', `/admin/finance/receivables/${rec.id}/pay`, { token: admin, body: { method: 'dinheiro' } })).status, 200);
    assert.equal((await balance()).minutes_available, before + 120);

    assert.equal((await call('DELETE', `/admin/packages/${(await call('POST', '/admin/packages', { token: admin, body: { name: 'Sem vendas', minutes: 60, price_cents: 1000 } })).body.package.id}`, { token: admin })).status, 200);
  });
});
