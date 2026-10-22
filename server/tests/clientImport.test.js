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

  it('importa as pessoas de cada cliente e leva os dados da principal para o cadastro', async () => {
    const r = await importRows([
      {
        codigo_antigo: '8001', nome: 'EDUARDO APARECIDO MORAIS DOIS', cidade: 'Curitiba', uf: 'PR', cadastro: '2026-05-01',
        pessoas: [{ nome: 'Eduardo Aparecido Morais Dois', sexo: 'Masculino', nascimento: '1967-05-01', email: 'Eduardo.Dois@Exemplo.com', telefone: '(41) 99111-0000', telefone2: '(41) 3333-0000', rg: '158678813', cpf: '043.502.348-96', assina: 'Sim', ativo: true, codigo_pessoa: '552' }],
      },
      {
        codigo_antigo: '8002', nome: 'NEW ARC COLETIVO DE EVENTOS LTDA', cidade: 'Curitiba', uf: 'PR', telefone: '(11) 90000-0000',
        pessoas: [
          { nome: 'Gabriel Auxiliar', cargo: 'Assistente', email: 'gabriel@newarc.ag', assina: 'Não' },
          { nome: 'Rosangela Gestora', sexo: 'Feminino', nascimento: '1994-03-09', email: 'adm@newarc.ag', cargo: 'GESTORA FINANCEIRA', cpf: '43591489840', rg: '437940780', assina: 'Sim', fiador: 'Não' },
        ],
      },
    ]);
    assert.deepEqual([r.body.created, r.body.people], [2, 3]);

    // Pessoa física (titular = cliente): e-mail, telefone, nascimento e CPF vão para o cadastro.
    const pf = await db.get("SELECT * FROM users WHERE legacy_code = '8001'");
    assert.equal(pf.email, 'eduardo.dois@exemplo.com');
    assert.equal(pf.phone, '(41) 99111-0000');
    assert.equal(pf.birth_date, '1967-05-01');
    assert.equal(pf.document, '04350234896');
    const people = await db.query('SELECT * FROM client_people WHERE user_id = ?', [pf.id]);
    assert.equal(people.length, 1);
    assert.deepEqual([people[0].gender, people[0].phone2, people[0].rg, people[0].cpf, Number(people[0].signs_contract), Number(people[0].is_primary), people[0].legacy_id], ['Masculino', '(41) 3333-0000', '158678813', '04350234896', 1, 1, '552']);

    // Empresa: o e-mail é o de quem assina; nascimento e CPF ficam só na pessoa (não são da empresa).
    const co = await db.get("SELECT * FROM users WHERE legacy_code = '8002'");
    assert.equal(co.email, 'adm@newarc.ag');
    assert.equal(co.phone, '(11) 90000-0000');
    assert.equal(co.birth_date, null);
    assert.equal(co.document, '');
    const team = await db.query('SELECT name, role, cpf, is_primary FROM client_people WHERE user_id = ? ORDER BY id', [co.id]);
    assert.deepEqual(team.map((p) => [p.name, Number(p.is_primary)]), [['Gabriel Auxiliar', 0], ['Rosangela Gestora', 1]]);
    assert.equal(team[1].role, 'GESTORA FINANCEIRA');
  });

  it('aceita as colunas pessoa_* da planilha e não perde o cliente se o e-mail já é de outro', async () => {
    const r = await importRows([{
      codigo_antigo: '8003', nome: 'Cliente Colunas', pessoa_nome: 'Cliente Colunas', pessoa_email: 'adm@newarc.ag', pessoa_telefone: '(41) 98888-7777',
      pessoa_cpf: '111.222.333-96', pessoa_nascimento: '1990-02-02', pessoa_assina: 'sim',
      pessoa2_nome: 'Segunda Pessoa', pessoa2_cargo: 'Sócia',
    }]);
    assert.equal(r.body.created, 1);
    const u = await db.get("SELECT * FROM users WHERE legacy_code = '8003'");
    assert.ok(isPlaceholderEmail(u.email)); // adm@newarc.ag já é da NEW ARC: não duplica nem descarta o cliente
    assert.match(u.notes, /adm@newarc\.ag já pertence a outro cadastro/);
    assert.equal(u.phone, '(41) 98888-7777');
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM client_people WHERE user_id = ?', [u.id])).n), 2);
  });

  it('completar clientes já importados preenche só o que estava vazio', async () => {
    // O cliente 608 já foi importado sem e-mail e sem pessoas (importação anterior).
    const before = await db.get("SELECT * FROM users WHERE legacy_code = '608'");
    const row = {
      codigo_antigo: '608', nome: 'EDUARDO APARECIDO MORAIS', telefone: '(99) 99999-9999', nascimento: '1967-05-01',
      pessoas: [{ nome: 'Eduardo Aparecido Morais', email: 'mpm@exemplo.com', cpf: '39053344705', rg: '158678813', assina: 'Sim' }],
    };
    // Sem "completar", continua pulando.
    assert.equal((await importRows([row])).body.skipped_count, 1);

    const r = await call('POST', '/admin/users/import', { token: admin, body: { rows: [row], update: true } });
    assert.deepEqual([r.body.updated, r.body.created, r.body.people], [1, 0, 1]);
    const after = await db.get("SELECT * FROM users WHERE legacy_code = '608'");
    assert.equal(after.email, 'mpm@exemplo.com'); // o e-mail reservado dá lugar ao real
    assert.equal(after.phone, before.phone); // o que já existia não é sobrescrito
    assert.equal(after.birth_date, before.birth_date); // já tinha data de nascimento: mantida
    assert.equal(after.document, '39053344705');
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM client_people WHERE user_id = ?', [after.id])).n), 1);

    // Rodar de novo não faz nada.
    const again = await call('POST', '/admin/users/import', { token: admin, body: { rows: [row], update: true } });
    assert.deepEqual([again.body.updated, again.body.skipped_count], [0, 1]);
  });

  it('a administração gerencia as pessoas do cliente', async () => {
    const co = await db.get("SELECT id FROM users WHERE legacy_code = '8002'");
    const detail = await call('GET', `/admin/users/${co.id}`, { token: admin });
    assert.deepEqual(detail.body.people.map((p) => p.name), ['Rosangela Gestora', 'Gabriel Auxiliar']); // a principal primeiro
    assert.equal(detail.body.people[0].is_primary, true);

    const add = await call('POST', `/admin/users/${co.id}/people`, { token: admin, body: { name: 'Nova Pessoa', gender: 'Feminino', role: 'Sócia', is_primary: true, signs_contract: true } });
    assert.equal(add.status, 201);
    assert.equal(add.body.person.is_primary, true);
    const now = (await call('GET', `/admin/users/${co.id}`, { token: admin })).body.people;
    assert.equal(now.filter((p) => p.is_primary).length, 1); // só uma principal

    const edit = await call('PUT', `/admin/people/${add.body.person.id}`, { token: admin, body: { name: 'Nova Pessoa Editada', role: 'Diretora', birth_date: '1980-01-02', email: 'nova@exemplo.com' } });
    assert.equal(edit.body.person.role, 'Diretora');
    assert.equal(edit.body.person.birth_date, '1980-01-02');
    assert.equal((await call('POST', `/admin/users/${co.id}/people`, { token: admin, body: { name: 'X' } })).status, 400);

    // Excluir a principal passa o posto para outra.
    await call('DELETE', `/admin/people/${add.body.person.id}`, { token: admin });
    const left = (await call('GET', `/admin/users/${co.id}`, { token: admin })).body.people;
    assert.equal(left.length, 2);
    assert.equal(left.filter((p) => p.is_primary).length, 1);
    assert.equal((await call('GET', `/admin/users/${co.id}`, { token: (await call('POST', '/auth/register', { body: { name: 'Qualquer', email: 'q@exemplo.com', password: 'senha-forte-1' } })).body.token })).status, 403);
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
