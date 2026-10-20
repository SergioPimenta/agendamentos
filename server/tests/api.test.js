import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { addDays, nowLocal, weekdayOf } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;

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

/** Próxima data (>= n dias à frente) em que o espaço abre (segunda a sexta). */
const weekday = (n = 3) => {
  let d = addDays(nowLocal().date, n);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;

  const a = await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } });
  assert.equal(a.status, 200);
  admin = a.body.token;

  const c = await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'Teste@Exemplo.com', password: 'senha-forte-1' } });
  assert.equal(c.status, 201);
  client = c.body.token;
});

after(() => server.close());

describe('autenticação', () => {
  it('rejeita senha errada com mensagem genérica', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'teste@exemplo.com', password: 'errada-errada' } });
    assert.equal(r.status, 401);
  });
  it('normaliza o e-mail no login', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'TESTE@exemplo.com', password: 'senha-forte-1' } });
    assert.equal(r.status, 200);
  });
  it('cliente não acessa rotas de admin', async () => {
    assert.equal((await call('GET', '/admin/users', { token: client })).status, 403);
    assert.equal((await call('GET', '/bookings')).status, 401);
  });
});

describe('disponibilidade e reservas', () => {
  let roomId;
  let date;
  let bookingId;

  before(async () => {
    const rooms = await call('GET', '/rooms', { token: client });
    roomId = rooms.body.rooms[0].id;
    date = weekday(3);
  });

  it('mostra a grade do dia com horários livres', async () => {
    const r = await call('GET', `/availability/day?date=${date}&room_id=${roomId}`, { token: client });
    assert.equal(r.status, 200);
    assert.equal(r.body.open, true);
    assert.ok(r.body.rooms[0].slots.every((s) => s.state === 'free'));
  });

  it('cria reserva avulsa e cobra pelo valor da sala', async () => {
    const r = await call('POST', '/bookings', { token: client, body: { room_id: roomId, date, start_time: '10:00', end_time: '11:00', title: 'Teste', attendees: 1 } });
    assert.equal(r.status, 201);
    const b = r.body.bookings[0];
    bookingId = b.id;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.price_cents, 3500); // Sala Brisa: R$ 35/h, plano Avulso
    assert.equal(b.payment_status, 'pending');
  });

  it('bloqueia conflito de horário (inclusive sobreposição parcial)', async () => {
    const r = await call('POST', '/bookings', { token: admin, body: { room_id: roomId, date, start_time: '10:30', end_time: '11:30', attendees: 1 } });
    assert.equal(r.status, 409);
    const ok = await call('POST', '/bookings', { token: admin, body: { room_id: roomId, date, start_time: '11:00', end_time: '12:00', attendees: 1 } });
    assert.equal(ok.status, 201, 'horário adjacente deve ser permitido');
  });

  it('impede duas reservas simultâneas no mesmo horário (corrida)', async () => {
    const d = weekday(5);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call('POST', '/bookings', { token: client, body: { room_id: roomId, date: d, start_time: '15:00', end_time: '16:00', attendees: 1 } })),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 5);
  });

  it('aplica regras: horário fechado, domingo, duração mínima, capacidade', async () => {
    assert.equal((await call('POST', '/bookings', { token: client, body: { room_id: roomId, date, start_time: '06:00', end_time: '07:00', attendees: 1 } })).status, 422);
    let sunday = addDays(nowLocal().date, 2);
    while (weekdayOf(sunday) !== 0) sunday = addDays(sunday, 1);
    assert.equal((await call('POST', '/bookings', { token: client, body: { room_id: roomId, date: sunday, start_time: '10:00', end_time: '11:00', attendees: 1 } })).status, 422);
    assert.equal((await call('POST', '/bookings', { token: client, body: { room_id: roomId, date, start_time: '13:00', end_time: '13:30', attendees: 1 } })).status, 422);
    assert.equal((await call('POST', '/bookings', { token: client, body: { room_id: roomId, date, start_time: '13:00', end_time: '14:00', attendees: 9 } })).status, 422);
    assert.equal((await call('POST', '/bookings', { token: client, body: { room_id: roomId, date, start_time: '13:10', end_time: '14:10', attendees: 1 } })).status, 422);
  });

  it('não expõe dados de outros clientes na grade', async () => {
    const r = await call('GET', `/availability/day?date=${date}&room_id=${roomId}`, { token: client });
    const booked = r.body.rooms[0].slots.filter((s) => s.state === 'booked');
    assert.ok(booked.length >= 2);
    assert.ok(booked.every((s) => Object.keys(s).every((k) => ['time', 'state', 'mine'].includes(k))));
    assert.ok(booked.find((s) => s.time === '10:00').mine);
    assert.ok(!booked.find((s) => s.time === '11:00').mine);
  });

  it('cliente só enxerga as próprias reservas', async () => {
    const mine = await call('GET', '/bookings', { token: client });
    assert.ok(mine.body.bookings.every((b) => b.user.email === 'teste@exemplo.com'));
    const all = await call('GET', '/admin/bookings', { token: admin });
    assert.ok(all.body.total > mine.body.bookings.length);
  });

  it('repete semanalmente e ignora datas em conflito', async () => {
    const d = weekday(10);
    await call('POST', '/bookings', { token: admin, body: { room_id: roomId, date: addDays(d, 7), start_time: '09:00', end_time: '10:00', attendees: 1 } });
    const r = await call('POST', '/bookings', { token: client, body: { room_id: roomId, date: d, start_time: '09:00', end_time: '10:00', attendees: 1, repeat_weeks: 2, skip_conflicts: true } });
    assert.equal(r.status, 201);
    assert.equal(r.body.bookings.length, 2);
    assert.equal(r.body.skipped.length, 1);
  });

  it('permite cancelar e libera o horário', async () => {
    const c = await call('POST', `/bookings/${bookingId}/cancel`, { token: client, body: {} });
    assert.equal(c.status, 200);
    const again = await call('POST', '/bookings', { token: admin, body: { room_id: roomId, date, start_time: '10:00', end_time: '11:00', attendees: 1 } });
    assert.equal(again.status, 201);
  });

  it('bloqueia cancelamento dentro da janela mínima (cliente), mas admin pode', async () => {
    const d = weekday(4);
    const mk = await call('POST', '/bookings', { token: client, body: { room_id: roomId, date: d, start_time: '17:00', end_time: '18:00', attendees: 1 } });
    assert.equal(mk.status, 201);
    const s = (await call('GET', '/admin/settings', { token: admin })).body.settings;
    await call('PUT', '/admin/settings', { token: admin, body: { ...s, cancel_min_hours: 168 } }); // 7 dias
    const c = await call('POST', `/bookings/${mk.body.bookings[0].id}/cancel`, { token: client, body: {} });
    assert.equal(c.status, 403);
    const e = await call('PUT', `/bookings/${mk.body.bookings[0].id}`, { token: client, body: { title: 'novo' } });
    assert.equal(e.status, 403);
    const a = await call('POST', `/bookings/${mk.body.bookings[0].id}/cancel`, { token: admin, body: {} });
    assert.equal(a.status, 200);
    await call('PUT', '/admin/settings', { token: admin, body: { ...s, cancel_min_hours: 2 } });
  });
});

