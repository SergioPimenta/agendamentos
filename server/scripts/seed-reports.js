/**
 * Popula o banco com um histórico realista (reservas, check-ins, excedentes, pagamentos, contas a pagar e a receber)
 * para ver como relatórios, painel e Financeiro se comportam. SÓ PARA DESENVOLVIMENTO.
 *
 *   node scripts/seed-reports.js           # gera os dados (faz um backup do banco antes)
 *   node scripts/seed-reports.js --clear   # remove só o que este script criou
 *
 * Tudo o que o script cria é identificável: reservas com código "SD-…" e demais registros com a marca "seed-relatorios".
 * Os dados já existentes (reais ou de teste) não são alterados; as reservas novas respeitam as que já existem.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { addMonthsStr, invoiceDueDate } from '../services/finance.js';
import { getSettings } from '../services/settings.js';
import { addDays, fromMin, nowLocal, toMin, weekdayOf } from '../utils/time.js';

const MARK = 'seed-relatorios';
const DAYS_BACK = 120;
const DAYS_AHEAD = 21;

await migrate();

/* ---------------- limpar ---------------- */
if (process.argv.includes('--clear')) {
  const b = await db.run("DELETE FROM bookings WHERE code LIKE 'SD-%'");
  const p = await db.run('DELETE FROM payables WHERE notes = ?', [MARK]);
  const r = await db.run('DELETE FROM receivables WHERE notes = ?', [MARK]);
  const u = await db.run('DELETE FROM users WHERE notes = ?', [MARK]);
  console.log(`Removido: ${b.changes} reservas, ${p.changes} contas a pagar, ${r.changes} lançamentos a receber, ${u.changes} clientes.`);
  process.exit(0);
}

if ((await db.get("SELECT COUNT(*) AS n FROM bookings WHERE code LIKE 'SD-%'")).n > 0) {
  console.log('Já existem dados gerados por este script. Rode com --clear antes de gerar de novo.');
  process.exit(1);
}

/* ---------------- backup ---------------- */
if (config.dbDriver === 'sqlite' && config.sqlitePath !== ':memory:') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(path.dirname(config.sqlitePath), `backup-antes-do-seed-${stamp}.db`);
  await db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log(`Backup do banco: ${file}`);
}

