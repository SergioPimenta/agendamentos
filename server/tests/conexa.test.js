import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Conexa de mentira (só a listagem de reservas de sala) ---------- */
let apiBookings = [];
const apiCalls = [];
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  apiCalls.push({ path: url.pathname, auth: req.headers.authorization, offset: url.searchParams.get('offset') });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (url.pathname === '/api/v2/room/bookings') {
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const data = apiBookings.slice(offset, offset + limit);
    return res.end(JSON.stringify({ data, pagination: { limit, offset, hasNext: offset + limit < apiBookings.length } }));
  }
  res.end('{}');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.CONEXA_WEBHOOK_TOKEN = 'segredo-conexa-de-teste';
process.env.CONEXA_URL = `http://127.0.0.1:${mock.address().port}/api/v2`;
process.env.CONEXA_TOKEN = 'token-de-teste';
process.env.CONEXA_MIN_INTERVAL_MS = '0';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { addDays, nowLocal } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let clientId;
let brisa;

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const hook = (payload, token = 'segredo-conexa-de-teste') => call('POST', `/api/webhooks/conexa/${token}`, { body: payload });

const DAY = addDays(nowLocal().date, 12);
const iso = (d, t) => `${d}T${t}:00-03:00`;
const aviso = (over = {}) => ({
  bookingId: 5001,
  sale: { id: 9001, value: 104, seller: 'Luana' },
  type: 'room',
  place: { id: 2112, name: 'Sala Brisa' },
  customer: { id: '33', name: 'Cliente Conexa Ltda', emails: ['conexa@exemplo.com'] },
  person: { id: '5182', name: 'Michele Cerqueira' },
  notes: 'Reunião de equipe',
  isOnlinePayment: false,
  startTime: iso(DAY, '10:00'),
  finalTime: iso(DAY, '12:30'),
  ...over,
});
const bookingByLegacy = (id) => db.get('SELECT * FROM bookings WHERE legacy_id = ?', [String(id)]);

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  const reg = await call('POST', '/api/auth/register', { body: { name: 'Cliente Conexa', email: 'conexa@exemplo.com', password: 'senha-forte-1' } });
  client = reg.body.token;
  clientId = Number(reg.body.user.id);
  brisa = (await call('GET', '/api/rooms')).body.rooms.find((r) => r.name === 'Sala Brisa');
});
after(() => { server.close(); mock.close(); });

