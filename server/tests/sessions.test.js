import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { addMinutesAt, nowLocal, nowStamp } = await import('../utils/time.js');
const { autoCloseSessions } = await import('../services/sessions.js');

let server;
let base;
let admin;
let client;
let other;
let me;
let rooms;
let discount = 0;
let codeN = 0;

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

/** Cria uma reserva direto no banco, com horários relativos a "agora" (em minutos). */
const insertBooking = async ({ userId = me.id, roomId, startOffset, endOffset, status = 'confirmed', checkedInOffset = null }) => {
  const now = nowLocal();
  const startAt = addMinutesAt(now.at, startOffset);
  const endAt = addMinutesAt(now.at, endOffset);
  const checkedIn = checkedInOffset == null ? null : `${addMinutesAt(now.at, checkedInOffset)}:00`;
  const r = await db.run(
    `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
       total_minutes, included_minutes, price_cents, payment_status, created_by, created_at, updated_at, checked_in_at, check_in_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 1, ?, 0, 0, 'none', ?, ?, ?, ?, ?)`,
    [
      `T-${++codeN}-${Date.now() % 100000}`, roomId, userId, startAt.slice(0, 10), startAt.slice(11), endAt.slice(11), startAt, endAt, status,
      endOffset - startOffset, userId, nowStamp(), nowStamp(), checkedIn, checkedIn ? 'app' : null,
    ],
  );
  return r.insertId;
};

const get = async (id, token = client) => (await call('GET', `/bookings/${id}`, { token })).body.booking;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;

  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1' } })).body.token;
  other = (await call('POST', '/auth/register', { body: { name: 'Outra Pessoa', email: 'outra@exemplo.com', password: 'senha-forte-2' } })).body.token;
  me = (await call('GET', '/auth/me', { token: client })).body.user;
  rooms = (await call('GET', '/rooms', { token: client })).body.rooms;
  discount = (await call('GET', '/me/usage', { token: client })).body.plan?.room_discount_percent ?? 0;
});

after(() => server.close());

