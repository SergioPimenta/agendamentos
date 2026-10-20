import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { migrate, seed } = await import('../db/migrate.js');
const { db } = await import('../db/index.js');
const { nowStamp } = await import('../utils/time.js');

const names = async () => (await db.query('SELECT name FROM plans ORDER BY sort_order, id')).map((p) => p.name);

describe('catálogo de planos', () => {
  before(async () => { await migrate(); });
  after(() => db.close?.());

  it('instalação nova já nasce com os planos atuais', async () => {
    await seed();
    assert.deepEqual(await names(), ['Modo Brisa', 'Plano Raiz', 'Plano Ecossistema', 'Endereço Comercial']);
    const raiz = await db.get("SELECT * FROM plans WHERE name = 'Plano Raiz'");
    assert.equal(Number(raiz.price_cents), 14400);
    assert.equal(Number(raiz.included_minutes), 240);
  });

  it('banco antigo: troca os planos antigos, preserva clientes e planos da administração, e roda uma vez', async () => {
    // Estado de um banco criado antes da troca: planos antigos + um plano criado pela administração.
    await db.run("DELETE FROM settings WHERE k = 'plans_catalog'");
    await db.run("DELETE FROM plans WHERE name IN ('Modo Brisa', 'Plano Raiz', 'Plano Ecossistema')");
    const add = async (name, price) => (await db.run('INSERT INTO plans (name, description, price_cents, sort_order) VALUES (?, ?, ?, 9)', [name, '', price])).insertId;
    const flex = await add('Flex', 34900);
    await add('Avulso', 0);
    const custom = await add('Plano da casa', 10000);
    const user = async (email, planId) => (await db.run(
      `INSERT INTO users (name, email, password, role, plan_id, created_at, updated_at) VALUES (?, ?, 'x', 'client', ?, ?, ?)`,
      [email, email, planId, nowStamp(), nowStamp()],
    )).insertId;
    const onFlex = await user('flex@exemplo.com', flex);
    const onCustom = await user('casa@exemplo.com', custom);
    await db.run(
      `INSERT INTO receivables (user_id, description, amount_cents, due_date, status, ref, plan_id, created_at, updated_at)
       VALUES (?, 'troca pendente', 34900, '2026-10-20', 'pending', 'plan:x:1', ?, ?, ?)`,
      [onFlex, flex, nowStamp(), nowStamp()],
    );

    await seed();
    assert.deepEqual(await names(), ['Modo Brisa', 'Plano Raiz', 'Plano Ecossistema', 'Endereço Comercial', 'Plano da casa']);
    const brisa = await db.get("SELECT id FROM plans WHERE name = 'Modo Brisa'");
    assert.equal(Number((await db.get('SELECT plan_id FROM users WHERE id = ?', [onFlex])).plan_id), Number(brisa.id));
    assert.equal(Number((await db.get('SELECT plan_id FROM users WHERE id = ?', [onCustom])).plan_id), custom);
    assert.equal((await db.query("SELECT id FROM receivables WHERE ref = 'plan:x:1'")).length, 0);

    // Planos que a administração apagar depois não voltam a cada reinício.
    await db.run("UPDATE users SET plan_id = NULL WHERE plan_id = (SELECT id FROM plans WHERE name = 'Plano Ecossistema')");
    await db.run("DELETE FROM plans WHERE name = 'Plano Ecossistema'");
    await seed();
    assert.deepEqual(await names(), ['Modo Brisa', 'Plano Raiz', 'Endereço Comercial', 'Plano da casa']);
  });
});
