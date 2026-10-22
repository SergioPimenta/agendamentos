import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { sendMail } = await import('../utils/mailer.js');
const { sendBirthdayEmails } = await import('../services/birthdays.js');
const { isPlaceholderEmail } = await import('../utils/email.js');
const { nowLocal } = await import('../utils/time.js');

let server;
let base;
let admin;

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
const importRows = (rows, dry_run = false, token = admin) => call('POST', '/admin/users/import', { token, body: { rows, dry_run } });

const sample = [
  { codigo_antigo: '608', nome: 'EDUARDO APARECIDO MORAIS', nome_fantasia: 'MPM DOCUMENTACAO', cidade: 'Itapoá', uf: 'SC', telefone: '(47) 99115-2304', plano: 'Modo Brisa', cadastro: '2026-10-20', tags: '', observacoes: '' },
  { codigo_antigo: '595', nome: 'Lincoln Cesar Andrade', cidade: 'Curitiba', uf: 'PR', telefone: '(41) 99925-0562', plano: 'Plano Ecossistema', plano_desde: '2026-09-17', cadastro: '2026-09-17', observacoes: 'Plano no sistema anterior: Cliente Mensalista' },
  { codigo_antigo: '379', nome: 'RAIANNY SILVA NEVES', documento: '15789725740', cidade: 'Curitiba', uf: 'PR', telefone: '(41) 99175-1287', plano: 'Endereço Comercial', tags: 'Endereço Comercial, Pré-Pago', cadastro: '2025-07-30' },
];

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
});

after(() => server.close());

