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
      const id = `or_imersao${nextOrder++}`;
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
let plan;
let brisaRoom;

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
const FRIDAY = 5;
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
const preview = (o) => call('GET', `/me/plans/${plan.id}/shift-preview?${q(o)}`, { token: client });
const firstFriday = () => {
  let d = addDays(nowLocal().date, 1);
  while (weekdayOf(d) !== FRIDAY) d = addDays(d, 1);
  return d;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Imersão', email: 'imersao@exemplo.com', password: 'senha-forte-1' } })).body.token;
  await saveSettings({ pagarme_enabled: 'true' });
  await db.run("UPDATE business_hours SET is_open = 1, open_time = '07:00', close_time = '22:00'");
  await db.run("DELETE FROM schema_migrations WHERE id = '031_plano_imersao'");
  await migrate();
  brisaRoom = (await call('GET', '/rooms')).body.rooms.find((r) => r.name === 'Sala Brisa');
  plan = (await call('GET', '/me/plans', { token: client })).body.plans.find((p) => p.name === 'Plano Imersão');
});
after(() => { server.close(); mock.close(); });

describe('Administração das regras de contratação', () => {
  it('a administração ajusta turnos, dias, ciclo e categorias, e o cliente vê o novo desenho', async () => {
    const admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
    const view = await call('GET', `/admin/plans/${plan.id}/booking`, { token: admin });
    assert.equal(view.status, 200);
    assert.equal(view.body.shift_plan, true);
    assert.equal(view.body.categories.length, 10);
    assert.equal(view.body.config.sessions, 4);
    assert.equal((await call('GET', `/admin/plans/${plan.id}/booking`, { token: client })).status, 403);

    const cats = view.body.categories.map((c) => ({
      id: c.id, name: c.name, subtitle: c.subtitle, room_ids: c.room_ids, price_cents: c.id === view.body.categories[0].id ? 95000 : c.price_cents, shift_key: c.shift_key, active: c.active,
    }));
    const config = { sessions: 5, renew_days: 3, weekdays: [1, 2, 3, 4], shifts: view.body.config.shifts.map((s) => (s.key === 'commercial' ? { ...s, label: 'Comercial', end: '18:00' } : s)) };
    const bad = await call('PUT', `/admin/plans/${plan.id}/booking`, { token: admin, body: { config: { ...config, weekdays: [] }, categories: cats } });
    assert.equal(bad.status, 422);
    const saved = await call('PUT', `/admin/plans/${plan.id}/booking`, { token: admin, body: { config, categories: cats } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.categories[0].price_cents, 95000);
    assert.equal(saved.body.categories[0].minutes, 5 * 630); // 5 reservas × 10h30

    const now = (await call('GET', '/me/plans', { token: client })).body.plans.find((p) => p.id === plan.id);
    assert.equal(now.shift.sessions, 5);
    assert.deepEqual(now.shift.shifts.commercial, { label: 'Comercial', start: '07:30', end: '18:00' });
    assert.deepEqual(now.shift.availability.filter((a) => a.shifts.commercial).map((a) => a.weekday), [1, 2, 3, 4]);
    const sexta = await preview({ package_id: now.combos[0].id, room_id: brisaRoom.id, weekday: FRIDAY, shift: 'commercial' });
    assert.equal(sexta.status, 422); // sexta não é mais permitida
    const terca = await preview({ package_id: now.combos[0].id, room_id: brisaRoom.id, weekday: 2, shift: 'commercial' });
    assert.equal(terca.body.dates.length, 5);
    assert.equal(terca.body.amount_cents, 95000);

    // Volta ao padrão para os testes seguintes.
    const reset = { sessions: 4, renew_days: 7, weekdays: [0, 1, 2, 3, 4, 5, 6], shifts: view.body.config.shifts };
    const back = view.body.categories.map((c) => ({ id: c.id, name: c.name, subtitle: c.subtitle, room_ids: c.room_ids, price_cents: c.price_cents, shift_key: c.shift_key, active: c.active }));
    assert.equal((await call('PUT', `/admin/plans/${plan.id}/booking`, { token: admin, body: { config: reset, categories: back } })).status, 200);
  });
});

describe('Plano Imersão (dia fixo na semana)', () => {
  it('oferece horário comercial e integral, com o valor mensal de cada categoria', () => {
    assert.equal(plan.kind, 'immersion');
    assert.equal(plan.shift.mode, 'immersion');
    assert.deepEqual(Object.keys(plan.shift.shifts), ['commercial', 'full']);
    assert.deepEqual(plan.shift.shifts.commercial, { label: 'Horário comercial', start: '07:30', end: '18:30' });
    assert.deepEqual(plan.shift.shifts.full, { label: 'Integral diária', start: '07:00', end: '22:00' });
    const price = (key) => plan.combos.filter((c) => c.shift_key === key).map((c) => c.price_cents);
    assert.deepEqual(price('commercial'), [92000, 113000, 129000, 145000, 176500]);
    assert.deepEqual(price('full'), [112000, 138000, 157000, 176500, 215000]);
  });

  it('o pacote precisa ser do horário escolhido', async () => {
    const brisaFull = plan.combos.find((c) => c.shift_key === 'full' && c.subtitle === 'Sala Brisa');
    const brisaCom = plan.combos.find((c) => c.shift_key === 'commercial' && c.subtitle === 'Sala Brisa');
    assert.equal((await preview({ package_id: brisaFull.id, room_id: brisaRoom.id, weekday: FRIDAY, shift: 'commercial' })).status, 422);
    assert.equal((await preview({ package_id: brisaCom.id, room_id: brisaRoom.id, weekday: FRIDAY, shift: 'morning' })).status, 422);
    const ok = await preview({ package_id: brisaFull.id, room_id: brisaRoom.id, weekday: FRIDAY, shift: 'full' });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.amount_cents, ok.body.minutes, ok.body.window.start, ok.body.window.end], [112000, 3600, '07:00', '22:00']);
    assert.equal(ok.body.dates[0].date, firstFriday());
  });

  it('pago o mês, cria as 4 reservas do dia fixo e o contrato do Plano Imersão', async () => {
    const brisaCom = plan.combos.find((c) => c.shift_key === 'commercial' && c.subtitle === 'Sala Brisa');
    const r = await call('POST', `/me/plans/${plan.id}/subscribe`, { token: client, body: { package_id: brisaCom.id, room_id: brisaRoom.id, weekday: FRIDAY, shift: 'commercial' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment.amount_cents, 92000);
    payLastOrder();
    assert.equal((await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client })).body.payment.status, 'paid');
    await new Promise((resolve) => setTimeout(resolve, 400));

    const list = await db.query("SELECT * FROM bookings WHERE title LIKE 'Plano Imersão%' ORDER BY date");
    assert.equal(list.length, 4);
    assert.deepEqual(list.map((b) => b.date), Array.from({ length: 4 }, (_, i) => addDays(firstFriday(), i * 7)));
    assert.ok(list.every((b) => b.start_time === '07:30' && b.end_time === '18:30' && Number(b.price_cents) === 0 && Number(b.package_minutes) === 660));
    const contract = await db.get('SELECT * FROM contracts ORDER BY id DESC');
    assert.match(contract.kind, /Plano Imersão · Horário comercial · Sala Brisa/);
    assert.equal(Number(contract.amount_cents), 92000);
  });
});