describe('Integração Conexa', () => {
  it('recusa o webhook com segredo errado e só o administrador vê a tela', async () => {
    assert.equal((await hook(aviso(), 'errado')).status, 404);
    assert.equal((await call('GET', '/api/admin/conexa/status', { token: client })).status, 403);
    const st = await call('GET', '/api/admin/conexa/status', { token: admin });
    assert.equal(st.status, 200);
    assert.equal(st.body.webhook.configured, true);
    assert.match(st.body.webhook.url, /\/api\/webhooks\/conexa\/segredo-conexa-de-teste$/);
    assert.equal(st.body.api.configured, true);
  });

  it('cliente ainda não cadastrado: registra o erro, responde 200 e reprocessa depois', async () => {
    const r = await hook(aviso({ customer: { id: '33', name: 'Cliente Conexa Ltda', emails: ['sem-cadastro@exemplo.com'] } }));
    assert.equal(r.status, 200); // a Conexa bloqueia o webhook depois de 5 falhas
    assert.equal(r.body.errors, 1);
    assert.equal(await bookingByLegacy(5001), undefined);
    const st = (await call('GET', '/api/admin/conexa/status', { token: admin })).body;
    assert.equal(st.pending_errors, 1);
    assert.match(st.events[0].message, /cliente nº 33/i);
    // O local foi guardado e a sala Brisa achada pelo nome.
    assert.equal(st.places[0].room_id, Number(brisa.id));
  });

  it('cadastro: com o código do cliente, cria a reserva; reprocessar o erro também funciona', async () => {
    await db.run('UPDATE users SET legacy_code = ? WHERE id = ?', ['33', clientId]);
    const st = (await call('GET', '/api/admin/conexa/status', { token: admin })).body;
    const retry = await call('POST', `/api/admin/conexa/events/${st.events[0].id}/retry`, { token: admin });
    assert.equal(retry.body.status, 'ok');
    const b = await bookingByLegacy(5001);
    assert.deepEqual([b.date, b.start_time, b.end_time, Number(b.room_id), Number(b.user_id), b.status, Number(b.price_cents), b.code], [DAY, '10:00', '12:30', Number(brisa.id), clientId, 'confirmed', 10400, 'L5001']);
    assert.match(b.notes, /Reunião de equipe/);
    assert.match(b.notes, /Michele Cerqueira/);

    // O mesmo aviso de novo não duplica.
    assert.equal((await hook(aviso())).body.created, 0);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM bookings WHERE legacy_id = '5001'")).n), 1);
  });

  it('edição muda horário e sala; a reserva aparece na agenda do cliente', async () => {
    const r = await hook(aviso({ startTime: iso(DAY, '14:00'), finalTime: iso(DAY, '16:00'), notes: 'Reunião remarcada' }));
    assert.equal(r.body.updated, 1);
    const b = await bookingByLegacy(5001);
    assert.deepEqual([b.start_time, b.end_time, Number(b.total_minutes)], ['14:00', '16:00', 120]);
    const mine = (await call('GET', '/api/bookings', { token: client })).body;
    assert.ok(JSON.stringify(mine).includes('14:00'), 'a reserva da Conexa aparece para o cliente');
  });

  it('cancelamento cancela a reserva; cancelar o que não existe só é ignorado', async () => {
    const r = await hook({ bookingId: 5001, cancellationReason: 'Reunião cancelada por motivos externos' });
    assert.equal(r.body.cancelled, 1);
    const b = await bookingByLegacy(5001);
    assert.equal(b.status, 'cancelled');
    assert.equal(b.cancel_reason, 'Reunião cancelada por motivos externos');
    assert.equal((await hook({ bookingId: 999999, cancellationReason: 'x' })).body.ignored, 1);
    // Reserva editada na Conexa depois de cancelada volta a valer.
    assert.equal((await hook(aviso())).body.updated, 1);
    assert.equal((await bookingByLegacy(5001)).status, 'confirmed');
  });

  it('local sem sala correspondente fica parado até a administração relacionar', async () => {
    const r = await hook(aviso({ bookingId: 5002, place: { id: 777, name: 'Auditório Novo' } }));
    assert.equal(r.body.errors, 1);
    assert.equal(await bookingByLegacy(5002), undefined);
    const put = await call('PUT', '/api/admin/conexa/places/777', { token: admin, body: { room_id: Number(brisa.id) } });
    assert.equal(put.status, 200);
    assert.equal(put.body.reprocessed, 1);
    assert.equal(Number((await bookingByLegacy(5002)).room_id), Number(brisa.id));
  });

  it('avisos de coworking e de outros eventos são ignorados sem erro', async () => {
    assert.equal((await hook(aviso({ bookingId: 5003, type: 'coworking' }))).body.ignored, 1);
    assert.equal((await hook({ customerId: 1, name: 'Cadastro de cliente' })).body.ignored, 1);
  });

  it('a API confere: cria o que faltou, corrige o que mudou e respeita a janela', async () => {
    const item = (id, day, start, end, extra = {}) => ({
      isActive: true, status: 'notBilled', bookingId: id, place: { id: 2112, name: 'Sala Brisa' }, customerId: 33, personId: 1,
      idRecurringBooking: null, notes: null, startTime: iso(day, start), finalTime: iso(day, end), isOnlinePayment: false, ...extra,
    });
    const d1 = addDays(nowLocal().date, 20);
    const old = addDays(nowLocal().date, -400);
    apiBookings = [
      item(6001, d1, '09:00', '10:00', { idRecurringBooking: 77 }),
      item(5001, DAY, '14:00', '16:00'), // igual ao que já temos
      item(5002, DAY, '08:00', '09:00'), // mudou de horário
      item(6002, old, '09:00', '10:00'), // fora da janela
      item(6003, d1, '11:00', '12:00', { isActive: false, cancellationReason: 'Desistiu' }), // cancelada que nunca chegou: ignorada
    ];
    apiCalls.length = 0;
    const r = await call('POST', '/api/admin/conexa/sync', { token: admin, body: { days_back: 7, days_ahead: 60 } });
    assert.equal(r.status, 202);
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!(await call('GET', '/api/admin/conexa/status', { token: admin })).body.syncing) break;
    }
    assert.ok(apiCalls.every((c) => c.auth === 'Bearer token-de-teste'));
    const novo = await bookingByLegacy(6001);
    assert.deepEqual([novo.date, novo.start_time, novo.series_id], [d1, '09:00', 'L77']);
    assert.equal((await bookingByLegacy(5002)).start_time, '08:00');
    assert.equal(await bookingByLegacy(6002), undefined);
    assert.equal(await bookingByLegacy(6003), undefined);
    const st = (await call('GET', '/api/admin/conexa/status', { token: admin })).body;
    assert.match(st.last_sync.message, /Lidas 5 reservas, 4 na janela/);
    assert.equal(st.last_sync.status, 'ok');
    assert.equal((await call('POST', '/api/admin/conexa/test', { token: admin })).body.ok, true);
  });
});
