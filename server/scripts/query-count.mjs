// Conta e mede as consultas ao banco de cada tela do painel (para achar o que deixa o painel lento).
// Uso: node scripts/query-count.mjs   (usa o banco local de desenvolvimento, só leitura)
process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = 'false';
const { createApp } = await import('../index.js');
const { db } = await import('../db/index.js');

const log = [];
for (const k of ['query', 'get']) {
  const orig = db[k].bind(db);
  db[k] = async (sql, params) => {
    const s = performance.now();
    const r = await orig(sql, params);
    log.push({ ms: performance.now() - s, sql: String(sql).replace(/\s+/g, ' ').trim().slice(0, 110) });
    return r;
  };
}

const app = await createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@harmonizeoser.com.br', password: process.env.ADMIN_PASSWORD || 'admin123' }) }).then((r) => r.json());
const h = { Authorization: `Bearer ${login.token}` };
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const pages = [
  ['dashboard', '/admin/dashboard'], ['agenda', `/admin/agenda?date=${today}`], ['reservas', '/admin/bookings?page=1&limit=25'],
  ['clientes', '/admin/users?page=1&per_page=25'], ['relatórios (mês)', `/admin/reports?from=${month}-01&to=${today}`],
  ['relatórios (ano)', '/admin/reports?from=2026-01-01&to=2026-12-31'], ['aniversariantes', '/admin/birthdays'], ['convidados', '/admin/guests?page=1'],
  ['financeiro', '/admin/finance/summary'], ['banco de horas', '/admin/hour-bank'], ['pacotes', '/admin/packages'], ['planos', '/admin/plans'], ['salas', '/admin/rooms'],
];
for (const [label, url] of pages) {
  log.length = 0;
  const s = performance.now();
  const r = await fetch(`${base}${url}`, { headers: h });
  await r.text();
  const total = performance.now() - s;
  const slow = [...log].sort((a, b) => b.ms - a.ms)[0];
  console.log(`${String(r.status).padEnd(4)} ${label.padEnd(18)} ${String(log.length).padStart(3)} consultas  ${total.toFixed(0).padStart(5)} ms${slow ? `  | mais lenta ${slow.ms.toFixed(0)}ms: ${slow.sql}` : ''}`);
}
server.close();
process.exit(0);
