import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { addDays, nowLocal, nowStamp, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let admin;
let me;
let rooms;
let monday;
let codeN = 0;

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const add = async (roomId, date, start, end, status = 'confirmed') => {
  const startAt = `${date} ${start}`;
  const endAt = `${date} ${end}`;
  const minutes = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)));
  await db.run(
    `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
       total_minutes, included_minutes, price_cents, payment_status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 1, ?, 0, 0, 'none', ?, ?, ?)`,
    [`R-${++codeN}-${Date.now() % 100000}`, roomId, me.id, date, start, end, startAt, endAt, status, minutes, me.id, nowStamp(), nowStamp()],
  );
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  me = (await call('GET', '/auth/me', { token: admin })).body.user;
  rooms = (await call('GET', '/rooms', { token: admin })).body.rooms;

  // uma segunda-feira passada e a semana inteira (seg → dom) a partir dela
  monday = addDays(nowLocal().date, -14);
  while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
  const tue = addDays(monday, 1);
  const wed = addDays(monday, 2);
  await add(rooms[0].id, tue, '10:00', '12:00'); // terça: passa pelas horas 10 e 11
  await add(rooms[0].id, tue, '14:00', '15:00');
  await add(rooms[0].id, wed, '10:00', '11:00');
  await add(rooms[0].id, wed, '16:00', '17:00', 'cancelled'); // cancelada não conta
  await add(rooms[1].id, wed, '09:00', '10:00'); // outra sala
});

after(() => server.close());

describe('relatório por sala: dia da semana e horário', () => {
  it('conta reservas e minutos por dia e por hora, só da sala, sem canceladas', async () => {
    const r = await call('GET', `/admin/reports?from=${monday}&to=${addDays(monday, 6)}`, { token: admin });
    assert.equal(r.status, 200);
    const room = r.body.by_room.find((x) => x.id === rooms[0].id);

    assert.equal(room.bookings, 3);
    const tue = room.by_weekday[2];
    assert.equal(tue.bookings, 2);
    assert.equal(tue.minutes, 180);
    assert.equal(room.by_weekday[3].bookings, 1); // quarta
    assert.equal(room.by_weekday[3].minutes, 60);
    assert.equal(room.by_weekday[0].bookings, 0); // domingo

    const h10 = room.by_hour.find((h) => h.hour === 10);
    assert.equal(h10.bookings, 2); // terça 10–12 e quarta 10–11
    assert.equal(h10.minutes, 120);
    assert.equal(room.by_hour.find((h) => h.hour === 11).bookings, 1); // só a de terça passa pela hora 11
    assert.equal(room.by_hour.find((h) => h.hour === 16).bookings, 0); // a cancelada não entra

    assert.equal(room.heat[2][10 - 6], 60); // terça, 10h
    assert.equal(room.heat[3][10 - 6], 60); // quarta, 10h
    assert.equal(room.heat[2][14 - 6], 60);
  });

  it('informa a capacidade (minutos abertos) de cada dia e hora para calcular a ocupação', async () => {
    const r = (await call('GET', `/admin/reports?from=${monday}&to=${addDays(monday, 6)}`, { token: admin })).body;
    const cap = r.heat_capacity;
    assert.equal(cap.hour_from, 6);
    assert.equal(cap.matrix[2][10 - 6], 60); // uma terça, aberta às 10h
    assert.equal(cap.matrix[2][7 - 6], 0); // antes de abrir (08h)
    assert.equal(cap.matrix[0].reduce((a, v) => a + v, 0), 0); // domingo fechado
    assert.equal(cap.matrix[6][9 - 6], 60); // sábado abre às 9h
    assert.equal(cap.matrix[6][14 - 6], 0); // sábado fecha às 13h

    const room = r.by_room.find((x) => x.id === rooms[0].id);
    assert.equal(room.by_weekday[2].capacity_minutes, 12 * 60); // terça: 08–20
    assert.equal(room.by_hour.find((h) => h.hour === 10).capacity_minutes, 6 * 60); // seg a sáb abertos às 10h
  });
});
