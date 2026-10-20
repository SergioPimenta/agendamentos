import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { saveSettings } = await import('../services/settings.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let other;
let rooms;
let dayOffset = 3;

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

const nextDay = () => {
  let d = addDays(nowLocal().date, dayOffset++);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};

const outbox = () => globalThis.__mailOutbox ?? [];
const clearOutbox = () => { globalThis.__mailOutbox = []; };
const sentTo = (email) => outbox().filter((m) => m.to === email);
/** O envio dos convidados roda "em segundo plano": espera esvaziar a fila. */
const settle = () => new Promise((r) => setTimeout(r, 250));

const book = async (over = {}, token = client) => {
  const body = { room_id: rooms[0].id, date: nextDay(), start_time: '10:00', end_time: '11:00', attendees: 2, ...over };
  const r = await call('POST', '/bookings', { token, body });
  return { ...r, booking: r.body.bookings?.[0], date: body.date };
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1' } })).body.token;
  other = (await call('POST', '/auth/register', { body: { name: 'Outra Pessoa', email: 'outra@exemplo.com', password: 'senha-forte-2' } })).body.token;
  rooms = (await call('GET', '/rooms')).body.rooms;
});

after(() => server.close());

describe('convidados da reserva', () => {
  it('limpa a lista (minúsculas, sem repetidos, sem o próprio dono) e manda o convite com o evento para o calendário', async () => {
    clearOutbox();
    const r = await book({ guests: ['Ana@Exemplo.com', 'ana@exemplo.com', 'bruno@exemplo.com', 'TESTE@exemplo.com'] });
    assert.equal(r.status, 201);
    assert.deepEqual(r.booking.guests, ['ana@exemplo.com', 'bruno@exemplo.com']);
    await settle();

    for (const guest of ['ana@exemplo.com', 'bruno@exemplo.com']) {
      const mails = sentTo(guest);
      assert.equal(mails.length, 1, `${guest} deve receber exatamente um e-mail`);
      assert.match(mails[0].subject, /Você foi convidado\(a\)/);
      assert.match(mails[0].html, /Cliente Teste/); // quem convidou
      assert.match(mails[0].html, /Sala/);
      assert.ok(!/R\$/.test(mails[0].html), 'o convidado não pode ver valores');
      const ics = mails[0].attachments?.[0];
      assert.match(ics.filename, /\.ics$/);
      assert.match(ics.content, /BEGIN:VEVENT/);
    }
    assert.equal(sentTo('teste@exemplo.com').filter((m) => /convidado/i.test(m.subject)).length, 0);
  });

  it('recusa e-mail inválido e mais de 10 convidados', async () => {
    assert.equal((await book({ guests: ['nao-e-email'] })).status, 400);
    const many = Array.from({ length: 11 }, (_, i) => `pessoa${i}@exemplo.com`);
    assert.equal((await book({ guests: many })).status, 400);
  });

  it('reserva semanal manda um convite só por convidado, avisando que se repete', async () => {
    clearOutbox();
    const r = await book({ room_id: rooms[1].id, repeat_weeks: 2, guests: ['serie@exemplo.com'] });
    assert.equal(r.body.bookings.length, 3);
    await settle();
    const mails = sentTo('serie@exemplo.com');
    assert.equal(mails.length, 1);
    assert.match(mails[0].html, /se repete toda semana \(3 vezes\)/);
  });

  it('com aprovação ligada, o convite só sai depois que a recepção aprova', async () => {
    await saveSettings({ require_approval: 'true' });
    clearOutbox();
    const r = await book({ room_id: rooms[2].id, guests: ['aprovacao@exemplo.com'] });
    assert.equal(r.booking.status, 'pending');
    await settle();
    assert.equal(sentTo('aprovacao@exemplo.com').length, 0);

    const ok = await call('POST', `/admin/bookings/${r.booking.id}/status`, { token: admin, body: { status: 'confirmed' } });
    assert.equal(ok.status, 200);
    await settle();
    assert.equal(sentTo('aprovacao@exemplo.com').length, 1);
    await saveSettings({ require_approval: 'false' });
  });

  it('editar: convidado novo recebe o convite e quem já estava recebe o aviso de mudança', async () => {
    const r = await book({ room_id: rooms[3].id, guests: ['antigo@exemplo.com'] });
    await settle();
    clearOutbox();

    const edit = await call('PUT', `/bookings/${r.booking.id}`, { token: client, body: { start_time: '14:00', end_time: '15:00', guests: ['antigo@exemplo.com', 'novo@exemplo.com'] } });
    assert.equal(edit.status, 200);
    assert.deepEqual(edit.body.booking.guests, ['antigo@exemplo.com', 'novo@exemplo.com']);
    await settle();

    assert.match(sentTo('novo@exemplo.com')[0].subject, /Você foi convidado\(a\)/);
    assert.equal(sentTo('novo@exemplo.com').length, 1);
    assert.match(sentTo('antigo@exemplo.com')[0].subject, /Reserva atualizada/);

    // mudar só o título não incomoda ninguém
    clearOutbox();
    await call('PUT', `/bookings/${r.booking.id}`, { token: client, body: { title: 'Novo título' } });
    await settle();
    assert.equal(sentTo('antigo@exemplo.com').length, 0);
  });

  it('cancelar avisa os convidados', async () => {
    const r = await book({ room_id: rooms[4].id, guests: ['cancelar@exemplo.com'] });
    await settle();
    clearOutbox();
    const c = await call('POST', `/bookings/${r.booking.id}/cancel`, { token: client, body: {} });
    assert.equal(c.status, 200);
    await settle();
    assert.match(sentTo('cancelar@exemplo.com')[0].subject, /Reserva cancelada/);
  });

  it('o modelo do convite é editável no painel e pode ser desligado', async () => {
    const list = (await call('GET', '/admin/email-templates', { token: admin })).body.templates;
    for (const k of ['guest_invite', 'guest_changed', 'guest_cancelled']) assert.ok(list.some((t) => t.key === k), `falta o modelo ${k}`);
    const tpl = list.find((t) => t.key === 'guest_invite');
    assert.equal(tpl.recipient, 'Convidado');
    assert.equal(tpl.has_button, false);

    await call('PUT', '/admin/email-templates/guest_invite', {
      token: admin,
      body: { subject: 'Venha: {{sala}} em {{data}}', title: 'Convite especial', body: '{{anfitriao}} chamou você! {{horario}}', cta_label: '', enabled: true },
    });
    clearOutbox();
    await book({ room_id: rooms[5].id, guests: ['custom@exemplo.com'] });
    await settle();
    const mail = sentTo('custom@exemplo.com')[0];
    assert.match(mail.subject, /^Venha: Sala/);
    assert.match(mail.html, /Convite especial/);
    assert.match(mail.html, /Cliente Teste chamou você!/);

    await call('PUT', '/admin/email-templates/guest_invite', { token: admin, body: { subject: 'x {{sala}}', title: 'y', body: 'z', cta_label: '', enabled: false } });
    clearOutbox();
    await book({ room_id: rooms[0].id, start_time: '15:00', end_time: '16:00', guests: ['desligado@exemplo.com'] });
    await settle();
    assert.equal(sentTo('desligado@exemplo.com').length, 0);

    // uma variável que o modelo não conhece é recusada
    const bad = await call('PUT', '/admin/email-templates/guest_invite', { token: admin, body: { subject: '{{valor}}', title: 'y', body: 'z', cta_label: '', enabled: true } });
    assert.equal(bad.status, 422);
  });

  it('só o dono e a administração enxergam quem foi convidado', async () => {
    const r = await book({ room_id: rooms[1].id, start_time: '16:00', end_time: '17:00', guests: ['privado@exemplo.com'] });
    assert.deepEqual((await call('GET', `/bookings/${r.booking.id}`, { token: client })).body.booking.guests, ['privado@exemplo.com']);
    assert.deepEqual((await call('GET', `/bookings/${r.booking.id}`, { token: admin })).body.booking.guests, ['privado@exemplo.com']);
    assert.equal((await call('GET', `/bookings/${r.booking.id}`, { token: other })).status, 404);
    const day = (await call('GET', `/availability/day?date=${r.date}`)).body;
    assert.ok(!JSON.stringify(day).includes('privado@exemplo.com'));
  });
});
