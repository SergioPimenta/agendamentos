import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { addDays, nowLocal } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let clientId;

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
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Contrato', email: 'contrato@exemplo.com', password: 'senha-forte-1' } })).body.token;
  clientId = Number((await db.get("SELECT id FROM users WHERE email = 'contrato@exemplo.com'")).id);
  await db.run("UPDATE users SET legacy_code = '537' WHERE id = ?", [clientId]);
});
after(() => server.close());

const row = (extra = {}) => ({
  codigo_cliente: '537', cliente: 'Cliente Contrato', tipo: 'Endereço fiscal', unidade: 'Coworking Harmonize o Ser', periodicidade: 'Semestral', assinatura: '',
  inicio: '2026-05-20', fim: '', fidelidade_ate: '2027-05-19', valor_centavos: 76140, vencimento_dia: '25', escritorio_privativo: '', cadastrado_por: 'Fabiane',
  ultimo_reajuste: '2026-01-02', indice_reajuste: 'IGPM', ativo: 'Sim', ...extra,
});

describe('contratos dos clientes', () => {
  it('importa o relatório (prévia, gravação e repetição), ligando ao cliente pelo código antigo', async () => {
    const rows = [row(), row({ tipo: 'Cliente Mensalista', periodicidade: 'Mensal', valor_centavos: 0, vencimento_dia: '5', fidelidade_ate: '', ultimo_reajuste: '', indice_reajuste: '' }), row({ codigo_cliente: '999', cliente: 'Quem Não Existe' }), row({ inicio: 'ontem' })];
    const dry = await call('POST', '/admin/contracts/import', { token: admin, body: { rows, dry_run: true } });
    assert.deepEqual([dry.body.created, dry.body.errors.length], [2, 2]);
    assert.deepEqual(dry.body.missing_clients, { '999 - Quem Não Existe': 1 });
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM contracts')).n), 0);

    assert.equal((await call('POST', '/admin/contracts/import', { token: admin, body: { rows } })).body.created, 2);
    const list = await call('GET', '/admin/contracts', { token: admin });
    assert.equal(list.body.total, 2);
    const fiscal = list.body.contracts.find((c) => c.kind === 'Endereço fiscal');
    assert.deepEqual([fiscal.user_id, fiscal.client_name, fiscal.period, fiscal.amount_cents, fiscal.due_day, fiscal.start_date, fiscal.end_date, fiscal.fidelity_until, fiscal.adjustment_index, fiscal.status],
      [clientId, 'Cliente Contrato', 'Semestral', 76140, 25, '2026-05-20', '', '2027-05-19', 'IGPM', 'active']);
    assert.deepEqual(list.body.kinds.sort(), ['Cliente Mensalista', 'Endereço fiscal']);

    const again = await call('POST', '/admin/contracts/import', { token: admin, body: { rows: rows.slice(0, 2) } });
    assert.deepEqual([again.body.created, again.body.skipped.length], [0, 2]);

    // Busca e filtros
    assert.equal((await call('GET', '/admin/contracts?q=537', { token: admin })).body.total, 2);
    assert.equal((await call('GET', '/admin/contracts?kind=Endere%C3%A7o%20fiscal', { token: admin })).body.total, 1);
    assert.equal((await call('GET', '/admin/contracts?status=fidelity', { token: admin })).body.total, 1);
    assert.equal((await call('GET', '/admin/contracts?status=closed', { token: admin })).body.total, 0);

    // A ficha do cliente traz os contratos dele.
    const detail = await call('GET', `/admin/users/${clientId}`, { token: admin });
    assert.equal(detail.body.contracts.length, 2);

    assert.equal((await call('GET', '/admin/contracts', { token: client })).status, 403);
    assert.equal((await call('POST', '/admin/contracts/import', { token: admin, body: { rows: [] } })).status, 400);
  });

  it('cria, edita e exclui contratos; calcula a situação (vencendo, encerrado, inativo)', async () => {
    const today = nowLocal().date;
    const base = { user_id: clientId, kind: 'Endereço comercial', period: 'Mensal', start_date: '2026-01-10', amount_cents: 8700, due_day: 10 };

    assert.equal((await call('POST', '/admin/contracts', { token: admin, body: { ...base, user_id: 999999 } })).status, 404);
    assert.equal((await call('POST', '/admin/contracts', { token: admin, body: { ...base, start_date: '' } })).status, 400);
    assert.equal((await call('POST', '/admin/contracts', { token: admin, body: { ...base, end_date: '2025-01-01' } })).status, 400); // fim antes do início
    assert.equal((await call('POST', '/admin/contracts', { token: admin, body: { ...base, due_day: 40 } })).status, 400);

    const ending = await call('POST', '/admin/contracts', { token: admin, body: { ...base, end_date: addDays(today, 10) } });
    assert.equal(ending.status, 201);
    assert.equal(ending.body.contract.status, 'ending');
    assert.equal((await call('GET', '/admin/contracts?status=ending', { token: admin })).body.total, 1);

    const id = ending.body.contract.id;
    const ended = await call('PUT', `/admin/contracts/${id}`, { token: admin, body: { ...base, end_date: addDays(today, -1) } });
    assert.equal(ended.body.contract.status, 'ended');
    const inactive = await call('PUT', `/admin/contracts/${id}`, { token: admin, body: { ...base, active: false } });
    assert.deepEqual([inactive.body.contract.status, inactive.body.contract.due_day], ['inactive', 10]);
    assert.equal((await call('GET', '/admin/contracts?status=closed', { token: admin })).body.total, 1);

    assert.equal((await call('DELETE', `/admin/contracts/${id}`, { token: admin })).status, 200);
    assert.equal((await call('DELETE', `/admin/contracts/${id}`, { token: admin })).status, 404);
    assert.equal((await call('PUT', '/admin/contracts/999999', { token: admin, body: base })).status, 404);
  });
});