/* ---------------- utilidades ---------------- */
let seedState = 20261019;
const rand = () => {
  seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (items) => {
  const total = items.reduce((a, i) => a + i.w, 0);
  let r = rand() * total;
  for (const i of items) { r -= i.w; if (r <= 0) return i.v; }
  return items.at(-1).v;
};
const pad = (n) => String(n).padStart(2, '0');
const stampAt = (date, minutes, sec = 0) => `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(sec)}`;
const addMin = (stamp, n) => {
  const d = new Date(`${stamp.slice(0, 10)}T${stamp.slice(11, 19)}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const minutesBetween = (a, b) => Math.round((Date.parse(`${b.slice(0, 10)}T${b.slice(11, 16)}:00Z`) - Date.parse(`${a.slice(0, 10)}T${a.slice(11, 16)}:00Z`)) / 60000);
const usedCodes = new Set((await db.query('SELECT code FROM bookings')).map((r) => r.code));
const code = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const c = `SD-${Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join('')}`;
    if (!usedCodes.has(c)) { usedCodes.add(c); return c; }
  }
};

const now = nowLocal();
const today = now.date;
const rules = await getSettings();
const rooms = await db.query('SELECT * FROM rooms WHERE active = 1 ORDER BY sort_order, id');
const plans = Object.fromEntries((await db.query('SELECT * FROM plans')).map((p) => [p.name, p]));
const hoursByDay = Object.fromEntries((await db.query('SELECT * FROM business_hours')).map((h) => [Number(h.weekday), h]));
const adminId = (await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")).id;

/* ---------------- clientes ---------------- */
// since: há quantos dias é cliente · behavior: como paga · w: o quanto reserva · fav: forma de pagamento preferida
const people = [
  ['Marina Albuquerque', 'marina.albuquerque', 'Terapeuta integrativa', 'Flex', 118, 'good', 2.4, 'pix'],
  ['Bruno Tavares', 'bruno.tavares', 'Tavares Advocacia', 'Sala Privativa', 100, 'good', 3.0, 'transferencia'],
  ['Ana Beatriz Lima', 'ana.lima', 'Psicóloga clínica', 'Flex', 96, 'good', 2.2, 'pix'],
  ['Caio Fontana', 'caio.fontana', 'Fontana Consultoria', 'Avulso', 90, 'late', 1.2, 'boleto'],
  ['Juliana Rocha', 'juliana.rocha', 'Nutricionista', 'Flex', 76, 'good', 1.8, 'cartao'],
  ['Rafael Mendes', 'rafael.mendes', 'Fisioterapeuta', 'Day Pass', 70, 'late', 1.4, 'pix'],
  ['Helena Duarte', 'helena.duarte', 'Duarte Nutrição', 'Avulso', 56, 'good', 1.0, 'pix'],
  ['Carolina Prado', 'carolina.prado', 'Coach de carreira', 'Avulso', 60, 'bad', 1.3, 'boleto'],
  ['Marcos Vinícius', 'marcos.vinicius', 'Terapeuta ocupacional', 'Avulso', 50, 'good', 0.9, 'cartao'],
  ['Patrícia Souza', 'patricia.souza', 'Massoterapeuta', 'Day Pass', 40, 'good', 1.1, 'pix'],
  ['Eduardo Lacerda', 'eduardo.lacerda', 'Lacerda Mentoria', 'Avulso', 28, 'late', 0.8, 'dinheiro'],
  ['Fernanda Ribeiro', 'fernanda.ribeiro', 'Psicopedagoga', 'Flex', 20, 'good', 1.2, 'pix'],
  ['Thiago Almeida', 'thiago.almeida', 'Quiropraxia', 'Avulso', 12, 'good', 0.7, 'cartao'],
];
const clients = [];
const passwordHash = await bcrypt.hash('cliente123', 10);
for (const [name, handle, company, plan, since, behavior, w, fav] of people) {
  const email = `${handle}@exemplo.com`;
  const exists = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  const joined = addDays(today, -since);
  let id = exists?.id;
  if (!id) {
    const r = await db.run(
      `INSERT INTO users (name, email, password, role, phone, document, company, plan_id, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, 'client', ?, '', ?, ?, ?, 1, ?, ?)`,
      [name, email, passwordHash, `(41) 9${int(8000, 9999)}-${int(1000, 9999)}`, company, plans[plan].id, MARK, `${joined} 09:00:00`, `${joined} 09:00:00`],
    );
    id = r.insertId;
  }
  clients.push({ id: Number(id), name, plan: plans[plan], since, joined, behavior, w, fav });
}

/* ---------------- ocupação já existente ---------------- */
const occ = new Map(); // "sala|data" -> [{s, e}]
const key = (roomId, date) => `${roomId}|${date}`;
const occupy = (roomId, date, s, e) => {
  const k = key(roomId, date);
  if (!occ.has(k)) occ.set(k, []);
  occ.get(k).push({ s, e });
};
const isFree = (roomId, date, s, e) => !(occ.get(key(roomId, date)) ?? []).some((x) => s < x.e && e > x.s);
for (const b of await db.query("SELECT room_id, date, start_time, end_time FROM bookings WHERE status IN ('pending','confirmed')")) {
  occupy(b.room_id, b.date, toMin(b.start_time), toMin(b.end_time));
}
for (const bl of await db.query('SELECT room_id, start_at, end_at FROM blocks')) {
  for (const r of rooms) {
    if (bl.room_id && Number(bl.room_id) !== Number(r.id)) continue;
    for (let d = bl.start_at.slice(0, 10); d <= bl.end_at.slice(0, 10); d = addDays(d, 1)) {
      occupy(r.id, d, d === bl.start_at.slice(0, 10) ? toMin(bl.start_at.slice(11)) : 0, d === bl.end_at.slice(0, 10) ? toMin(bl.end_at.slice(11)) : 1440);
    }
  }
}

/* ---------------- gerar reservas ---------------- */
const draft = []; // { room, client, date, start, end, series? }
const roomPop = { brisa: 1.0, flor: 0.9, cachoeira: 1.25, terra: 0.7, arvore: 0.85, sol: 0.6 };
const weekdayFactor = [0, 0.8, 1.1, 1.2, 1.1, 0.8, 0.5];
const startHours = [0.5, 1.4, 1.6, 1.4, 0.8, 0.7, 1.2, 1.5, 1.5, 1.3, 0.9, 0.5]; // 8h…19h
const durations = [{ v: 60, w: 45 }, { v: 90, w: 15 }, { v: 120, w: 25 }, { v: 180, w: 10 }, { v: 240, w: 5 }];
const clientByName = Object.fromEntries(clients.map((c) => [c.name, c]));
const roomBySlug = Object.fromEntries(rooms.map((r) => [r.slug, r]));
const titles = ['', '', '', '', 'Atendimento', 'Atendimento individual', 'Sessão', 'Reunião de equipe', 'Oficina', 'Grupo terapêutico', 'Mentoria'];

const addDraft = (room, client, date, s, e, series = null) => {
  if (date < client.joined) return false;
  if (!isFree(room.id, date, s, e)) return false;
  occupy(room.id, date, s, e);
  draft.push({ room, client, date, s, e, series });
  return true;
};

// Reservas fixas (recorrentes): o dia da semana se repete e algumas semanas ficam de fora.
const recurring = [
  ['Marina Albuquerque', 'flor', 2, 10 * 60, 12 * 60, 1],
  ['Bruno Tavares', 'arvore', 1, 14 * 60, 18 * 60, 1],
  ['Bruno Tavares', 'arvore', 4, 14 * 60, 18 * 60, 1],
  ['Ana Beatriz Lima', 'brisa', 3, 9 * 60, 11 * 60, 1],
  ['Juliana Rocha', 'terra', 5, 14 * 60, 16 * 60, 2],
];
for (const [who, slug, weekday, s, e, everyWeeks] of recurring) {
  const client = clientByName[who];
  const series = crypto.randomBytes(8).toString('hex');
  let n = 0;
  for (let d = addDays(today, -DAYS_BACK); d <= addDays(today, DAYS_AHEAD); d = addDays(d, 1)) {
    if (weekdayOf(d) !== weekday) continue;
    if (n++ % everyWeeks !== 0 || rand() < 0.06) continue;
    addDraft(roomBySlug[slug], client, d, s, e, series);
  }
}

// Reservas avulsas: densidade por sala, dia da semana, horário e proximidade da data.
for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
  const date = addDays(today, offset);
  const hours = hoursByDay[weekdayOf(date)];
  if (!hours || !Number(hours.is_open)) continue;
  const open = toMin(hours.open_time);
  const close = toMin(hours.close_time);
  const growth = offset <= 0 ? 0.55 + 0.45 * (1 + offset / DAYS_BACK) : Math.max(0.12, 0.8 - offset / 25);
  for (const room of rooms) {
    const expected = 2.6 * (roomPop[room.slug] ?? 0.8) * weekdayFactor[weekdayOf(date)] * growth;
    const k = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      for (let tries = 0; tries < 8; tries++) {
        const hour = 8 + weighted(startHours.map((w, idx) => ({ v: idx, w })));
        const s = hour * 60 + (rand() < 0.25 ? 30 : 0);
        const dur = weighted(durations);
        const e = s + dur;
        if (s < open || e > close || dur < room.min_minutes || dur > room.max_minutes) continue;
        const eligible = clients.filter((c) => date >= c.joined);
        if (!eligible.length) break; // ainda não havia clientes nesta data
        if (addDraft(room, weighted(eligible.map((c) => ({ v: c, w: c.w }))), date, s, e)) break;
      }
    }
  }
}
draft.sort((a, b) => (a.date + fromMin(a.s)).localeCompare(b.date + fromMin(b.s)));

/* ---------------- preço, plano e situação de cada reserva ---------------- */
const usedIncluded = new Map(); // "cliente|mês" -> minutos do plano já usados
const rows = [];
const methodFor = (c) => (rand() < 0.7 ? c.fav : weighted([{ v: 'pix', w: 50 }, { v: 'cartao', w: 25 }, { v: 'boleto', w: 15 }, { v: 'transferencia', w: 7 }, { v: 'dinheiro', w: 3 }]));

for (const d of draft) {
  const startAt = `${d.date} ${fromMin(d.s)}`;
  const endAt = `${d.date} ${fromMin(d.e)}`;
  const minutes = d.e - d.s;
  const past = endAt <= now.at;
  const r = rand();
  const status = past ? (r < 0.06 ? 'cancelled' : r < 0.105 ? 'no_show' : 'confirmed') : (r < 0.05 ? 'cancelled' : r < 0.1 ? 'pending' : 'confirmed');

  // preço (mesma regra do sistema): horas incluídas no plano primeiro, depois valor/hora com desconto do plano
  const plan = d.client.plan;
  const month = d.date.slice(0, 7);
  const uk = `${d.client.id}|${month}`;
  let included = 0;
  if (status !== 'cancelled') {
    if (Number(plan.unlimited)) included = minutes;
    else if (Number(plan.included_minutes) > 0) included = Math.max(0, Math.min(minutes, Number(plan.included_minutes) - (usedIncluded.get(uk) ?? 0)));
    usedIncluded.set(uk, (usedIncluded.get(uk) ?? 0) + included);
  }
  const price = Math.round(((Number(d.room.price_cents) * (minutes - included)) / 60) * (1 - Number(plan.room_discount_percent) / 100));

  const createdAt = (() => {
    const before = int(1, 16);
    const day = addDays(d.date, -before);
    return `${day < d.client.joined ? d.client.joined : day} ${pad(int(8, 21))}:${pad(int(0, 59))}:${pad(int(0, 59))}`;
  })();

  rows.push({
    ...d, startAt, endAt, minutes, status, past, included, price, createdAt, plan, month,
    attendees: int(1, Math.max(1, Math.min(Number(d.room.capacity), 3))), title: pick(titles),
  });
}

/* ---------------- faturas: quem pagou, quando e como ---------------- */
const invoices = new Map();
const currentMonth = today.slice(0, 7);
const invoiceOf = (client, month) => {
  const k = `${client.id}|${month}`;
  if (invoices.has(k)) return invoices.get(k);
  let inv = { paid: false };
  if (month < currentMonth) {
    const due = invoiceDueDate(month, rules);
    const monthsAgo = Number(currentMonth.slice(0, 4)) * 12 + Number(currentMonth.slice(5)) - (Number(month.slice(0, 4)) * 12 + Number(month.slice(5)));
    let delay;
    if (client.behavior === 'good') delay = int(-5, 3);
    else if (client.behavior === 'late') delay = int(7, 38);
    else delay = monthsAgo <= 2 ? null : int(20, 60); // quem não paga: as duas últimas faturas ficam em aberto
    if (delay !== null) {
      const paidDate = addDays(due, delay);
      if (paidDate <= today) inv = { paid: true, stamp: stampAt(paidDate, int(8 * 60, 20 * 60), int(0, 59)), method: methodFor(client) };
    }
  }
  invoices.set(k, inv);
  return inv;
};

/* ---------------- gravar reservas ---------------- */
let sessionsCount = 0;
let overtimeCount = 0;
await db.transaction(async (tx) => {
  for (const b of rows) {
    const charged = b.status !== 'cancelled' && b.price > 0;
    const inv = invoiceOf(b.client, b.month);
    const paid = charged && inv.paid;
    const recent = b.date >= addDays(today, -14);

    let checkedIn = null; let checkInMethod = null; let checkedOut = null; let checkOutMethod = null;
    let overMin = 0; let overCents = 0;
    if (b.status === 'confirmed' && b.past && rand() > (recent ? 0.03 : 0.07)) {
      checkedIn = addMin(`${b.startAt}:00`, int(-8, 6));
      checkInMethod = weighted([{ v: 'qr', w: 55 }, { v: 'app', w: 40 }, { v: 'admin', w: 5 }]);
      if (rand() < 0.03) {
        checkedOut = `${b.endAt}:00`; checkOutMethod = 'auto';
      } else {
        const lateBy = rand() < 0.14 ? int(12, 55) : int(-15, 6);
        checkedOut = addMin(`${b.endAt}:00`, lateBy);
        checkOutMethod = weighted([{ v: 'qr', w: 55 }, { v: 'app', w: 42 }, { v: 'admin', w: 3 }]);
        const over = minutesBetween(b.endAt, checkedOut);
        if (over > Number(rules.overtime_grace_minutes)) {
          overMin = over;
          overCents = Number(b.plan.unlimited) ? 0 : Math.round(((Number(b.room.price_cents) * over) / 60) * (1 - Number(b.plan.room_discount_percent) / 100));
          overtimeCount++;
        }
      }
      sessionsCount++;
    }
    const overPaid = overCents > 0 && inv.paid;
    const cancelledAt = b.status === 'cancelled' ? addMin(`${b.startAt}:00`, -int(180, 14000)) : null;

    await tx.run(
      `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, notes, attendees,
         total_minutes, included_minutes, price_cents, payment_status, series_id, created_by, cancelled_at, cancelled_by, cancel_reason,
         created_at, updated_at, checked_in_at, check_in_method, checked_out_at, check_out_method, overtime_minutes, overtime_cents,
         overtime_payment_status, paid_at, payment_method, overtime_paid_at, overtime_payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code(), b.room.id, b.client.id, b.date, fromMin(b.s), fromMin(b.e), b.startAt, b.endAt, b.status, b.title, b.attendees,
        b.minutes, b.included, b.price, !charged ? 'none' : paid ? 'paid' : 'pending', b.series, b.client.id,
        cancelledAt, b.status === 'cancelled' ? b.client.id : null, b.status === 'cancelled' ? pick(['', '', 'Imprevisto', 'Remarcado', 'Paciente desmarcou']) : null,
        b.createdAt, paid ? inv.stamp : b.createdAt, checkedIn, checkInMethod, checkedOut, checkOutMethod, overMin, overCents,
        overCents === 0 ? 'none' : overPaid ? 'paid' : 'pending', paid ? inv.stamp : null, paid ? inv.method : null, overPaid ? inv.stamp : null, overPaid ? inv.method : null,
      ],
    );
  }
});

