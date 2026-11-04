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
      const id = `or_diaria${nextOrder++}`;
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

const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
const preview = (o) => call('GET', `/me/plans/${plan.id}/shift-preview?${q(o)}`, { token: client });
const dayOut = (n) => addDays(nowLocal().date, n);

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Diária', email: 'diaria@exemplo.com', password: 'senha-forte-1' } })).body.token;
  await saveSettings({ pagarme_enabled: 'true' });
  await db.run("UPDATE business_hours SET is_open = 1, open_time = '07:00', close_time = '22:00'");
  await db.run("DELETE FROM schema_migrations WHERE id = '033_diaria_avulsa'");
  await migrate();
  brisaRoom = (await call('GET', '/rooms')).body.rooms.find((r) => r.name === 'Sala Brisa');
  plan = (await call('GET', '/me/plans', { token: client })).body.plans.find((p) => p.name === 'Diária Avulsa');
});
after(() => { server.close(); mock.close(); });

describe('Diária Avulsa (experiência de diária única)', () => {
  it('lista as 5 categorias com o valor da diária e o horário único das 07h às 22h', () => {
    assert.equal(plan.kind, 'daily');
    assert.equal(plan.shift.mode, 'daily');
    assert.equal(plan.shift.sessions, 1);
    assert.equal(plan.shift.cycle, null);
    assert.deepEqual(Object.keys(plan.shift.shifts), ['full']);
    assert.deepEqual(plan.combos.map((c) => c.price_cents), [32000, 39000, 45000, 51000, 62000]);
  });

  it('exige uma data futura e mostra a reserva única', async () => {
    const brisa = plan.combos[0];
    const wd = weekdayOf(dayOut(10));
    const base = { package_id: brisa.id, room_id: brisaRoom.id, weekday: wd, shift: 'full' };
    assert.equal((await preview(base)).status, 422); // sem data
    assert.equal((await preview({ ...base, date: nowLocal().date })).status, 422); // hoje não
    const ok = await preview({ ...base, date: dayOut(10) });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.dates.map((d) => d.date), [dayOut(10)]);
    assert.deepEqual([ok.body.amount_cents, ok.body.minutes, ok.body.window.start, ok.body.window.end], [32000, 900, '07:00', '22:00']);
  });

  it('pago, cria a reserva do dia, sem contrato, e dá para comprar outra diária em seguida', async () => {
    const brisa = plan.combos[0];
    const date = dayOut(10);
    const body = { package_id: brisa.id, room_id: brisaRoom.id, weekday: weekdayOf(date), shift: 'full', date };
    const r = await call('POST', `/me/plans/${plan.id}/subscribe`, { token: client, body });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment.amount_cents, 32000);
    payLastOrder();
    assert.equal((await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client })).body.payment.status, 'paid');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const list = await db.query("SELECT * FROM bookings WHERE title LIKE 'Diária avulsa%'");
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].date, list[0].start_time, list[0].end_time, Number(list[0].price_cents)], [date, '07:00', '22:00', 0]);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM contracts')).n), 0);
    const outra = await preview({ package_id: brisa.id, room_id: brisaRoom.id, weekday: weekdayOf(dayOut(11)), shift: 'full', date: dayOut(11) });
    assert.equal(outra.status, 200);
    const mesmaData = await preview({ package_id: brisa.id, room_id: brisaRoom.id, weekday: weekdayOf(date), shift: 'full', date });
    assert.equal(mesmaData.body.ok, false); // a sala já está ocupada nesse dia
  });
});