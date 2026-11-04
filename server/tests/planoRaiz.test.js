import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Pagar.me de mentira (só o que a compra usa) ---------- */
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
      const id = `or_raiz${nextOrder++}`;
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
process.env.PAGARME_SECRET_KEY = 'sk_test_mock_key';
process.env.PAGARME_API_URL = `http://127.0.0.1:${mock.address().port}/core/v5`;
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { migrate } = await import('../db/migrate.js');
const { saveSettings } = await import('../services/settings.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let client;
let clientId;
let raiz;

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
const weekday = (n = 5) => {
  let d = addDays(nowLocal().date, n);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};
const plans = async () => (await call('GET', '/me/plans', { token: client })).body;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Raiz', email: 'raiz@exemplo.com', password: 'senha-forte-1' } });
  client = reg.body.token;
  clientId = Number(reg.body.user.id);
  await saveSettings({ pagarme_enabled: 'true' });
  // O catálogo de demonstração não tem a Sala Mar (o site tem): cria aqui para a categoria "Premium Poltronas".
  await db.run("INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, buffer_minutes, active, sort_order, created_at) VALUES ('Sala Mar', 'mar', '', '', 4, 4950, '', '[]', 60, 480, 0, 1, 20, '2026-01-01 00:00:00')");
  // A migração do plano roda antes de existirem salas e planos de demonstração; aqui ela roda de novo, já com os dados.
  await db.run("DELETE FROM schema_migrations WHERE id = '029_plano_raiz_combos'");
  await migrate();
});
after(() => { server.close(); mock.close(); });

describe('Plano Raiz: combo de 4 horas por categoria de sala', () => {
  it('o plano mostra os 5 combos com valor fechado e as salas de cada categoria; eles não entram no catálogo de pacotes', async () => {
    raiz = (await plans()).plans.find((p) => p.name === 'Plano Raiz');
    assert.equal(raiz.price_cents, 0);
    assert.deepEqual(raiz.combos.map((c) => [c.name, c.price_cents, c.minutes, c.validity_days]), [
      ['Plano Raiz · Brisa', 11200, 240, 30],
      ['Plano Raiz · Flor', 13780, 240, 30],
      ['Plano Raiz · Premium Maca', 16000, 240, 30],
      ['Plano Raiz · Premium Poltronas', 18000, 240, 30],
      ['Plano Raiz · Cachoeira', 21850, 240, 30],
    ]);
    assert.deepEqual(raiz.combos[2].rooms.sort(), ['Sala Sol', 'Sala Terra']);
    assert.deepEqual(raiz.combos[3].rooms.sort(), ['Sala Mar', 'Sala Árvore'].sort());
    assert.equal(raiz.combo_cycle, null);

    const catalogo = (await call('GET', '/me/packages', { token: client })).body.packages;
    assert.ok(catalogo.every((p) => !p.name.startsWith('Plano Raiz')), 'combos de plano não são pacotes avulsos');
    assert.equal((await call('POST', `/me/packages/${raiz.combos[0].id}/purchase`, { token: client })).status, 404); // só pelo plano
  });

  it('contratar exige escolher a categoria; pago, o cliente entra no plano e ganha 4h por 30 dias só naquela categoria', async () => {
    assert.equal((await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client })).status, 422); // sem categoria
    assert.equal((await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client, body: { package_id: 999999 } })).status, 422);

    const brisa = raiz.combos[0];
    const r = await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client, body: { package_id: brisa.id } });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment.amount_cents, 11200);
    assert.equal((await plans()).current_plan_id === raiz.id, false); // ainda não pagou

    payLastOrder();
    assert.equal((await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client })).body.payment.status, 'paid');
    assert.equal(Number((await db.get('SELECT plan_id FROM users WHERE id = ?', [clientId])).plan_id), raiz.id);

    const bank = (await call('GET', '/me/packages', { token: client })).body.balance;
    assert.equal(bank.minutes_available, 240);
    assert.equal(bank.lots[0].expires_at, addDays(nowLocal().date, 30));
    assert.deepEqual(bank.lots[0].rooms, ['Sala Brisa']);

    // As horas cobrem reservas na Sala Brisa; em outra sala o cliente paga o valor da sala.
    const rooms = (await call('GET', '/rooms')).body.rooms;
    const brisaRoom = rooms.find((x) => x.name === 'Sala Brisa');
    const flor = rooms.find((x) => x.name === 'Sala Flor');
    const quote = (room) => call('POST', '/bookings/quote', { token: client, body: { room_id: room.id, date: weekday(), start_time: '09:00', end_time: '10:00' } });
    assert.equal((await quote(brisaRoom)).body.package_minutes, 60);
    assert.equal((await quote(flor)).body.package_minutes, 0);
  });

  it('os créditos não acumulam: não renova com horas sobrando no ciclo; renova quando o ciclo acaba', async () => {
    const cycle = (await plans()).plans.find((p) => p.id === raiz.id).combo_cycle;
    assert.equal(cycle.remaining, 240);
    assert.equal(cycle.expires_at, addDays(nowLocal().date, 30));

    const again = await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client, body: { package_id: raiz.combos[1].id } });
    assert.equal(again.status, 409);
    assert.match(again.body.message, /não acumulam/);

    // Ciclo vencido: pode contratar o próximo (inclusive em outra categoria), mesmo já estando no plano.
    await db.run("UPDATE package_purchases SET expires_at = ? WHERE status = 'paid'", [addDays(nowLocal().date, -1)]);
    assert.equal((await plans()).plans.find((p) => p.id === raiz.id).combo_cycle, null);
    const renew = await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client, body: { package_id: raiz.combos[1].id } });
    assert.equal(renew.status, 201);
    assert.equal(renew.body.payment.amount_cents, 13780);
  });
});
