import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

/* ---------- Pagar.me de mentira (só o que a troca de plano usa) ---------- */
const KEY = 'sk_test_mock_key';
const orders = new Map();
let nextOrder = 1;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/core/v5/orders') {
      const body = JSON.parse(raw);
      const id = `or_plan${nextOrder++}`;
      const order = { id, code: body.code, amount: body.payments[0].amount, status: 'pending', charges: [], checkouts: [{ id: `chk_${id}`, status: 'open', payment_url: `https://pay.example.test/${id}` }], body };
      orders.set(id, order);
      return send(200, order);
    }
    const m = url.pathname.match(/^\/core\/v5\/orders\/([^/]+)$/);
    if (req.method === 'GET' && m) return orders.has(m[1]) ? send(200, orders.get(m[1])) : send(404, { message: 'Order not found.' });
    send(404, { message: 'rota do mock não existe' });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

const payOrder = (id) => {
  const o = orders.get(id);
  o.status = 'paid';
  o.charges = [{ id: `ch_${id}`, status: 'paid', payment_method: 'pix', amount: o.amount, paid_amount: o.amount, paid_at: new Date().toISOString() }];
};

process.env.SQLITE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'senha-admin-123';
process.env.SEED_DEMO = 'false';
process.env.PAGARME_SECRET_KEY = KEY;
process.env.PAGARME_API_URL = `http://127.0.0.1:${mock.address().port}/core/v5`;
delete process.env.DB_HOST;

const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');
const { saveSettings } = await import('../services/settings.js');
const { generatePlanFees } = await import('../services/finance.js');
const { getSettings } = await import('../services/settings.js');
const { nowLocal } = await import('../utils/time.js');

let server;
let base;
let admin;
let client;
let plans;
const month = nowLocal().date.slice(0, 7);

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
const planByName = (n) => plans.find((p) => p.name === n);
const myPlan = async () => (await call('GET', '/auth/me', { token: client })).body.user.plan?.name ?? null;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@harmonizeoser.com.br', password: 'senha-admin-123' } })).body.token;
  client = (await call('POST', '/auth/register', { body: { name: 'Cliente Plano', email: 'plano@exemplo.com', password: 'senha-forte-1' } })).body.token;
});

after(() => { server.close(); mock.close(); });

