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
      const id = `or_turno${nextOrder++}`;
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
let admin;
let client;
let clientId;
let plan;
let brisaRoom;
let solRoom;

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
const TUESDAY = 2;
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
const preview = (o) => call('GET', `/me/plans/${plan.id}/shift-preview?${q(o)}`, { token: client });
const myPlans = async () => (await call('GET', '/me/plans', { token: client })).body;
const firstTuesday = () => {
  let d = addDays(nowLocal().date, 1);
  while (weekdayOf(d) !== TUESDAY) d = addDays(d, 1);
  return d;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Turno', email: 'turno@exemplo.com', password: 'senha-forte-1' } });
  client = reg.body.token;
  clientId = Number(reg.body.user.id);
  await saveSettings({ pagarme_enabled: 'true' });
  // Espaço aberto das 07h às 22h todos os dias, para caber os três turnos.
  await db.run("UPDATE business_hours SET is_open = 1, open_time = '07:00', close_time = '22:00'");
  await db.run("INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, buffer_minutes, active, sort_order, created_at) VALUES ('Sala Mar', 'mar', '', '', 4, 4950, '', '[]', 60, 480, 0, 1, 20, '2026-01-01 00:00:00')");
  // A migração do turno fixo roda antes de existirem salas; aqui ela roda de novo, já com os dados.
  await db.run("DELETE FROM schema_migrations WHERE id = '030_turno_fixo'");
  await migrate();
  const rooms = (await call('GET', '/rooms')).body.rooms;
  brisaRoom = rooms.find((r) => r.name === 'Sala Brisa');
  solRoom = rooms.find((r) => r.name === 'Sala Sol');
});
after(() => { server.close(); mock.close(); });

