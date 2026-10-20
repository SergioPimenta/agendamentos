import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let client;

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

const weekday = (n = 3) => {
  let d = addDays(nowLocal().date, n);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1' } })).body.token;
});

after(() => server.close());

describe('páginas públicas (sem login)', () => {
  it('visitante vê salas, planos, horários e disponibilidade', async () => {
    const rooms = await call('GET', '/rooms');
    assert.equal(rooms.status, 200);
    assert.ok(rooms.body.rooms.length > 0);
    assert.equal((await call('GET', '/plans')).status, 200);
    const settings = await call('GET', '/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.body.hours.length, 7);

    const day = await call('GET', `/availability/day?date=${weekday()}`);
    assert.equal(day.status, 200);
    assert.ok(day.body.rooms[0].slots.length > 0);
    const month = await call('GET', `/availability/month?month=${weekday().slice(0, 7)}`);
    assert.equal(month.status, 200);
  });

  it('a disponibilidade pública mostra o horário ocupado, mas nunca de quem é', async () => {
    const date = weekday(4);
    const room = (await call('GET', '/rooms')).body.rooms[0];
    const made = await call('POST', '/bookings', { token: client, body: { room_id: room.id, date, start_time: '10:00', end_time: '11:00', attendees: 1 } });
    assert.equal(made.status, 201);

    const anon = (await call('GET', `/availability/day?date=${date}&room_id=${room.id}`)).body.rooms[0].slots;
    const taken = anon.find((s) => s.time === '10:00');
    assert.equal(taken.state, 'booked');
    assert.ok(!taken.mine);
    assert.ok(!JSON.stringify(anon).includes('Cliente Teste'));

    const mine = (await call('GET', `/availability/day?date=${date}&room_id=${room.id}`, { token: client })).body.rooms[0].slots.find((s) => s.time === '10:00');
    assert.equal(mine.mine, true);
  });

  it('token vencido ou inválido é tratado como visitante, não como erro', async () => {
    assert.equal((await call('GET', '/rooms', { token: 'token-invalido' })).status, 200);
  });

  it('reservar, cotar e o resto continuam exigindo login', async () => {
    const date = weekday(5);
    const room = (await call('GET', '/rooms')).body.rooms[0];
    const body = { room_id: room.id, date, start_time: '14:00', end_time: '15:00', attendees: 1 };
    assert.equal((await call('POST', '/bookings', { body })).status, 401);
    assert.equal((await call('POST', '/bookings/quote', { body })).status, 401);
    assert.equal((await call('GET', '/bookings')).status, 401);
    assert.equal((await call('GET', `/rooms/${room.slug}/session`)).status, 401);
    assert.equal((await call('GET', '/me/usage')).status, 401);
  });
});