describe('o cliente escolhe o plano', () => {
  it('lista os planos com preço, o atual e se o pagamento online está ligado', async () => {
    const r = await call('GET', '/me/plans', { token: client });
    assert.equal(r.status, 200);
    plans = r.body.plans;
    assert.deepEqual(plans.map((p) => p.name), ['Modo Brisa', 'Plano Raiz', 'Plano Ecossistema', 'Endereço Comercial']);
    assert.equal(planByName('Plano Raiz').price_cents, 14400);
    assert.equal(r.body.current_plan_id, planByName('Modo Brisa').id); // cadastro novo começa no Modo Brisa
    assert.equal(r.body.pending_plan_id, null);
    assert.equal(r.body.online_payments, false);
    assert.equal((await call('GET', '/me/plans')).status, 401);
  });

  it('plano pago precisa do pagamento online ligado e não muda nada sem ele', async () => {
    const r = await call('POST', `/me/plans/${planByName('Plano Raiz').id}/subscribe`, { token: client });
    assert.equal(r.status, 422);
    assert.match(r.body.message, /recepção/);
    assert.equal(await myPlan(), 'Modo Brisa');
  });

  it('plano pago gera a cobrança e só vale depois do pagamento confirmado', async () => {
    await saveSettings({ pagarme_enabled: 'true' });
    const raiz = planByName('Plano Raiz');
    const r = await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client });
    assert.equal(r.status, 201);
    assert.equal(r.body.activated, false);
    assert.match(r.body.payment.checkout_url, /^https:\/\/pay\.example\.test\//);
    assert.equal(r.body.payment.amount_cents, 14400);
    assert.match(r.body.payment.description, /Mensalidade Plano Raiz/);
    assert.equal(await myPlan(), 'Modo Brisa'); // ainda não pagou

    const list = await call('GET', '/me/plans', { token: client });
    assert.equal(list.body.pending_plan_id, raiz.id);

    // Clicar de novo reaproveita a mesma cobrança.
    const again = await call('POST', `/me/plans/${raiz.id}/subscribe`, { token: client });
    assert.equal(again.body.payment.id, r.body.payment.id);

    // O Pagar.me confirma; ao voltar, o cliente sincroniza e o plano passa a valer.
    const orderId = [...orders.keys()].at(-1);
    payOrder(orderId);
    const sync = await call('POST', `/payments/${r.body.payment.id}/sync`, { token: client });
    assert.equal(sync.body.payment.status, 'paid');
    assert.equal(await myPlan(), 'Plano Raiz');
    assert.equal((await call('GET', '/me/plans', { token: client })).body.pending_plan_id, null);
  });

  it('a mensalidade paga entra no Financeiro e o mês não é cobrado de novo', async () => {
    const rec = await db.query("SELECT * FROM receivables WHERE description LIKE 'Mensalidade Plano Raiz%'");
    assert.equal(rec.length, 1);
    assert.equal(rec[0].status, 'paid');
    assert.equal(Number(rec[0].amount_cents), 14400);
    const fees = await generatePlanFees(month, await getSettings());
    assert.equal(fees.created, 0);
    assert.equal((await db.query("SELECT id FROM receivables WHERE description LIKE 'Mensalidade Plano Raiz%'")).length, 1);
  });

  it('já ter o plano escolhido é recusado; plano sem mensalidade vale na hora', async () => {
    assert.equal((await call('POST', `/me/plans/${planByName('Plano Raiz').id}/subscribe`, { token: client })).status, 409);
    const free = await call('POST', `/me/plans/${planByName('Modo Brisa').id}/subscribe`, { token: client });
    assert.equal(free.status, 201);
    assert.equal(free.body.activated, true);
    assert.equal(await myPlan(), 'Modo Brisa');
  });

  it('a vitrine dos planos vem preenchida e a administração edita tudo', async () => {
    const eco = planByName('Plano Ecossistema');
    assert.equal(eco.subtitle, 'Pós-pago mensalista');
    assert.equal(eco.icon, 'tree');
    assert.equal(eco.price_label, 'Usa primeiro');
    assert.equal(eco.price_note, ', paga depois (dia 05)');
    assert.equal(eco.features.length, 3);
    assert.deepEqual(eco.tiers[0], { label: 'De 10 a 29,5 horas no mês', benefit: '-R$ 2,00 de desconto por hora' });
    assert.equal(planByName('Plano Raiz').featured, true);
    assert.equal(planByName('Plano Raiz').features.length, 4);
    assert.equal(planByName('Modo Brisa').features.length, 3);

    const edited = await call('PUT', `/admin/plans/${eco.id}`, {
      token: admin,
      body: {
        name: eco.name, description: eco.description, subtitle: 'Novo subtítulo', icon: 'sun', price_label: 'Sob consulta', price_note: ' /mês',
        featured: true, features: ['Primeiro benefício', 'Segundo benefício'], tiers: [{ label: 'Acima de 5 horas', benefit: '-R$ 1,00 por hora' }], tiers_note: 'Nota',
      },
    });
    assert.equal(edited.status, 200);
    const p = edited.body.plan;
    assert.equal(p.subtitle, 'Novo subtítulo');
    assert.equal(p.icon, 'sun');
    assert.equal(p.featured, true);
    assert.deepEqual(p.features, ['Primeiro benefício', 'Segundo benefício']);
    assert.deepEqual(p.tiers, [{ label: 'Acima de 5 horas', benefit: '-R$ 1,00 por hora' }]);

    // O cliente enxerga o que a administração salvou.
    const mine = (await call('GET', '/me/plans', { token: client })).body.plans.find((x) => x.id === eco.id);
    assert.equal(mine.price_label, 'Sob consulta');
    assert.deepEqual(mine.features, ['Primeiro benefício', 'Segundo benefício']);

    // Ícone fora da lista e benefício vazio são recusados.
    const bad = (extra) => call('PUT', `/admin/plans/${eco.id}`, { token: admin, body: { name: eco.name, ...extra } });
    assert.equal((await bad({ icon: 'foguete' })).status, 400);
    assert.equal((await bad({ features: [''] })).status, 400);
  });

  it('Endereço Comercial: plano em faixa larga, com 10% de desconto, contratado pelo WhatsApp', async () => {
    const end = planByName('Endereço Comercial');
    assert.equal(end.layout, 'banner');
    assert.equal(end.headline, 'Nosso Endereço Comercial Premium.');
    assert.equal(end.cta_label, 'Contratar Endereço Comercial');
    assert.equal(end.contact_only, true);
    assert.equal(end.price_cents, 8700);
    assert.equal(end.price_label, 'R$ 87,00');
    assert.equal(end.room_discount_percent, 10);
    assert.equal(end.features.length, 3);
    assert.equal(planByName('Plano Raiz').layout, 'card');

    // Não dá para assinar pela tela: a contratação é com a recepção.
    const r = await call('POST', `/me/plans/${end.id}/subscribe`, { token: client });
    assert.equal(r.status, 422);
    assert.match(r.body.message, /WhatsApp/);

    // A administração liga e desliga as opções; layout inválido é recusado.
    const put = (extra) => call('PUT', `/admin/plans/${end.id}`, { token: admin, body: { name: end.name, ...extra } });
    const off = await put({ layout: 'card', contact_only: false, headline: '', cta_label: '' });
    assert.equal(off.body.plan.layout, 'card');
    assert.equal(off.body.plan.contact_only, false);
    assert.equal((await put({ layout: 'faixa' })).status, 400);
    await put({ layout: 'banner', contact_only: true, headline: end.headline, cta_label: end.cta_label });
  });

  it('trocar de ideia antes de pagar descarta a cobrança anterior; plano inativo some', async () => {
    // Planos pagos extras, criados pela administração só para este teste.
    const mk = async (name, price_cents) => (await call('POST', '/admin/plans', { token: admin, body: { name, price_cents } })).body.plan;
    const pequeno = await mk('Plano Pequeno', 5000);
    const grande = await mk('Plano Grande', 90000);

    const first = await call('POST', `/me/plans/${pequeno.id}/subscribe`, { token: client });
    assert.equal(first.status, 201);
    const second = await call('POST', `/me/plans/${grande.id}/subscribe`, { token: client });
    assert.equal(second.status, 201);
    const pending = await db.query("SELECT plan_id FROM receivables WHERE user_id IS NOT NULL AND status = 'pending' AND plan_id IS NOT NULL");
    assert.deepEqual(pending.map((p) => Number(p.plan_id)), [grande.id]);

    await call('PUT', `/admin/plans/${pequeno.id}`, { token: admin, body: { name: 'Plano Pequeno', active: false } });
    assert.equal((await call('POST', `/me/plans/${pequeno.id}/subscribe`, { token: client })).status, 404);
  });

  it('baixa manual da mensalidade pela administração também ativa o plano', async () => {
    const rec = await db.get("SELECT id FROM receivables WHERE status = 'pending' AND plan_id IS NOT NULL");
    const r = await call('POST', `/admin/finance/receivables/${rec.id}/pay`, { token: admin, body: { method: 'dinheiro' } });
    assert.equal(r.status, 200);
    assert.equal(await myPlan(), 'Plano Grande');
  });
});