describe('planos e consumo', () => {
  it('desconta horas incluídas do plano Flex antes de cobrar', async () => {
    const plans = (await call('GET', '/admin/plans', { token: admin })).body.plans;
    const flex = plans.find((p) => p.name === 'Flex');
    const u = await call('POST', '/admin/users', { token: admin, body: { name: 'Membro Flex', email: 'flex@exemplo.com', password: 'flex-senha-12', plan_id: flex.id } });
    assert.equal(u.status, 201);
    const login = await call('POST', '/auth/login', { body: { email: 'flex@exemplo.com', password: 'flex-senha-12' } });
    const token = login.body.token;
    const rooms = (await call('GET', '/rooms', { token })).body.rooms;
    const room = rooms.find((r) => r.price_cents === 5500); // Cachoeira R$ 55/h
    const d = weekday(20);

    // 2h: totalmente incluídas (3h no plano)
    const b1 = (await call('POST', '/bookings', { token, body: { room_id: room.id, date: d, start_time: '09:00', end_time: '11:00', attendees: 1 } })).body.bookings[0];
    assert.equal(b1.included_minutes, 120);
    assert.equal(b1.price_cents, 0);

    // 2h: 1h incluída + 1h paga com 10% de desconto = 55 * 0,9
    const b2 = (await call('POST', '/bookings', { token, body: { room_id: room.id, date: d, start_time: '13:00', end_time: '15:00', attendees: 1 } })).body.bookings[0];
    assert.equal(b2.included_minutes, 60);
    assert.equal(b2.price_cents, 4950);

    const usage = (await call('GET', `/me/usage?month=${d.slice(0, 7)}`, { token })).body;
    assert.equal(usage.included_used, 180);
    assert.equal(usage.included_remaining, 0);
    assert.equal(usage.totals.amount_cents, 4950);

    // cancelar a primeira devolve as horas
    await call('POST', `/bookings/${b1.id}/cancel`, { token, body: {} });
    const after = (await call('GET', `/me/usage?month=${d.slice(0, 7)}`, { token })).body;
    assert.equal(after.included_used, 60);
  });
});

