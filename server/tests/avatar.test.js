import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-test-'));
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');

let server;
let base;
let admin;
let client;

const call = async (method, url, { token, body, form } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, type: res.headers.get('content-type') };
};

// PNG 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (token, data, type, name = 'foto.png') => {
  const form = new FormData();
  form.append('file', new Blob([data], { type }), name);
  return call('POST', '/api/auth/me/avatar', { token, form });
};

before(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/api/auth/register', { body: { name: 'Cliente Foto', email: 'foto@exemplo.com', password: 'senha-forte-1' } })).body.token;
});
after(() => {
  server.close();
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
});

describe('foto de perfil', () => {
  it('o cliente envia, troca e remove a foto; a foto antiga some do disco', async () => {
    const sent = await upload(client, PNG, 'image/png');
    assert.equal(sent.status, 201);
    const first = sent.body.user.avatar;
    assert.match(first, /^\/uploads\/perfil-\d+-\d+-[0-9a-f]{8}\.png$/);
    assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(first))));

    // A foto é servida como imagem e aparece em /auth/me e na lista da administração.
    const served = await call('GET', first);
    assert.equal(served.status, 200);
    assert.match(served.type, /image\/png/);
    assert.equal((await call('GET', '/api/auth/me', { token: client })).body.user.avatar, first);
    const listed = (await call('GET', '/api/admin/users?q=foto@exemplo.com', { token: admin })).body.users[0];
    assert.equal(listed.avatar, first);

    // Trocar: a nova entra e a antiga é apagada.
    const second = (await upload(client, PNG, 'image/png')).body.user.avatar;
    assert.notEqual(second, first);
    assert.ok(!fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(first))));
    assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(second))));

    // Remover.
    const removed = await call('DELETE', '/api/auth/me/avatar', { token: client });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.user.avatar, '');
    assert.ok(!fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(second))));
  });

  it('recusa arquivo que não é imagem JPG/PNG/WebP, imagem grande demais e quem não entrou', async () => {
    assert.equal((await upload(client, Buffer.from('<script>alert(1)</script>'), 'text/html', 'foto.html')).status, 400);
    assert.equal((await upload(client, Buffer.from('GIF89a'), 'image/gif', 'foto.gif')).status, 400);
    assert.equal((await upload(client, Buffer.alloc(4 * 1024 * 1024, 1), 'image/png')).status, 413);
    assert.equal((await upload(null, PNG, 'image/png')).status, 401);
    assert.equal((await call('POST', '/api/auth/me/avatar', { token: client })).status, 400); // sem arquivo
  });
});
