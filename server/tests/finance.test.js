import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { addMinutesAt, nowLocal, nowStamp, addDays } = await import('../utils/time.js');
const { addMonthsStr, addMonthsToDate } = await import('../services/finance.js');

let server;
let base;
let admin;
let client;
let me;
let rooms;
let codeN = 0;

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

/** Reserva direto no banco, numa data/hora qualquer, com valor e situação de pagamento. */
const insertBooking = async ({ date, price = 0, overtime = 0, pay = 'pending', overtimePay = 'none', paidAt = null, method = null, roomId = rooms[0].id, userId = me.id }) => {
  const r = await db.run(
    `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
       total_minutes, included_minutes, price_cents, payment_status, overtime_minutes, overtime_cents, overtime_payment_status,
       paid_at, payment_method, overtime_paid_at, overtime_payment_method, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, '10:00', '11:00', ?, ?, 'confirmed', '', '', 1, 60, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `F-${++codeN}-${Date.now() % 100000}`, roomId, userId, date, `${date} 10:00`, `${date} 11:00`, price, pay,
      overtime ? 10 : 0, overtime, overtimePay, pay === 'paid' ? paidAt : null, pay === 'paid' ? method : null,
      overtimePay === 'paid' ? paidAt : null, overtimePay === 'paid' ? method : null, userId, nowStamp(), nowStamp(),
    ],
  );
  return r.insertId;
};

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Teste', email: 'teste@exemplo.com', password: 'senha-forte-1' } })).body.token;
  me = (await call('GET', '/auth/me', { token: client })).body.user;
  rooms = (await call('GET', '/rooms', { token: client })).body.rooms;
});

after(() => server.close());

describe('datas do financeiro', () => {
  it('soma meses mantendo o dia ou usando o último dia do mês', () => {
    assert.equal(addMonthsStr('2026-11', 1), '2026-12');
    assert.equal(addMonthsStr('2026-12', 1), '2027-01');
    assert.equal(addMonthsToDate('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsToDate('2026-01-15', 13), '2027-02-15');
  });
});

describe('contas a pagar', () => {
  it('só o admin acessa', async () => {
    assert.equal((await call('GET', '/admin/finance/payables', { token: client })).status, 403);
  });

  it('cria, repete por meses, marca como pago e reabre', async () => {
    const today = nowLocal().date;
    const created = await call('POST', '/admin/finance/payables', {
      token: admin, body: { description: 'Aluguel do espaço', supplier: 'Imobiliária X', category: 'Aluguel', amount_cents: 450000, due_date: addDays(today, 5), repeat_months: 2 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, 3);

    const list = await call('GET', '/admin/finance/payables?status=all', { token: admin });
    const rent = list.body.rows.filter((r) => r.description === 'Aluguel do espaço');
    assert.equal(rent.length, 3);
    assert.equal(list.body.totals.open_cents, 3 * 450000);
    assert.ok(list.body.categories.includes('Aluguel'));

    const first = rent.sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    assert.equal(first.status, 'open');
    assert.equal((await call('POST', `/admin/finance/payables/${first.id}/pay`, { token: admin, body: { method: 'pix' } })).status, 200);
    const paid = (await call('GET', '/admin/finance/payables?status=paid', { token: admin })).body;
    assert.equal(paid.rows.length, 1);
    assert.equal(paid.rows[0].payment_method, 'pix');
    assert.ok(paid.rows[0].paid_at.startsWith(today));

    await call('POST', `/admin/finance/payables/${first.id}/reopen`, { token: admin });
    assert.equal((await call('GET', '/admin/finance/payables?status=paid', { token: admin })).body.rows.length, 0);
  });

  it('marca como vencida e exclui "esta e as próximas" da série', async () => {
    const today = nowLocal().date;
    await call('POST', '/admin/finance/payables', { token: admin, body: { description: 'Internet', category: 'Internet', amount_cents: 15000, due_date: addDays(today, -3), repeat_months: 2 } });
    const rows = (await call('GET', '/admin/finance/payables?status=all', { token: admin })).body.rows.filter((r) => r.description === 'Internet').sort((a, b) => a.due_date.localeCompare(b.due_date));
    assert.equal(rows[0].status, 'overdue');
    assert.equal(rows[1].status, 'open');
    const del = await call('DELETE', `/admin/finance/payables/${rows[1].id}?scope=following`, { token: admin });
    assert.equal(del.body.deleted, 2);
    assert.equal((await call('GET', '/admin/finance/payables?status=all&q=internet', { token: admin })).body.rows.length, 1);
  });

  it('valida os dados', async () => {
    const bad = await call('POST', '/admin/finance/payables', { token: admin, body: { description: 'x', category: 'Aluguel', amount_cents: 0, due_date: '2026-13-45' } });
    assert.equal(bad.status, 400);
  });
});

describe('contas a receber', () => {
  const month = addMonthsStr(nowLocal().date.slice(0, 7), -2);

  it('monta a fatura do cliente por mês, com vencimento no mês seguinte', async () => {
    await insertBooking({ date: `${month}-05`, price: 10000, overtime: 2000, overtimePay: 'pending' });
    await insertBooking({ date: `${month}-12`, price: 5000, pay: 'paid', paidAt: `${month}-20 12:00:00`, method: 'pix' });
    const r = await call('GET', '/admin/finance/receivables?status=all', { token: admin });
    assert.equal(r.status, 200);
    const inv = r.body.rows.find((x) => x.kind === 'invoice' && x.month === month);
    assert.equal(inv.amount_cents, 17000);
    assert.equal(inv.paid_cents, 5000);
    assert.equal(inv.open_cents, 12000);
    assert.equal(inv.bookings, 2);
    assert.equal(inv.due_date, `${addMonthsStr(month, 1)}-10`);
    assert.equal(inv.status, 'overdue'); // venceu há mais de um mês
    assert.ok(r.body.totals_all.overdue_cents >= 12000);
  });

  it('mostra as reservas da fatura e dá baixa em tudo de uma vez, com a forma de pagamento', async () => {
    const detail = await call('GET', `/admin/finance/receivables/invoice?user_id=${me.id}&month=${month}`, { token: admin });
    assert.equal(detail.body.bookings.length, 2);

    const pay = await call('POST', '/admin/finance/receivables/invoice/pay', { token: admin, body: { user_id: me.id, month, method: 'boleto', date: nowLocal().date } });
    assert.equal(pay.body.updated, 2); // 1 reserva + 1 excedente
    const inv = (await call('GET', '/admin/finance/receivables?status=paid', { token: admin })).body.rows.find((x) => x.month === month);
    assert.equal(inv.status, 'paid');
    assert.equal(inv.open_cents, 0);

    const lines = (await call('GET', `/admin/finance/receivables/invoice?user_id=${me.id}&month=${month}`, { token: admin })).body.bookings;
    assert.ok(lines.some((l) => l.payment_method === 'boleto'));
    assert.ok(lines.some((l) => l.overtime_payment_method === 'boleto'));

    const reopen = await call('POST', '/admin/finance/receivables/invoice/reopen', { token: admin, body: { user_id: me.id, month } });
    assert.equal(reopen.body.updated, 3);
  });

  it('lançamento avulso: cria, paga e entra no fluxo de caixa', async () => {
    const today = nowLocal().date;
    const created = await call('POST', '/admin/finance/receivables', { token: admin, body: { description: 'Taxa de cadastro', category: 'Taxa/serviço', amount_cents: 8000, due_date: today, user_id: me.id } });
    assert.equal(created.status, 201);
    const row = (await call('GET', '/admin/finance/receivables?status=open&q=cadastro', { token: admin })).body.rows[0];
    assert.equal(row.kind, 'manual');
    assert.equal(row.user.id, me.id);
    assert.equal((await call('POST', `/admin/finance/receivables/${row.id}/pay`, { token: admin, body: { method: 'dinheiro' } })).status, 200);

    const cash = await call('GET', `/admin/finance/cashflow?from=${today.slice(0, 7)}-01&to=${today}`, { token: admin });
    const m = cash.body.movements.find((x) => x.description === 'Taxa de cadastro');
    assert.equal(m.type, 'in');
    assert.equal(m.method, 'dinheiro');
    assert.equal(m.amount_cents, 8000);
  });

  it('gera a mensalidade dos planos uma única vez por cliente', async () => {
    const plan = await db.get('SELECT id FROM plans WHERE price_cents > 0 AND active = 1 LIMIT 1');
    assert.ok(plan, 'o seed precisa ter um plano com mensalidade');
    await db.run('UPDATE users SET plan_id = ? WHERE id = ?', [plan.id, me.id]);
    const month2 = nowLocal().date.slice(0, 7);
    const a = await call('POST', '/admin/finance/receivables/plan-fees', { token: admin, body: { month: month2 } });
    assert.equal(a.body.created, 1);
    const b = await call('POST', '/admin/finance/receivables/plan-fees', { token: admin, body: { month: month2 } });
    assert.equal(b.body.created, 0);
    const rows = (await call('GET', '/admin/finance/receivables?status=open&q=mensalidade', { token: admin })).body.rows;
    assert.equal(rows.filter((r) => r.category === 'Mensalidade de plano').length, 1);
  });
});

describe('fluxo de caixa e visão geral', () => {
  it('soma entradas e saídas pagas no período, na data do pagamento', async () => {
    const today = nowLocal().date;
    const m = today.slice(0, 7);
    await insertBooking({ date: `${m}-01`, price: 20000, pay: 'paid', paidAt: `${today} 09:00:00`, method: 'pix' });
    await insertBooking({ date: `${m}-01`, price: 0, overtime: 3000, overtimePay: 'paid', paidAt: `${today} 09:30:00`, method: 'cartao' });
    const p = await call('POST', '/admin/finance/payables', { token: admin, body: { description: 'Energia', category: 'Energia', amount_cents: 12000, due_date: today } });
    assert.equal(p.status, 201);
    const energy = (await call('GET', '/admin/finance/payables?status=open&q=energia', { token: admin })).body.rows[0];
    await call('POST', `/admin/finance/payables/${energy.id}/pay`, { token: admin, body: { method: 'pix' } });

    const cash = (await call('GET', `/admin/finance/cashflow?from=${today}&to=${today}`, { token: admin })).body;
    const types = cash.movements.map((x) => `${x.type}:${x.category}`);
    assert.ok(types.includes('in:Reservas de salas'));
    assert.ok(types.includes('in:Excedente de horário'));
    assert.ok(types.includes('out:Energia'));
    assert.equal(cash.totals.in_cents - cash.totals.out_cents, cash.totals.result_cents);
    assert.equal(cash.movements.at(-1).balance_cents, cash.totals.result_cents);
    assert.equal(cash.series.length, 12);
  });

  it('exporta o fluxo em CSV', async () => {
    const res = await fetch(`${base}/api/admin/finance/cashflow/export`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(await res.text(), /Resultado/);
  });

  it('a visão geral consolida caixa, pendências e quebras', async () => {
    const o = await call('GET', '/admin/finance/overview', { token: admin });
    assert.equal(o.status, 200);
    assert.ok(o.body.cash.in_cents >= 23000);
    assert.ok(o.body.cash.out_cents >= 12000);
    assert.equal(o.body.cash.result_cents, o.body.cash.in_cents - o.body.cash.out_cents);
    assert.ok(o.body.receivable.open_cents >= 0 && o.body.payable.open_cents > 0);
    assert.equal(o.body.series.length, 6);
    assert.ok(o.body.by_method.some((x) => x.method === 'pix'));
    assert.ok(Array.isArray(o.body.top_debtors));
    assert.ok(o.body.next_payables.length > 0);
  });

  it('o botão antigo de pagar uma reserva passa a registrar data e forma', async () => {
    const id = await insertBooking({ date: nowLocal().date, price: 5000 });
    const r = await call('POST', `/admin/bookings/${id}/payment`, { token: admin, body: { payment_status: 'paid', method: 'pix' } });
    assert.equal(r.status, 200);
    const row = await db.get('SELECT paid_at, payment_method FROM bookings WHERE id = ?', [id]);
    assert.equal(row.payment_method, 'pix');
    assert.ok(row.paid_at);
    await call('POST', `/admin/bookings/${id}/payment`, { token: admin, body: { payment_status: 'pending' } });
    assert.equal((await db.get('SELECT paid_at FROM bookings WHERE id = ?', [id])).paid_at, null);
    assert.ok(addMinutesAt(nowLocal().at, 1));
  });
});