describe('importação de clientes', () => {
  it('a prévia confere tudo e não grava nada', async () => {
    const r = await importRows(sample, true);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.dry_run, r.body.total, r.body.created, r.body.skipped_count, r.body.error_count], [true, 3, 3, 0, 0]);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM users WHERE legacy_code IS NOT NULL")).n), 0);
  });

  it('importa com todos os campos, o plano certo e a data de cadastro original', async () => {
    const r = await importRows(sample);
    assert.equal(r.body.created, 3);

    const u = await db.get("SELECT u.*, p.name AS plan_name FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.legacy_code = '608'");
    assert.equal(u.name, 'EDUARDO APARECIDO MORAIS');
    assert.equal(u.company, 'MPM DOCUMENTACAO'); // nome fantasia
    assert.equal(u.city, 'Itapoá');
    assert.equal(u.state, 'SC');
    assert.equal(u.phone, '(47) 99115-2304');
    assert.equal(u.plan_name, 'Modo Brisa');
    assert.equal(u.role, 'client');
    assert.equal(u.created_at, '2026-10-20 12:00:00');
    assert.match(u.notes, /Importado do sistema anterior \(nº 608\)/);
    assert.ok(isPlaceholderEmail(u.email));

    const eco = await db.get("SELECT u.plan_since, p.name AS plan_name, u.notes FROM users u JOIN plans p ON p.id = u.plan_id WHERE u.legacy_code = '595'");
    assert.equal(eco.plan_name, 'Plano Ecossistema');
    assert.equal(eco.plan_since, '2026-09-17');
    assert.match(eco.notes, /Cliente Mensalista/);

    const end = await db.get("SELECT u.document, u.tags, p.name AS plan_name FROM users u JOIN plans p ON p.id = u.plan_id WHERE u.legacy_code = '379'");
    assert.equal(end.plan_name, 'Endereço Comercial');
    assert.equal(end.document, '15789725740');
    assert.equal(end.tags, 'Endereço Comercial, Pré-Pago');
  });

  it('repetir a importação não duplica ninguém', async () => {
    const again = await importRows(sample);
    assert.equal(again.body.created, 0);
    assert.equal(again.body.skipped_count, 3);
    assert.match(again.body.skipped[0].reason, /Já importado/);
    // Mesmo documento com outro código, ou e-mail já usado, também é pulado.
    const r = await importRows([
      { codigo_antigo: '9001', nome: 'Raianny Duplicada', documento: '157.897.257-40' },
      { codigo_antigo: '9002', nome: 'Com E-mail', email: 'Fulano@Exemplo.com' },
      { codigo_antigo: '9003', nome: 'Outro Com E-mail', email: 'fulano@exemplo.com' },
    ]);
    assert.equal(r.body.created, 1);
    assert.deepEqual(r.body.skipped.map((s) => s.reason).sort(), ['Documento (CPF/CNPJ) já cadastrado', 'E-mail já cadastrado'].sort());
  });

  it('linhas com problema são listadas e as boas entram mesmo assim', async () => {
    const r = await importRows([
      { codigo_antigo: '7001', nome: '' },
      { codigo_antigo: '7002', nome: 'Plano Inexistente', plano: 'Plano que não existe' },
      { codigo_antigo: '7003', nome: 'Data Ruim', cadastro: '2026-02-31' },
      { codigo_antigo: '7004', nome: 'Tudo Certo', cadastro: '2026-03-05' },
    ]);
    assert.equal(r.body.created, 1);
    assert.equal(r.body.error_count, 3);
    assert.deepEqual(r.body.errors.map((e) => e.line), [1, 2, 3]);
    assert.match(r.body.errors[1].reason, /Plano "Plano que não existe" não existe/);
    assert.ok(await db.get("SELECT id FROM users WHERE legacy_code = '7004'"));
    assert.equal(await db.get("SELECT id FROM users WHERE legacy_code = '7003'"), undefined);
  });

  it('sem e-mail: não aparece nas telas, não recebe mensagem e não entra no sistema', async () => {
    const list = await call('GET', '/admin/users?q=EDUARDO', { token: admin });
    const u = list.body.users[0];
    assert.equal(u.email, '');
    assert.equal(u.has_email, false);
    assert.equal(u.legacy_code, '608');
    assert.equal(u.city, 'Itapoá');
    assert.equal(u.tags, '');
    assert.equal((await call('GET', '/admin/users?q=Cesar Andrade', { token: admin })).body.users[0].plan_name, 'Plano Ecossistema');
    assert.equal((await call('GET', '/admin/users?q=Itap', { token: admin })).body.users.length, 1); // busca por cidade
    assert.equal((await call('GET', '/admin/users?q=608', { token: admin })).body.users.length, 1); // e pelo código de origem

    const sent = await sendMail({ to: (await db.get("SELECT email FROM users WHERE legacy_code = '608'")).email, subject: 'x', html: 'x' });
    assert.deepEqual([sent.success, sent.skipped, sent.noEmail], [false, true, true]);

    // Aniversário: sem e-mail, não há envio (nem erro).
    const md = nowLocal().date.slice(5);
    await db.run("UPDATE users SET birth_date = ? WHERE legacy_code = '608'", [`1980-${md}`]);
    const calls = [];
    assert.equal(await sendBirthdayEmails({ force: true, send: async (k, a) => { calls.push(a.to); return { success: true }; } }), 0);
    assert.equal(calls.length, 0);

    // Senha aleatória: ninguém consegue entrar com o endereço reservado.
    const email = (await db.get("SELECT email FROM users WHERE legacy_code = '608'")).email;
    assert.equal((await call('POST', '/auth/login', { body: { email, password: 'qualquer-senha-1' } })).status, 401);
  });

  it('cadastro manual sem e-mail, e depois o e-mail real pode ser informado', async () => {
    const created = await call('POST', '/admin/users', { token: admin, body: { name: 'Sem Email Manual', email: '', phone: '(41) 90000-0000', city: 'Curitiba', state: 'pr', tags: 'Eventos' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.has_email, false);
    assert.equal(created.body.user.state, 'PR');
    assert.equal(created.body.user.tags, 'Eventos');

    const id = created.body.user.id;
    const keep = await call('PUT', `/admin/users/${id}`, { token: admin, body: { name: 'Sem Email Manual', email: '', city: 'Pinhais' } });
    assert.equal(keep.body.user.has_email, false); // vazio não apaga nem inventa
    assert.equal(keep.body.user.city, 'Pinhais');
    const real = await call('PUT', `/admin/users/${id}`, { token: admin, body: { name: 'Sem Email Manual', email: 'manual@exemplo.com' } });
    assert.equal(real.body.user.email, 'manual@exemplo.com');
    assert.equal(real.body.user.has_email, true);
    assert.equal((await call('POST', '/admin/users', { token: admin, body: { name: 'Com Email Sem Senha', email: 'x@exemplo.com' } })).status, 400); // com e-mail, a senha continua obrigatória
  });

  it('só quem edita Clientes importa; lotes têm limite', async () => {
    const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Comum', email: 'comum@exemplo.com', password: 'senha-forte-1' } });
    assert.equal((await importRows(sample, true, reg.body.token)).status, 403);

    const profiles = (await call('GET', '/admin/profiles', { token: admin })).body.profiles;
    const financeiro = profiles.find((p) => p.name === 'Financeiro').id; // só consulta Clientes
    await call('POST', '/admin/users', { token: admin, body: { name: 'Fin', email: 'fin-imp@exemplo.com', password: 'senha-forte-1', profile_id: financeiro } });
    const fin = (await call('POST', '/auth/login', { body: { email: 'fin-imp@exemplo.com', password: 'senha-forte-1' } })).body.token;
    assert.equal((await importRows(sample, true, fin)).status, 403);

    const many = Array.from({ length: 301 }, (_, i) => ({ codigo_antigo: `m${i}`, nome: `Cliente ${i}` }));
    assert.equal((await importRows(many, true)).status, 400);
    assert.equal((await importRows([], true)).status, 400);
  });
});
