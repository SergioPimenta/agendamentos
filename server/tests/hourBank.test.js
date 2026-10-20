import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { grantPackage } = await import('../services/packages.js');
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

const weekday = (n = 3) => {
  let d = addDays(nowLocal().date, n);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};
const book = async (start, end, date = weekday(10)) => {
  const r = await call('POST', '/bookings', { token: client, body: { room_id: room.id, date, start_time: start, end_time: end, attendees: 1 } });
  assert.equal(r.status, 201);
  return r.body.bookings[0];
};
const markPaid = async (bookingId) => assert.equal((await call('POST', `/admin/bookings/${bookingId}/payment`, { token: admin, body: { payment_status: 'paid', method: 'pix' } })).status, 200);
const bank = async () => (await call('GET', '/me/packages', { token: client })).body.balance;
const overview = async () => (await call('GET', '/admin/hour-bank', { token: admin })).body;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Banco', email: 'banco@exemplo.com', password: 'senha-forte-1' } });
  client = reg.body.token;
  clientId = reg.body.user.id;
  room = (await call('GET', '/rooms')).body.rooms.find((r) => r.price_cents === 5500); // Cachoeira, R$ 55/h
});

after(() => server.close());

describe('banco de horas', () => {
  it('reserva paga e cancelada devolve as horas pagas como crédito, com a origem', async () => {
    const b = await book('09:00', '11:00'); // 2h pagas: R$ 110
    assert.equal(b.price_cents, 11000);
    await markPaid(b.id);

    const cancel = await call('POST', `/bookings/${b.id}/cancel`, { token: client, body: {} });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.credited_minutes, 120);

    const lots = (await bank()).lots;
    assert.equal(lots.length, 1);
    assert.equal(lots[0].source, 'cancellation');
    assert.equal(lots[0].remaining, 120);
    assert.equal(lots[0].name, `Reserva cancelada ${b.code}`);
    assert.equal(lots[0].origin_booking.code, b.code);
    assert.equal(lots[0].origin_booking.room, room.name);
    assert.equal(lots[0].expires_at, addDays(nowLocal().date, 90)); // validade padrão das horas devolvidas
  });

  it('reserva ainda não paga, ou já cancelada antes, não gera crédito', async () => {
    const unpaid = await book('13:00', '14:00');
    const r = await call('POST', `/bookings/${unpaid.id}/cancel`, { token: client, body: {} });
    assert.equal(r.body.credited_minutes, 0);
    assert.equal((await bank()).minutes_available, 120);
    // Cancelar de novo não é possível (e não duplica o crédito).
    assert.equal((await call('POST', `/bookings/${unpaid.id}/cancel`, { token: client, body: {} })).status, 422);
  });

  it('as horas do banco pagam a reserva seguinte, e só a parte paga em dinheiro é creditada ao cancelar', async () => {
    const d = weekday(11);
    const b = await book('09:00', '12:00', d); // 3h: 2h do banco + 1h paga (R$ 55)
    assert.equal(b.package_minutes, 120);
    assert.equal(b.price_cents, 5500);
    assert.equal((await bank()).minutes_available, 0);
    await markPaid(b.id);

    const cancel = await call('POST', `/bookings/${b.id}/cancel`, { token: client, body: {} });
    assert.equal(cancel.body.credited_minutes, 60); // só a hora paga; as 2h do banco voltam sozinhas
    const lots = (await bank()).lots;
    assert.equal((await bank()).minutes_available, 180);
    assert.deepEqual(lots.map((l) => [l.source, l.remaining]).sort(), [['cancellation', 120], ['cancellation', 60]]);
  });

  it('compra de pacote também entra no banco, junto das demais origens', async () => {
    const pkg = (await call('POST', '/admin/packages', { token: admin, body: { name: 'Pacote 2 horas', minutes: 120, price_cents: 9000, validity_days: 30 } })).body.package;
    await grantPackage({ actor: { id: 1 }, userId: clientId, packageId: pkg.id });
    const b = await bank();
    assert.equal(b.minutes_available, 300);
    assert.deepEqual([...new Set(b.lots.map((l) => l.source))].sort(), ['cancellation', 'package']);
    assert.equal(b.lots.find((l) => l.source === 'package').name, 'Pacote 2 horas');
  });

  it('a administração vê quem tem saldo e de onde vem cada lote', async () => {
    const o = await overview();
    assert.equal(o.totals.clients, 1);
    assert.equal(o.totals.minutes, 300);
    assert.deepEqual(o.totals.by_source, { package: 120, cancellation: 180, manual: 0 });
    const c = o.clients[0];
    assert.equal(c.name, 'Cliente Banco');
    assert.equal(c.email, 'banco@exemplo.com');
    assert.equal(c.minutes_available, 300);
    assert.equal(c.lots.length, 3);
    assert.ok(c.lots.every((l) => ['package', 'cancellation'].includes(l.source)));
  });

  it('crédito manual exige o motivo, aparece nas duas telas e pode ser revogado', async () => {
    const credit = (extra) => call('POST', '/admin/hour-bank/credit', { token: admin, body: { user_id: clientId, minutes: 60, ...extra } });
    assert.equal((await credit({})).status, 400);
    assert.equal((await credit({ note: 'ok' })).status, 400); // motivo curto demais
    assert.equal((await call('POST', '/admin/hour-bank/credit', { token: admin, body: { user_id: 999999, minutes: 60, note: 'Cortesia da casa' } })).status, 404);

    const ok = await credit({ note: 'Cortesia: sala indisponível no dia', validity_days: 15 });
    assert.equal(ok.status, 201);
    const mine = (await bank()).lots.find((l) => l.source === 'manual');
    assert.equal(mine.remaining, 60);
    assert.equal(mine.note, 'Cortesia: sala indisponível no dia');
    assert.equal(mine.expires_at, addDays(nowLocal().date, 15));
    assert.equal((await overview()).totals.by_source.manual, 60);

    const revoke = await call('POST', `/admin/hour-bank/lots/${ok.body.id}/revoke`, { token: admin });
    assert.equal(revoke.status, 200);
    assert.equal((await bank()).lots.some((l) => l.source === 'manual'), false);
    assert.equal((await call('POST', `/admin/hour-bank/lots/${ok.body.id}/revoke`, { token: admin })).status, 404);
  });

  it('a validade das horas devolvidas é configurável', async () => {
    // Um cliente novo, sem saldo, para que as reservas dos próximos testes tenham valor a cobrar.
    const reg = await call('POST', '/auth/register', { body: { name: 'Outro Cliente', email: 'outro-banco@exemplo.com', password: 'senha-forte-1' } });
    client = reg.body.token;
    clientId = reg.body.user.id;
    const s = (await call('GET', '/admin/settings', { token: admin })).body.settings;
    assert.equal(s.bank_credit_days, 90);
    const put = await call('PUT', '/admin/settings', { token: admin, body: { ...s, bank_credit_days: 30 } });
    assert.equal(put.status, 200);
    const b = await book('15:00', '16:00', weekday(13));
    await markPaid(b.id);
    await call('POST', `/bookings/${b.id}/cancel`, { token: client, body: {} });
    const lot = (await bank()).lots.find((l) => l.name === `Reserva cancelada ${b.code}`);
    assert.equal(lot.expires_at, addDays(nowLocal().date, 30));
    await call('POST', `/admin/hour-bank/lots/${lot.id}/revoke`, { token: admin }); // zera o banco para a próxima reserva ter valor
    await call('PUT', '/admin/settings', { token: admin, body: { ...s, bank_credit_days: 0 } });
    const b2 = await book('15:00', '16:00', weekday(14));
    await markPaid(b2.id);
    await call('POST', `/bookings/${b2.id}/cancel`, { token: client, body: {} });
    const lot2 = (await bank()).lots.find((l) => l.name === `Reserva cancelada ${b2.code}`);
    assert.equal(lot2.expires_at, null); // 0 = sem validade
    await call('POST', `/admin/hour-bank/lots/${lot2.id}/revoke`, { token: admin });
  });

  it('reativar a reserva cancelada retira o crédito que ela gerou, se ainda não foi usado', async () => {
    const d = weekday(20);
    const b = await book('09:00', '10:00', d);
    await markPaid(b.id);
    await call('POST', `/bookings/${b.id}/cancel`, { token: client, body: {} });
    const lotName = `Reserva cancelada ${b.code}`;
    assert.ok((await bank()).lots.some((l) => l.name === lotName));

    const back = await call('POST', `/admin/bookings/${b.id}/status`, { token: admin, body: { status: 'confirmed' } });
    assert.equal(back.status, 200);
    assert.equal((await bank()).lots.some((l) => l.name === lotName), false);
  });

  it('só quem tem o módulo Banco de horas acessa', async () => {
    assert.equal((await call('GET', '/admin/hour-bank', { token: client })).status, 403);
    const profiles = (await call('GET', '/admin/profiles', { token: admin })).body.profiles;
    const financeiro = profiles.find((p) => p.name === 'Financeiro').id;
    await call('POST', '/admin/users', { token: admin, body: { name: 'Fin', email: 'fin-banco@exemplo.com', password: 'senha-forte-1', profile_id: financeiro } });
    const fin = (await call('POST', '/auth/login', { body: { email: 'fin-banco@exemplo.com', password: 'senha-forte-1' } })).body.token;
    assert.equal((await call('GET', '/admin/hour-bank', { token: fin })).status, 403);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM package_purchases WHERE source = 'manual' AND status = 'paid'")).n), 0);
  });
});
