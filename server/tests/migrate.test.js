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
});
