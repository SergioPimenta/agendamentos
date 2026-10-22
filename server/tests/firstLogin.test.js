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
});
after(() => server.close());

/** Último código enviado (lido do e-mail guardado em memória nos testes). */
const getOutbox = () => globalThis.__mailOutbox ?? [];
async function lastCode() {
  const mails = getOutbox();
  const m = [...mails].reverse().find((x) => /código de acesso/i.test(x.subject));
  return m ? m.html.match(/\b(\d{6})\b/)[1] : null;
}

describe('primeiro acesso por código', () => {
  it('cliente importado entra com o código do e-mail, define a senha e depois usa e-mail e senha', async () => {
    const admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
    const created = await call('POST', '/admin/users', { token: admin, body: { name: 'Cliente Importada', email: 'importada@exemplo.com', password: 'senha-aleatoria-1' } });
    assert.equal(created.status, 201);

    const req = await call('POST', '/auth/first-login/request', { body: { email: 'Importada@Exemplo.com' } });
    assert.equal(req.status, 200);
    const code = await lastCode();
    assert.match(code, /^\d{6}$/);

    // código errado não entra; o certo entra
    assert.equal((await call('POST', '/auth/first-login/verify', { body: { email: 'importada@exemplo.com', code: code === '000000' ? '111111' : '000000' } })).status, 400);
    const ok = await call('POST', '/auth/first-login/verify', { body: { email: 'importada@exemplo.com', code } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.set_password, true);
    assert.equal(ok.body.user.email, 'importada@exemplo.com');
    const token = ok.body.token;
    assert.equal((await call('GET', '/auth/me', { token })).status, 200);

    // o código só vale uma vez
    assert.equal((await call('POST', '/auth/first-login/verify', { body: { email: 'importada@exemplo.com', code } })).status, 400);

    // define a senha logo depois de entrar e passa a entrar com ela
    assert.equal((await call('POST', '/auth/first-login/password', { token, body: { password: 'curta' } })).status, 400);
    assert.equal((await call('POST', '/auth/first-login/password', { token, body: { password: 'minha-senha-nova-1' } })).status, 200);
    assert.equal((await call('POST', '/auth/first-login/password', { token, body: { password: 'outra-senha-nova-1' } })).status, 403); // só uma vez
    assert.equal((await call('POST', '/auth/login', { body: { email: 'importada@exemplo.com', password: 'minha-senha-nova-1' } })).status, 200);

    // quem já entrou não recebe código de novo (mesma resposta, sem e-mail)
    const before = getOutbox().length;
    assert.equal((await call('POST', '/auth/first-login/request', { body: { email: 'importada@exemplo.com' } })).status, 200);
    assert.equal(getOutbox().length, before);
  });

  it('não revela quem existe, ignora administradores e e-mails reservados, e limita tentativas', async () => {
    const before = getOutbox().length;
    for (const email of ['ninguem@exemplo.com', 'admin@harmonizeoser.com.br']) {
      const r = await call('POST', '/auth/first-login/request', { body: { email } });
      assert.equal(r.status, 200);
    }
    assert.equal(getOutbox().length, before); // nada enviado

    const admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
    await call('POST', '/admin/users', { token: admin, body: { name: 'Tentadora', email: 'tentadora@exemplo.com', password: 'senha-aleatoria-1' } });
    await call('POST', '/auth/first-login/request', { body: { email: 'tentadora@exemplo.com' } });
    const code = await lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/first-login/verify', { body: { email: 'tentadora@exemplo.com', code: wrong } })).status, 400);
    // depois de 5 erros nem o código certo vale
    assert.equal((await call('POST', '/auth/first-login/verify', { body: { email: 'tentadora@exemplo.com', code } })).status, 429);

    // pedir de novo logo em seguida não manda outro e-mail (espera de 1 minuto)
    const n = getOutbox().length;
    await call('POST', '/auth/first-login/request', { body: { email: 'tentadora@exemplo.com' } });
    assert.equal(getOutbox().length, n);

    // quem se cadastrou pelo site já está "dentro": não tem primeiro acesso pendente
    await call('POST', '/auth/register', { body: { name: 'Site', email: 'site@exemplo.com', password: 'senha-forte-1' } });
    const m = getOutbox().length;
    await call('POST', '/auth/first-login/request', { body: { email: 'site@exemplo.com' } });
    assert.equal(getOutbox().length, m);

    // código vencido
    await call('POST', '/admin/users', { token: admin, body: { name: 'Vencida', email: 'vencida@exemplo.com', password: 'senha-aleatoria-1' } });
    await call('POST', '/auth/first-login/request', { body: { email: 'vencida@exemplo.com' } });
    const c2 = await lastCode();
    await db.run("UPDATE users SET login_code_expires = '2000-01-01 00:00:00' WHERE email = 'vencida@exemplo.com'");
    assert.equal((await call('POST', '/auth/first-login/verify', { body: { email: 'vencida@exemplo.com', code: c2 } })).status, 400);
  });
});
