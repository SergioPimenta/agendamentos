import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');

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

const login = async (email, password) => {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(r.status, 200);
  return r.body;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await login('admin@harmonizeoser.com.br', 'senha-admin-123')).token;
});

after(() => server.close());

describe('perfis de usuário', () => {
  let profiles;
  const byName = (name) => profiles.find((p) => p.name === name);

  it('o administrador tem acesso total e vê os perfis padrão', async () => {
    const me = await call('GET', '/auth/me', { token: admin });
    assert.equal(me.body.user.permissions.profiles, 'edit');
    assert.equal(me.body.user.profile_name, 'Administrador');
    const r = await call('GET', '/admin/profiles', { token: admin });
    assert.equal(r.status, 200);
    profiles = r.body.profiles;
    for (const n of ['Administrador', 'Recepção', 'Financeiro', 'Somente consulta']) assert.ok(byName(n), n);
    assert.equal(byName('Administrador').is_system, true);
  });

  it('o perfil Administrador não pode ser alterado nem excluído', async () => {
    const id = byName('Administrador').id;
    const body = { name: 'Administrador', description: '', permissions: { dashboard: 'view' } };
    assert.equal((await call('PUT', `/admin/profiles/${id}`, { token: admin, body })).status, 403);
    assert.equal((await call('DELETE', `/admin/profiles/${id}`, { token: admin })).status, 403);
  });

  it('cria um perfil e recusa um sem nenhuma área liberada', async () => {
    const ok = await call('POST', '/admin/profiles', { token: admin, body: { name: 'Salas', description: '', permissions: { rooms: 'edit', plans: 'view' } } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.profile.permissions.rooms, 'edit');
    assert.equal(ok.body.profile.permissions.finance, 'none');
    const empty = await call('POST', '/admin/profiles', { token: admin, body: { name: 'Vazio', permissions: { rooms: 'none' } } });
    assert.equal(empty.status, 422);
  });

  it('o nível do perfil vale nas rotas: sem acesso, só ver e editar', async () => {
    const created = await call('POST', '/admin/users', {
      token: admin,
      body: { name: 'Pessoa Recepção', email: 'recepcao@exemplo.com', password: 'senha-forte-1', profile_id: byName('Recepção').id },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'admin');
    assert.equal(created.body.user.profile_name, 'Recepção');

    const { token, user } = await login('recepcao@exemplo.com', 'senha-forte-1');
    assert.equal(user.permissions.agenda, 'edit');
    assert.equal(user.permissions.finance, 'none');

    assert.equal((await call('GET', '/admin/agenda?from=2030-01-01&to=2030-01-07', { token })).status, 200);
    assert.equal((await call('GET', '/admin/rooms', { token })).status, 200); // só ver
    assert.equal((await call('POST', '/admin/rooms', { token, body: { name: 'Nova sala' } })).status, 403); // não edita
    assert.equal((await call('GET', '/admin/finance/overview', { token })).status, 403); // sem acesso
    assert.equal((await call('GET', '/admin/profiles', { token })).status, 403);
    assert.equal((await call('PUT', '/admin/settings', { token, body: {} })).status, 403);
    assert.equal((await call('GET', '/admin/settings', { token })).status, 200); // leitura liberada
  });

  it('quem só edita Clientes não muda o acesso nem a senha de usuários do painel', async () => {
    const { token } = await login('recepcao@exemplo.com', 'senha-forte-1');
    const list = await call('GET', '/admin/users', { token });
    const other = list.body.users.find((u) => u.email === 'admin@harmonizeoser.com.br');
    const put = (extra) => call('PUT', `/admin/users/${other.id}`, { token, body: { name: other.name, email: other.email, ...extra } });
    assert.equal((await put({ password: 'outra-senha-123' })).status, 403);
    assert.equal((await put({ role: 'client' })).status, 403);

    const mine = list.body.users.find((u) => u.email === 'recepcao@exemplo.com');
    const self = await call('PUT', `/admin/users/${mine.id}`, { token, body: { name: mine.name, email: mine.email, profile_id: byName('Administrador').id } });
    assert.equal(self.status, 403);
  });

  it('o administrador troca o perfil de um usuário e o efeito é imediato', async () => {
    const { token } = await login('recepcao@exemplo.com', 'senha-forte-1');
    const users = await call('GET', '/admin/profiles-users', { token: admin });
    const target = users.body.users.find((u) => u.email === 'recepcao@exemplo.com');
    const r = await call('PUT', `/admin/profiles-users/${target.id}`, { token: admin, body: { profile_id: byName('Financeiro').id } });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.profile_name, 'Financeiro');
    assert.equal((await call('GET', '/admin/agenda?from=2030-01-01&to=2030-01-07', { token })).status, 403);
    assert.equal((await call('GET', '/admin/finance/overview', { token })).status, 200);
  });

  it('tirar o perfil devolve o usuário à área de cliente', async () => {
    const { token } = await login('recepcao@exemplo.com', 'senha-forte-1');
    const users = await call('GET', '/admin/profiles-users', { token: admin });
    const target = users.body.users.find((u) => u.email === 'recepcao@exemplo.com');
    const r = await call('PUT', `/admin/profiles-users/${target.id}`, { token: admin, body: { profile_id: null } });
    assert.equal(r.body.user.role, 'client');
    assert.equal((await call('GET', '/admin/rooms', { token })).status, 403);
  });

  it('não permite mudar o próprio perfil nem excluir perfil em uso', async () => {
    const users = await call('GET', '/admin/profiles-users', { token: admin });
    const me = users.body.users.find((u) => u.email === 'admin@harmonizeoser.com.br');
    const own = await call('PUT', `/admin/profiles-users/${me.id}`, { token: admin, body: { profile_id: null } });
    assert.equal(own.status, 422);

    const fin = byName('Financeiro');
    const target = users.body.users.find((u) => u.email === 'recepcao@exemplo.com');
    await call('PUT', `/admin/profiles-users/${target.id}`, { token: admin, body: { profile_id: fin.id } });
    assert.equal((await call('DELETE', `/admin/profiles/${fin.id}`, { token: admin })).status, 409);
  });
});
