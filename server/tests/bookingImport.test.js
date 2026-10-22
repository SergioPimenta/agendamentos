import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');

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
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Comum', email: 'comum-res@exemplo.com', password: 'senha-forte-1' } })).body.token;
});
after(() => server.close());

const row = (n, extra = {}) => ({
  codigo: String(n), cadastrado_por: 'Mery Ellen', codigo_cliente: '168', cliente: 'Roberléia Costa Curta', pessoa: 'Roberléia', sala: 'Sala Sol',
  data: '2026-12-16', inicio: '13:30', fim: '16:00', duracao: '2h:30min', valor_centavos: 17000, origem: 'Avulsa', obs: '', status: 'Ativa', cobranca: 'Quitada', ...extra,
});

describe('importação de reservas do sistema anterior', () => {
  it('cria reservas reais, com cobrança, série e cancelamento, e confere salas e clientes que faltam', async () => {
    const u = await db.get('SELECT id FROM users WHERE email = ?', ['comum-res@exemplo.com']);
    await db.run("UPDATE users SET legacy_code = '168' WHERE id = ?", [u.id]);
    const sol = await db.get("SELECT id, name FROM rooms WHERE name = 'Sala Sol'");
    assert.ok(sol, 'a sala Sol precisa existir no catálogo padrão');

    const rows = [
      row(1),
      row(2, { cobranca: 'Não Faturada', origem: 'Recorrente (102)', data: '2026-12-17' }),
      row(3, { cobranca: 'Descontada de Cota', data: '2026-12-18' }),
      row(4, { status: 'Cancelada', cobranca: 'Cancelada', data: '2026-12-19' }),
      row(5, { sala: 'Sala Estrela (Sistema Modular)' }), // sala que não existe
      row(6, { codigo_cliente: '999', cliente: 'Quem Não Existe' }), // cliente que não existe
      row(7, { fim: '13:00' }), // término antes do início
    ];
    const dry = await call('POST', '/admin/bookings/import', { token: admin, body: { rows, dry_run: true } });
    assert.deepEqual([dry.body.created, dry.body.errors.length], [4, 3]);
    assert.deepEqual(dry.body.missing_rooms, { 'Sala Estrela (Sistema Modular)': 1 });
    assert.deepEqual(dry.body.missing_clients, { '999 - Quem Não Existe': 1 });
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM bookings')).n), 0);

    const real = await call('POST', '/admin/bookings/import', { token: admin, body: { rows } });
    assert.equal(real.body.created, 4);
    const all = await db.query('SELECT * FROM bookings ORDER BY legacy_id');
    assert.equal(all.length, 4);
    const [b1, b2, b3, b4] = all;
    assert.deepEqual([b1.code, b1.room_id, b1.user_id, b1.start_at, b1.end_at, b1.status, b1.total_minutes, b1.price_cents, b1.payment_status, b1.payment_method, b1.series_id], ['L1', sol.id, u.id, '2026-12-16 13:30', '2026-12-16 16:00', 'confirmed', 150, 17000, 'paid', 'outro', null]);
    assert.match(b1.notes, /Reserva nº 1 do sistema anterior, cadastrada por Mery Ellen/);
    assert.deepEqual([b2.payment_status, b2.paid_at, b2.series_id, b2.price_cents], ['pending', null, 'L102', 17000]);
    assert.deepEqual([b3.price_cents, b3.included_minutes, b3.payment_status], [0, 150, 'none']);
    assert.match(b3.notes, /Descontada da cota/);
    assert.deepEqual([b4.status, b4.payment_status, b4.price_cents], ['cancelled', 'none', 0]);

    // Repetir não duplica; as reservas aparecem na lista da administração e ocupam a agenda.
    const again = await call('POST', '/admin/bookings/import', { token: admin, body: { rows: [row(1), row(2)] } });
    assert.deepEqual([again.body.created, again.body.skipped.length], [0, 2]);
    const list = await call('GET', '/admin/bookings?from=2026-12-16&to=2026-12-19', { token: admin });
    assert.equal(list.status, 200);

    assert.equal((await call('POST', '/admin/bookings/import', { token: client, body: { rows: [row(9)] } })).status, 403);
    assert.equal((await call('POST', '/admin/bookings/import', { token: admin, body: { rows: [] } })).status, 400);
  });

  it('reconhece salas de nome composto pelo primeiro termo', async () => {
    const rid = (await db.run("INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, buffer_minutes, active, sort_order, created_at) VALUES ('Oceano', 'oceano', '', '', 40, 20000, '', '[]', 60, 600, 0, 1, 99, '2026-01-01 00:00:00')")).insertId;
    const r = await call('POST', '/admin/bookings/import', { token: admin, body: { rows: [row(20, { sala: 'Oceano - Salão de Festas (eventos)', data: '2026-12-20' })] } });
    assert.equal(r.body.created, 1);
    assert.equal(Number((await db.get("SELECT room_id FROM bookings WHERE legacy_id = '20'")).room_id), Number(rid));
  });
});
