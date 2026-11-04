import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { db } = await import('../db/index.js');
const { migrate } = await import('../db/migrate.js');

describe('migrações', () => {
  it('rodar de novo uma migração interrompida (colunas e índices já criados) não derruba a inicialização', async () => {
    await migrate();
    const before = Number((await db.get('SELECT COUNT(*) AS n FROM schema_migrations')).n);

    // Simula o que o MySQL deixa para trás quando a migração cai no meio: o DDL ficou, o registro não.
    await db.run("DELETE FROM schema_migrations WHERE id IN ('019_client_guests', '020_booking_legacy_id', '023_booking_indexes', '024_first_login_code')");
    await migrate();

    const ids = (await db.query('SELECT id FROM schema_migrations')).map((r) => r.id);
    assert.equal(ids.length, before);
    for (const id of ['019_client_guests', '020_booking_legacy_id', '023_booking_indexes', '024_first_login_code']) assert.ok(ids.includes(id), `${id} deve voltar a constar como aplicada`);
  });

  it('a migração dos valores-base atualiza as salas (por apelido ou nome) e deixa as outras como estão', async () => {
    await migrate();
    const room = (name, slug, cents) =>
      db.run(
        "INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, buffer_minutes, active, sort_order, created_at) VALUES (?, ?, '', '', 4, ?, '', '[]', 60, 480, 0, 1, 0, '2026-01-01 00:00:00')",
        [name, slug, cents],
      );
    await db.run('DELETE FROM rooms');
    for (const [name, slug] of [['Sala Brisa', 'brisa'], ['Sala Flor', 'flor'], ['Sala Sol', 'sol'], ['Sala Terra', 'sala-terra'], ['Sala Mar', 'mar'], ['Sala Árvore', 'arvore'], ['Sala Cachoeira', 'cachoeira']]) await room(name, slug, 1000);
    await room('Sala Estrela', 'estrela', 3400); // não está na tabela nova: continua igual

    await db.run("DELETE FROM schema_migrations WHERE id = '028_room_base_prices'");
    await migrate();

    const price = async (slug) => Number((await db.get('SELECT price_cents FROM rooms WHERE slug = ?', [slug])).price_cents);
    assert.deepEqual(
      await Promise.all(['brisa', 'flor', 'sol', 'sala-terra', 'mar', 'arvore', 'cachoeira', 'estrela'].map(price)),
      [3140, 3860, 4400, 4400, 4950, 4950, 6020, 3400],
    );
  });
});
