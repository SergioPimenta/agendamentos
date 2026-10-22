import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { nowLocal, addDays } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Fabiane Anfitriã', email: 'fabiane@exemplo.com', password: 'senha-forte-1' } })).body.token;
});
after(() => server.close());

const row = (n, extra = {}) => ({
  codigo: String(n), unidade: 'Coworking Harmonize o Ser', codigo_cliente: '30', cliente: 'Fabiane Anfitriã', anfitriao: 'Fabiane Anfitriã',
  nome: `Convidado ${n}`, email: `convidado${n}@exemplo.com`, data_convite: '2026-11-09', inicio: '14:00', fim: '17:00', vinculado: 'Sim', cadastro: '2026-10-01 19:49:00', ...extra,
});

describe('convidados dos clientes', () => {
  it('importa o relatório (prévia, gravação e repetição sem duplicar) ligando ao cliente pelo código antigo', async () => {
    const fab = await db.get('SELECT id FROM users WHERE email = ?', ['fabiane@exemplo.com']);
    await db.run("UPDATE users SET legacy_code = '30' WHERE id = ?", [fab.id]);
    const rows = [row(1), row(2, { codigo_cliente: '999', vinculado: 'Não' }), row(3, { email: 'invalido' })];

    const dry = await call('POST', '/admin/guests/import', { token: admin, body: { rows, dry_run: true } });
    assert.deepEqual([dry.body.created, dry.body.errors.length], [2, 1]);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM client_guests')).n), 0);

    const real = await call('POST', '/admin/guests/import', { token: admin, body: { rows } });
    assert.equal(real.body.created, 2);
    const list = await call('GET', '/admin/guests', { token: admin });
    assert.equal(list.body.total, 2);
    const g1 = list.body.guests.find((g) => g.legacy_id === '1');
    assert.deepEqual([g1.user_id, g1.name, g1.email, g1.host_name, g1.invite_date, g1.invite_start, g1.invite_end, g1.linked, g1.unit], [fab.id, 'Convidado 1', 'convidado1@exemplo.com', 'Fabiane Anfitriã', '2026-11-09', '14:00', '17:00', true, 'Coworking Harmonize o Ser']);
    const g2 = list.body.guests.find((g) => g.legacy_id === '2');
    assert.deepEqual([g2.user_id, g2.linked, g2.client_code], [null, false, '999']);

    const again = await call('POST', '/admin/guests/import', { token: admin, body: { rows: [row(1), row(2)] } });
    assert.deepEqual([again.body.created, again.body.skipped.length], [0, 2]);

    assert.equal((await call('GET', '/admin/guests', { token: admin, body: undefined })).status, 200);
    assert.equal((await call('GET', '/admin/guests?q=convidado2', { token: admin })).body.total, 1);
    assert.equal((await call('GET', `/admin/guests?user_id=${fab.id}`, { token: admin })).body.total, 1);
    assert.equal((await call('POST', '/admin/guests/import', { token: admin, body: { rows: [] } })).status, 400);
    assert.equal((await call('GET', '/admin/guests', { token: client })).status, 403);
  });

  it('toda reserva com convidados grava (e mantém atualizados) os convidados na seção', async () => {
    const rooms = (await call('GET', '/rooms', { token: client })).body.rooms;
    let date = addDays(nowLocal().date, 40);
    while ([0].includes(new Date(`${date}T12:00:00`).getDay())) date = addDays(date, 1); // sem domingo
    const book = await call('POST', '/bookings', { token: client, body: {
      room_id: rooms[0].id, date, start_time: '10:00', end_time: '11:00',
      guests: [{ name: 'Dona Maria', email: 'maria-reserva@exemplo.com' }, 'sem-nome-reserva@exemplo.com'],
    } });
    assert.equal(book.status, 201);
    const bid = book.body.bookings[0].id;

    let rows = (await call('GET', '/admin/guests?q=reserva@exemplo', { token: admin })).body.guests;
    assert.equal(rows.length, 2);
    const maria = rows.find((g) => g.email === 'maria-reserva@exemplo.com');
    assert.deepEqual([maria.name, maria.host_name, maria.client_name, maria.invite_date, maria.invite_start, maria.invite_end, maria.linked, maria.booking_id], ['Dona Maria', 'Fabiane Anfitriã', 'Fabiane Anfitriã', date, '10:00', '11:00', true, bid]);
    assert.equal(maria.unit, 'Coworking Harmonize o Ser');

    // Mudar horário e trocar um convidado: atualiza, inclui o novo e desvincula quem saiu.
    const edit = await call('PUT', `/bookings/${bid}`, { token: client, body: { start_time: '12:00', end_time: '13:00', guests: [{ name: 'Maria Souza', email: 'maria-reserva@exemplo.com' }, 'novo-reserva@exemplo.com'] } });
    assert.equal(edit.status, 200);
    rows = (await call('GET', '/admin/guests?q=reserva@exemplo', { token: admin })).body.guests;
    assert.equal(rows.length, 3); // nada se perde
    const byEmail = Object.fromEntries(rows.map((g) => [g.email, g]));
    assert.deepEqual([byEmail['maria-reserva@exemplo.com'].name, byEmail['maria-reserva@exemplo.com'].invite_start, byEmail['maria-reserva@exemplo.com'].linked], ['Maria Souza', '12:00', true]);
    assert.equal(byEmail['novo-reserva@exemplo.com'].linked, true);
    assert.equal(byEmail['sem-nome-reserva@exemplo.com'].linked, false);

    // Cancelar a reserva desvincula todos.
    await call('POST', `/bookings/${bid}/cancel`, { token: admin, body: {} });
    rows = (await call('GET', '/admin/guests?q=reserva@exemplo', { token: admin })).body.guests;
    assert.ok(rows.every((g) => g.linked === false));

    // Excluir um registro.
    assert.equal((await call('DELETE', `/admin/guests/${rows[0].id}`, { token: admin })).status, 200);
    assert.equal((await call('DELETE', `/admin/guests/${rows[0].id}`, { token: admin })).status, 404);
  });
});