describe('bloqueios', () => {
  it('impede reservas em períodos bloqueados e pede confirmação se houver reservas', async () => {
    const rooms = (await call('GET', '/rooms', { token: client })).body.rooms;
    const room = rooms[2];
    const d = weekday(30);
    const blk = await call('POST', '/admin/blocks', { token: admin, body: { room_id: room.id, start_date: d, start_time: '08:00', end_date: d, end_time: '12:00', reason: 'Manutenção' } });
    assert.equal(blk.status, 201);
    const r = await call('POST', '/bookings', { token: client, body: { room_id: room.id, date: d, start_time: '09:00', end_time: '10:00', attendees: 1 } });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Manutenção/);
    const ok = await call('POST', '/bookings', { token: client, body: { room_id: room.id, date: d, start_time: '13:00', end_time: '14:00', attendees: 1 } });
    assert.equal(ok.status, 201);
    const again = await call('POST', '/admin/blocks', { token: admin, body: { room_id: room.id, start_date: d, start_time: '12:00', end_date: d, end_time: '15:00' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'HAS_BOOKINGS');
  });
});

describe('painel e relatórios', () => {
  it('devolve indicadores e exporta CSV', async () => {
    const dash = await call('GET', '/admin/dashboard', { token: admin });
    assert.equal(dash.status, 200);
    assert.ok(dash.body.kpis.active_clients >= 2);
    const rep = await call('GET', `/admin/reports?from=${nowLocal().date}&to=${addDays(nowLocal().date, 60)}`, { token: admin });
    assert.equal(rep.status, 200);
    assert.ok(rep.body.totals.bookings > 0);
    const csv = await fetch(`${base}/api/admin/reports/export`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
  });
});

describe('modelos de e-mail', () => {
  const draft = (over = {}) => ({ subject: 'Oi {{nome}}', title: 'Título', body: 'Texto para {{nome}}.', cta_label: 'Abrir', enabled: true, ...over });

  it('lista o catálogo com os textos padrão e só para admin', async () => {
    assert.equal((await call('GET', '/admin/email-templates', { token: client })).status, 403);
    const r = await call('GET', '/admin/email-templates', { token: admin });
    assert.equal(r.status, 200);
    const keys = r.body.templates.map((t) => t.key);
    for (const k of ['welcome', 'password_reset', 'booking_confirmed', 'booking_pending', 'booking_recurring', 'booking_approved', 'booking_changed', 'booking_cancelled_client', 'booking_cancelled_admin', 'admin_new_booking']) {
      assert.ok(keys.includes(k), `falta ${k}`);
    }
    const welcome = r.body.templates.find((t) => t.key === 'welcome');
    assert.equal(welcome.customized, false);
    assert.deepEqual(welcome.values, welcome.defaults);
  });

  it('salva, personaliza e volta ao padrão', async () => {
    const saved = await call('PUT', '/admin/email-templates/booking_changed', { token: admin, body: draft({ subject: 'Mudou, {{nome}}!' }) });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.template.customized, true);
    assert.equal(saved.body.template.values.subject, 'Mudou, {{nome}}!');

    const reset = await call('DELETE', '/admin/email-templates/booking_changed', { token: admin });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.template.customized, false);
    assert.match(reset.body.template.values.subject, /Reserva atualizada/);
  });

  it('recusa variável que o modelo não conhece e modelo inexistente', async () => {
    const bad = await call('PUT', '/admin/email-templates/welcome', { token: admin, body: draft({ body: 'Oi {{sala}}' }) });
    assert.equal(bad.status, 422);
    assert.match(bad.body.message, /\{\{sala\}\}/);
    assert.equal((await call('PUT', '/admin/email-templates/nao_existe', { token: admin, body: draft() })).status, 404);
  });

  it('a prévia troca as variáveis e escapa HTML', async () => {
    const r = await call('POST', '/admin/email-templates/booking_confirmed/preview', {
      token: admin,
      body: draft({ subject: '{{sala}} em {{data}}', body: '<b>Olá</b> {{nome}}\n{{empresa}}' }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.subject, 'Sala Cachoeira em 15/11/2026');
    assert.match(r.body.html, /&lt;b&gt;Olá&lt;\/b&gt; /);
    assert.doesNotMatch(r.body.html, /\{\{/);
    assert.match(r.body.html, /AB3K9Z/);
  });

  it('o e-mail de redefinição de senha não pode ser desligado; os outros podem', async () => {
    const locked = await call('PUT', '/admin/email-templates/password_reset', { token: admin, body: draft({ body: 'Olá {{nome}}, link: {{link}}', enabled: false }) });
    assert.equal(locked.body.template.enabled, true);

    const { sendTemplated } = await import('../services/emailTemplates.js');
    await call('PUT', '/admin/email-templates/booking_approved', { token: admin, body: draft({ enabled: false }) });
    assert.equal((await sendTemplated('booking_approved', { to: 'x@y.com', vars: {} })).disabled, true);
    await call('PUT', '/admin/email-templates/booking_approved', { token: admin, body: draft({ enabled: true }) });
    assert.notEqual((await sendTemplated('booking_approved', { to: 'x@y.com', vars: {} })).disabled, true);
    await call('DELETE', '/admin/email-templates/booking_approved', { token: admin });
    await call('DELETE', '/admin/email-templates/password_reset', { token: admin });
  });

  it('avisa que o envio de teste precisa de SMTP configurado', async () => {
    const r = await call('POST', '/admin/email-templates/welcome/test', { token: admin, body: draft() });
    assert.equal(r.status, 409);
  });
});