describe('Turno Fixo (Acolhimento Premium)', () => {
  it('o plano mostra as 5 categorias com o valor mensal fechado, os turnos e os dias em que cada um cabe', async () => {
    const d = await myPlans();
    plan = d.plans.find((p) => p.name === 'Turno Fixo');
    assert.equal(plan.kind, 'shift');
    assert.deepEqual(plan.combos.map((c) => [c.name, c.price_cents]), [
      ['Turno Fixo · Brisa', 44000],
      ['Turno Fixo · Flor', 54250],
      ['Turno Fixo · Premium Maca', 62000],
      ['Turno Fixo · Premium Poltrona', 69750],
      ['Turno Fixo · Cachoeira', 85200],
    ]);
    assert.deepEqual(plan.combos[2].rooms.sort(), ['Sala Sol', 'Sala Terra']);
    assert.deepEqual(plan.shift.shifts.morning, { label: 'Manhã', start: '07:30', end: '12:00' });
    assert.deepEqual(plan.shift.shifts.night, { label: 'Noite', start: '18:00', end: '22:00' });
    assert.ok(plan.shift.availability.every((a) => a.shifts.morning && a.shifts.afternoon && a.shifts.night));
    assert.equal(plan.shift.cycle, null);
    const catalogo = (await call('GET', '/me/packages', { token: client })).body.packages;
    assert.ok(catalogo.every((p) => !p.name.startsWith('Turno Fixo')));
  });

  it('a prévia traz as 4 datas semanais do turno e aponta as que não estão livres; sala fora da categoria é recusada', async () => {
    const brisa = plan.combos[0];
    const ok = await preview({ package_id: brisa.id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.deepEqual([ok.body.amount_cents, ok.body.minutes, ok.body.window.start, ok.body.window.end], [44000, 1080, '07:30', '12:00']);
    assert.equal(ok.body.dates.length, 4);
    assert.equal(ok.body.dates[0].date, firstTuesday());
    assert.deepEqual(ok.body.dates.map((x) => weekdayOf(x.date)), [2, 2, 2, 2]);
    assert.equal(ok.body.dates[3].date, addDays(firstTuesday(), 21));

    assert.equal((await preview({ package_id: brisa.id, room_id: solRoom.id, weekday: TUESDAY, shift: 'morning' })).status, 422); // Sol não é da categoria Brisa

    // Uma data ocupada derruba a prévia só naquela data.
    const busy = ok.body.dates[2].date;
    await db.run(
      `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees, total_minutes, price_cents, payment_status, created_at, updated_at)
       VALUES ('HZ-OCUPADO', ?, ?, ?, '09:00', '10:00', ?, ?, 'confirmed', '', '', 1, 60, 0, 'none', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
      [brisaRoom.id, clientId, busy, `${busy} 09:00`, `${busy} 10:00`],
    );
    const clash = await preview({ package_id: brisa.id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning' });
    assert.deepEqual(clash.body.dates.map((x) => x.ok), [true, true, false, true]);
    assert.equal(clash.body.ok, false);
    const blocked = await call('POST', `/me/plans/${plan.id}/subscribe`, { token: client, body: { package_id: brisa.id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning' } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /não está livre em/);
    await db.run("DELETE FROM bookings WHERE code = 'HZ-OCUPADO'");
  });

  it('pago o primeiro mês, o sistema cria as 4 reservas semanais, o contrato e coloca o cliente no plano; o parceiro recebe o convite', async () => {
    const brisa = plan.combos[0];
    const body = { package_id: brisa.id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning', partner: { name: 'Dr. Parceiro', email: 'parceiro@exemplo.com' } };
    assert.equal((await call('POST', `/me/plans/${plan.id}/subscribe`, { token: client })).status, 422); // sem escolhas
    const r = await call('POST', `/me/plans/${plan.id}/subscribe`, { token: client, body });
    assert.equal(r.status, 201);
    assert.equal(r.body.payment.amount_cents, 44000);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM bookings WHERE title LIKE 'Turno fixo%'")).n), 0); // ainda não pagou

    payLastOrder();
    assert.equal((await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client })).body.payment.status, 'paid');
    await new Promise((resolve) => setTimeout(resolve, 400)); // a criação das reservas roda logo depois da baixa

    const list = await db.query("SELECT * FROM bookings WHERE title LIKE 'Turno fixo%' ORDER BY date");
    assert.equal(list.length, 4);
    assert.deepEqual(list.map((b) => b.date), Array.from({ length: 4 }, (_, i) => addDays(firstTuesday(), i * 7)));
    assert.ok(list.every((b) => b.start_time === '07:30' && b.end_time === '12:00' && b.status === 'confirmed' && Number(b.room_id) === Number(brisaRoom.id)));
    assert.ok(list.every((b) => Number(b.price_cents) === 0 && Number(b.package_minutes) === 270), 'as 4h30 de cada turno saem do crédito do ciclo');
    assert.equal(new Set(list.map((b) => b.series_id)).size, 1);

    assert.equal(Number((await db.get('SELECT plan_id FROM users WHERE id = ?', [clientId])).plan_id), plan.id);
    const contract = await db.get('SELECT * FROM contracts WHERE user_id = ?', [clientId]);
    assert.match(contract.kind, /Turno fixo · Manhã · Sala Brisa/);
    assert.equal(Number(contract.amount_cents), 44000);
    assert.equal(contract.period, 'Mensal');

    const guests = await db.query('SELECT email FROM client_guests WHERE user_id = ?', [clientId]);
    assert.ok(guests.some((g) => g.email === 'parceiro@exemplo.com'));
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM receivables WHERE category = 'Pacotes de horas' AND status = 'paid'")).n), 1);

    // O saldo do ciclo foi todo usado pelas 4 reservas.
    const bank = (await call('GET', '/me/packages', { token: client })).body.balance;
    assert.equal(bank.minutes_available, 0);
  });

  it('o ciclo em andamento impede nova contratação até faltar uma semana; depois a renovação segue a última reserva', async () => {
    const p = (await myPlans()).plans.find((x) => x.id === plan.id);
    assert.equal(p.shift.cycle.remaining_sessions, 4);
    assert.equal(p.shift.cycle.can_renew, false);
    assert.deepEqual(p.shift.cycle.slot, { room_id: Number(brisaRoom.id), weekday: TUESDAY, shift: 'morning' });
    const again = await preview({ package_id: plan.combos[0].id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning' });
    assert.equal(again.status, 409);
    assert.match(again.body.message, /renovação abre/);

    // Faltando uma semana, abre a renovação: começa na semana seguinte à última reserva.
    const last = addDays(firstTuesday(), 21);
    await db.run("UPDATE bookings SET status = 'cancelled' WHERE title LIKE 'Turno fixo%' AND date < ?", [last]);
    await db.run('UPDATE bookings SET date = ?, start_at = ?, end_at = ? WHERE title LIKE ? AND date = ?', [addDays(nowLocal().date, 3), `${addDays(nowLocal().date, 3)} 07:30`, `${addDays(nowLocal().date, 3)} 12:00`, 'Turno fixo%', last]);
    const renew = await preview({ package_id: plan.combos[0].id, room_id: brisaRoom.id, weekday: TUESDAY, shift: 'morning' });
    assert.equal(renew.status, 200);
    assert.equal(renew.body.renewal, true);
    assert.ok(renew.body.dates[0].date > addDays(nowLocal().date, 3));
    assert.equal(weekdayOf(renew.body.dates[0].date), TUESDAY);
  });
});