/* ---------------- financeiro: contas a pagar ---------------- */
const payMethod = { Aluguel: 'transferencia', Condomínio: 'boleto', Energia: 'boleto', Água: 'boleto', 'Internet e telefone': 'cartao', Limpeza: 'pix', 'Software e assinaturas': 'cartao', 'Impostos e taxas': 'boleto', Marketing: 'cartao', Manutenção: 'pix' };
const fixed = [
  ['Aluguel do espaço', 'Imobiliária Batel', 'Aluguel', () => 450000, 5],
  ['Condomínio', 'Condomínio Ed. Batel Center', 'Condomínio', () => 98000, 10],
  ['Software de gestão', 'Agendador SaaS', 'Software e assinaturas', () => 14900, 12],
  ['Energia elétrica', 'Copel', 'Energia', () => int(38000, 62000), 15],
  ['Água e esgoto', 'Sanepar', 'Água', () => int(13500, 19500), 18],
  ['Internet 500 Mbps', 'Vivo Fibra', 'Internet e telefone', () => 22900, 20],
  ['Contabilidade', 'Contábil Curitiba', 'Impostos e taxas', () => 38000, 22],
  ['Impostos (Simples Nacional)', 'Receita Federal', 'Impostos e taxas', () => int(42000, 78000), 20],
  ['Limpeza e conservação', 'Clean Batel Serviços', 'Limpeza', () => 65000, 25],
];
const unpaidPayables = new Set(['Energia elétrica', 'Marketing — anúncios']); // ficam em aberto no mês passado (aparecem como vencidas)
const firstMonth = addMonthsStr(currentMonth, -4);
let payablesCount = 0;
for (const [description, supplier, category, amount, dueDay] of fixed) {
  const series = crypto.randomBytes(8).toString('hex');
  for (let i = 0; i <= 5; i++) {
    const month = addMonthsStr(firstMonth, i);
    const due = `${month}-${pad(dueDay)}`;
    const lastMonth = addMonthsStr(currentMonth, -1);
    const paidDate = addDays(due, int(-3, 2));
    const settled = paidDate <= today && !(month === lastMonth && unpaidPayables.has(description));
    await db.run(
      `INSERT INTO payables (description, supplier, category, amount_cents, due_date, status, paid_at, payment_method, notes, series_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [description, supplier, category, amount(), due, settled ? 'paid' : 'pending', settled ? stampAt(paidDate, int(8 * 60, 18 * 60), int(0, 59)) : null, settled ? payMethod[category] : null, MARK, series, `${addDays(due, -20)} 10:00:00`, `${addDays(due, -20)} 10:00:00`],
    );
    payablesCount++;
  }
}
// Despesas avulsas
const oneOff = [
  ['Marketing — anúncios', 'Meta Ads', 'Marketing', int(30000, 90000), addMonthsStr(currentMonth, -3), 8],
  ['Marketing — anúncios', 'Meta Ads', 'Marketing', int(30000, 90000), addMonthsStr(currentMonth, -2), 8],
  ['Marketing — anúncios', 'Meta Ads', 'Marketing', int(30000, 90000), addMonthsStr(currentMonth, -1), 8],
  ['Manutenção do ar-condicionado', 'Frio Certo Climatização', 'Manutenção', 38000, addMonthsStr(currentMonth, -2), 14],
  ['Conserto de persiana', 'Casa das Persianas', 'Manutenção', 16000, addMonthsStr(currentMonth, -1), 3],
  ['Material de escritório e café', 'Atacado Batel', 'Material de consumo', int(18000, 32000), addMonthsStr(currentMonth, -1), 6],
  ['Material de escritório e café', 'Atacado Batel', 'Material de consumo', int(18000, 32000), currentMonth, 4],
  ['Fotos profissionais das salas', 'Estúdio Lume', 'Marketing', 120000, addMonthsStr(currentMonth, -3), 19],
];
for (const [description, supplier, category, amount, month, day] of oneOff) {
  const due = `${month}-${pad(day)}`;
  const lastMonth = addMonthsStr(currentMonth, -1);
  const paidDate = addDays(due, int(-2, 3));
  const settled = paidDate <= today && !(month === lastMonth && unpaidPayables.has(description));
  await db.run(
    `INSERT INTO payables (description, supplier, category, amount_cents, due_date, status, paid_at, payment_method, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [description, supplier, category, amount, due, settled ? 'paid' : 'pending', settled ? stampAt(paidDate, int(8 * 60, 18 * 60), int(0, 59)) : null, settled ? payMethod[category] : null, MARK, `${addDays(due, -7)} 10:00:00`, `${addDays(due, -7)} 10:00:00`],
  );
  payablesCount++;
}

/* ---------------- financeiro: mensalidades dos planos e avulsos a receber ---------------- */
let receivablesCount = 0;
for (const c of clients) {
  if (Number(c.plan.price_cents) <= 0) continue;
  const joinedMonth = c.joined.slice(0, 7);
  for (let i = 0; i <= 4; i++) {
    const month = addMonthsStr(firstMonth, i);
    if (month < joinedMonth) continue;
    const due = `${month}-${pad(Math.min(28, Number(rules.invoice_due_day) || 10))}`;
    let paidDate = null;
    if (c.behavior === 'good') paidDate = addDays(due, int(-4, 2));
    else if (c.behavior === 'late') paidDate = addDays(due, int(5, 30));
    else if (month < addMonthsStr(currentMonth, -1)) paidDate = addDays(due, int(15, 45));
    const settled = paidDate && paidDate <= today;
    await db.run(
      `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, paid_at, payment_method, notes, ref, created_at, updated_at)
       VALUES (?, ?, 'Mensalidade de plano', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, `Mensalidade ${c.plan.name} — ${month.slice(5)}/${month.slice(0, 4)}`, Number(c.plan.price_cents), due, settled ? 'paid' : 'pending', settled ? stampAt(paidDate, int(8 * 60, 20 * 60), int(0, 59)) : null, settled ? methodFor(c) : null, MARK, `plan:${c.id}:${month}`, `${due} 08:00:00`, `${due} 08:00:00`],
    );
    receivablesCount++;
  }
}
const extras = [
  ['Taxa de cadastro', 'Taxa/serviço', 8000, 'Eduardo Lacerda', 27, false],
  ['Taxa de cadastro', 'Taxa/serviço', 8000, 'Thiago Almeida', 11, true],
  ['Venda de kit de boas-vindas', 'Venda de produto', 4500, 'Fernanda Ribeiro', 18, true],
  ['Chave extra da sala', 'Taxa/serviço', 6000, 'Carolina Prado', 45, false],
  ['Locação de auditório (evento)', 'Taxa/serviço', 90000, 'Bruno Tavares', 33, true],
];
for (const [description, category, amount, who, daysAgo, paidFlag] of extras) {
  const c = clientByName[who];
  const due = addDays(today, -daysAgo);
  await db.run(
    `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, paid_at, payment_method, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.id, description, category, amount, due, paidFlag ? 'paid' : 'pending', paidFlag ? stampAt(addDays(due, int(0, 4)), 11 * 60, 0) : null, paidFlag ? methodFor(c) : null, MARK, `${due} 09:00:00`, `${due} 09:00:00`],
  );
  receivablesCount++;
}

/* ---------------- resumo ---------------- */
const by = await db.query("SELECT status, COUNT(*) AS n FROM bookings WHERE code LIKE 'SD-%' GROUP BY status");
console.log('\nReservas geradas:', rows.length, '→', by.map((x) => `${x.status}: ${x.n}`).join(' · '));
console.log(`Check-ins registrados: ${sessionsCount} · com excedente cobrado: ${overtimeCount}`);
console.log(`Clientes: ${clients.length} · contas a pagar: ${payablesCount} · lançamentos a receber: ${receivablesCount}`);
console.log(`Período: ${addDays(today, -DAYS_BACK)} a ${addDays(today, DAYS_AHEAD)}`);
console.log('\nPara remover tudo isto depois:  node scripts/seed-reports.js --clear');