describe('check-in e check-out', () => {
  it('só libera o check-in dentro da janela e não deixa fazer duas vezes', async () => {
    const early = await insertBooking({ roomId: rooms[0].id, startOffset: 60, endOffset: 120 });
    const tooEarly = await call('POST', `/bookings/${early}/check-in`, { token: client });
    assert.equal(tooEarly.status, 422);
    assert.match(tooEarly.body.message, /abre às/);

    const ready = await insertBooking({ roomId: rooms[1].id, startOffset: 10, endOffset: 70 });
    assert.equal((await get(ready)).session.can_check_in, true);
    const ok = await call('POST', `/bookings/${ready}/check-in`, { token: client, body: { method: 'qr' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.booking.check_in_method, 'qr');
    assert.equal(ok.body.booking.session.can_check_out, true);
    assert.equal((await call('POST', `/bookings/${ready}/check-in`, { token: client })).status, 409);
  });

  it('não deixa outro cliente mexer na reserva, nem fazer check-in de reserva pendente', async () => {
    const id = await insertBooking({ roomId: rooms[2].id, startOffset: 5, endOffset: 65 });
    assert.equal((await call('POST', `/bookings/${id}/check-in`, { token: other })).status, 404);
    const pending = await insertBooking({ roomId: rooms[2].id, startOffset: 5, endOffset: 65, status: 'pending' });
    const r = await call('POST', `/bookings/${pending}/check-in`, { token: client });
    assert.equal(r.status, 422);
    assert.match(r.body.message, /aprovação/);
  });

  it('exige check-in antes do check-out e não cobra dentro da tolerância', async () => {
    const id = await insertBooking({ roomId: rooms[3].id, startOffset: -30, endOffset: 30 });
    assert.equal((await call('POST', `/bookings/${id}/check-out`, { token: client })).status, 422);
    assert.equal((await call('POST', `/bookings/${id}/check-in`, { token: client })).status, 200);
    const out = await call('POST', `/bookings/${id}/check-out`, { token: client });
    assert.equal(out.status, 200);
    assert.equal(out.body.booking.overtime_minutes, 0);
    assert.equal(out.body.booking.overtime_cents, 0);
    assert.equal(out.body.booking.session.state, 'done');
  });

  it('cobra o excedente por minuto, soma no extrato e a administração pode perdoar', async () => {
    const id = await insertBooking({ roomId: rooms[4].id, startOffset: -90, endOffset: -20, checkedInOffset: -90 });
    const preview = await call('GET', `/bookings/${id}/checkout-preview`, { token: client });
    assert.equal(preview.body.over_minutes, 20);

    const out = await call('POST', `/bookings/${id}/check-out`, { token: client });
    assert.equal(out.status, 200);
    const expected = Math.round(((rooms[4].price_cents * 20) / 60) * (1 - discount / 100));
    assert.ok(expected > 0, 'a sala de teste precisa ter preço para validar a cobrança');
    assert.equal(out.body.booking.overtime_minutes, 20);
    assert.equal(out.body.booking.overtime_cents, expected);
    assert.equal(out.body.booking.overtime_payment_status, 'pending');

    const usage = await call('GET', '/me/usage', { token: client });
    assert.ok(usage.body.totals.pending_cents >= expected);
    assert.ok(usage.body.totals.overtime_cents >= expected);

    const waived = await call('POST', `/admin/bookings/${id}/overtime`, { token: admin, body: { action: 'waive' } });
    assert.equal(waived.body.booking.overtime_cents, 0);
    assert.equal(waived.body.booking.overtime_payment_status, 'none');
  });

  it('a administração registra check-in e check-out fora da janela e pode perdoar o excedente', async () => {
    const id = await insertBooking({ roomId: rooms[0].id, startOffset: -240, endOffset: -180 });
    assert.equal((await call('POST', `/bookings/${id}/check-in`, { token: client })).status, 422);
    const inn = await call('POST', `/bookings/${id}/check-in`, { token: admin, body: {} });
    assert.equal(inn.status, 200);
    assert.equal(inn.body.booking.check_in_method, 'admin');
    const out = await call('POST', `/bookings/${id}/check-out`, { token: admin, body: { waive: true } });
    assert.equal(out.status, 200);
    assert.equal(out.body.booking.check_out_method, 'admin');
    assert.equal(out.body.booking.overtime_cents, 0);
    assert.ok(out.body.booking.overtime_minutes > 0);
  });

  it('encerra sozinho, sem excedente, quem esqueceu o check-out', async () => {
    const id = await insertBooking({ roomId: rooms[0].id, startOffset: -400, endOffset: -300, checkedInOffset: -400 });
    assert.ok((await autoCloseSessions()) >= 1);
    const b = await get(id);
    assert.equal(b.check_out_method, 'auto');
    assert.equal(b.overtime_cents, 0);
    assert.equal(b.session.state, 'done');
  });

  it('a página do QR mostra a reserva de quem escaneou e some para quem não tem', async () => {
    const room = rooms[1];
    const id = await insertBooking({ roomId: room.id, startOffset: 3, endOffset: 63 });
    const mine = await call('GET', `/rooms/${room.slug}/session`, { token: client });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.booking);
    assert.equal(mine.body.booking.session.can_check_in || mine.body.booking.session.can_check_out, true);
    const theirs = await call('GET', `/rooms/${room.slug}/session`, { token: other });
    assert.equal(theirs.body.booking, null);
    assert.equal((await call('GET', '/rooms/nao-existe/session', { token: client })).status, 404);
    assert.ok(id > 0);
  });

  it('o painel mostra a situação das salas e as reservas sem check-in', async () => {
    const live = await insertBooking({ roomId: rooms[2].id, startOffset: -20, endOffset: 40, checkedInOffset: -18 });
    const missed = await insertBooking({ roomId: rooms[3].id, startOffset: -300, endOffset: -240 });
    const dash = await call('GET', '/admin/dashboard', { token: admin });
    assert.equal(dash.status, 200);
    const r2 = dash.body.rooms_live.find((x) => x.room.id === rooms[2].id);
    assert.equal(r2.state, 'in_use');
    assert.ok(dash.body.rooms_live.every((x) => ['free', 'in_use', 'overtime', 'awaiting_checkin'].includes(x.state)));
    assert.ok(dash.body.no_checkin.some((b) => b.id === missed));
    assert.ok(!dash.body.no_checkin.some((b) => b.id === live));
  });
});
