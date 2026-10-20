import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { birthdaysOfMonth, sendBirthdayEmails } = await import('../services/birthdays.js');
const { renderEmail, sampleData } = await import('../services/emailTemplates.js');
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

const today = nowLocal().date;
const year = Number(today.slice(0, 4));
const md = today.slice(5);

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  const a = await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } });
  admin = a.body.token;
});

after(() => server.close());

const newClient = (name, email, birth_date) =>
  call('POST', '/admin/users', { token: admin, body: { name, email, password: 'senha-forte-1', birth_date } });

describe('aniversariantes', () => {
  let hoje;
  let outroMes;

  it('guarda a data de nascimento no cadastro e recusa datas inválidas', async () => {
    const ok = await newClient('Ana Aniversário', 'ana@exemplo.com', `${year - 30}-${md}`);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.birth_date, `${year - 30}-${md}`);
    hoje = ok.body.user.id;

    const nextMonth = String((Number(today.slice(5, 7)) % 12) + 1).padStart(2, '0');
    const other = await newClient('Beto Outro Mês', 'beto@exemplo.com', `1990-${nextMonth}-15`);
    assert.equal(other.status, 201);
    outroMes = other.body.user.id;

    assert.equal((await newClient('Data Ruim', 'ruim@exemplo.com', '1990-02-31')).status, 400);
    assert.equal((await newClient('Futuro', 'futuro@exemplo.com', `${year + 1}-01-01`)).status, 400);
    const semData = await newClient('Sem Data', 'sem@exemplo.com', '');
    assert.equal(semData.status, 201);
    assert.equal(semData.body.user.birth_date, '');
  });

  it('lista os aniversariantes do mês com idade e destaque para hoje', async () => {
    const r = await call('GET', '/admin/birthdays', { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.month, today.slice(0, 7));
    const ana = r.body.birthdays.find((b) => b.id === hoje);
    assert.ok(ana);
    assert.equal(ana.is_today, true);
    assert.equal(ana.turning_age, 30);
    assert.equal(ana.email_sent, false);
    assert.ok(!r.body.birthdays.some((b) => b.id === outroMes));
    assert.ok(r.body.without_birth_date >= 1);
    assert.equal((await call('GET', '/admin/birthdays?month=2026-13', { token: admin })).status, 400);
  });

  it('o modelo de e-mail existe, tem variáveis e renderiza', async () => {
    const list = await call('GET', '/admin/email-templates', { token: admin });
    const t = list.body.templates.find((x) => x.key === 'birthday');
    assert.ok(t);
    assert.equal(t.enabled, true);
    assert.ok(t.variables.some((v) => v.name === 'idade'));
    const mail = await renderEmail('birthday', sampleData('birthday'));
    assert.match(mail.subject, /Feliz aniversário, Maria/);
    assert.match(mail.html, /Reservar uma sala/);
  });

  it('envia no dia do aniversário, uma única vez por ano, e só marca o que foi enviado', async () => {
    const calls = [];
    const ok = async (key, args) => { calls.push({ key, ...args }); return { success: true }; };
    assert.equal(await sendBirthdayEmails({ force: true, send: ok }), 1);
    assert.equal(calls[0].key, 'birthday');
    assert.equal(calls[0].to, 'ana@exemplo.com');
    assert.equal(calls[0].vars.nome, 'Ana');
    assert.equal(calls[0].vars.idade, 30);

    assert.equal(await sendBirthdayEmails({ force: true, send: ok }), 1 - 1); // já enviado neste ano
    assert.equal(calls.length, 1);

    const list = await call('GET', '/admin/birthdays', { token: admin });
    assert.equal(list.body.birthdays.find((b) => b.id === hoje).email_sent, true);

    // Envio que falha (ex.: sem SMTP) não marca como enviado e tenta de novo depois.
    await db.run('UPDATE users SET birthday_sent_year = NULL WHERE id = ?', [hoje]);
    assert.equal(await sendBirthdayEmails({ force: true, send: async () => ({ success: false, skipped: true }) }), 0);
    assert.equal(await sendBirthdayEmails({ force: true, send: ok }), 1);
  });

  it('quem nasceu em 29/02 aparece em 28/02 nos anos não bissextos', async () => {
    const rows = await birthdaysOfMonth('2027-02');
    await newClient('Bissexto', 'bissexto@exemplo.com', '2000-02-29');
    const after = await birthdaysOfMonth('2027-02');
    assert.equal(after.length, rows.length + 1);
    assert.equal(after.find((b) => b.name === 'Bissexto').day, 28);
    assert.equal((await birthdaysOfMonth('2028-02')).find((b) => b.name === 'Bissexto').day, 29);
  });

  it('o cliente edita a própria data de nascimento no perfil', async () => {
    const reg = await call('POST', '/auth/register', { body: { name: 'Cliente Próprio', email: 'proprio@exemplo.com', password: 'senha-forte-1' } });
    const token = reg.body.token;
    const put = await call('PUT', '/auth/me', { token, body: { name: 'Cliente Próprio', birth_date: '1985-07-20' } });
    assert.equal(put.status, 200);
    assert.equal(put.body.user.birth_date, '1985-07-20');
    // Sem enviar o campo, a data salva continua.
    const again = await call('PUT', '/auth/me', { token, body: { name: 'Cliente Próprio' } });
    assert.equal(again.body.user.birth_date, '1985-07-20');
    assert.equal((await call('PUT', '/auth/me', { token, body: { name: 'Cliente Próprio', birth_date: '' } })).body.user.birth_date, '');
  });

  it('a seção respeita o perfil de acesso', async () => {
    const profiles = await call('GET', '/admin/profiles', { token: admin });
    const financeiro = profiles.body.profiles.find((p) => p.name === 'Financeiro').id;
    const recepcao = profiles.body.profiles.find((p) => p.name === 'Recepção').id;
    const mk = async (email, profile_id) => {
      await call('POST', '/admin/users', { token: admin, body: { name: email, email, password: 'senha-forte-1', profile_id } });
      return (await call('POST', '/auth/login', { body: { email, password: 'senha-forte-1' } })).body.token;
    };
    assert.equal((await call('GET', '/admin/birthdays', { token: await mk('fin@exemplo.com', financeiro) })).status, 403);
    assert.equal((await call('GET', '/admin/birthdays', { token: await mk('rec@exemplo.com', recepcao) })).status, 200);
  });
});
