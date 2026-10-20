import crypto from 'crypto';
import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { addDays, nowLocal, nowStamp } from '../utils/time.js';
import { CONSUMING, inList } from './availability.js';
import { activatePackageForReceivable } from './packages.js';
import { activatePlanForReceivable } from './plans.js';
import { getSettings } from './settings.js';

/**
 * Financeiro: contas a receber (faturas das reservas + lançamentos avulsos), contas a pagar e fluxo de caixa.
 *
 *  - A fatura de um cliente é o conjunto das reservas dele num mês (valor das reservas + excedentes).
 *    Vence no dia `invoice_due_day` do mês seguinte.
 *  - Caixa = o que foi de fato pago/recebido, na data do pagamento (`paid_at`).
 *  - Competência (faturado) = o que foi gerado no mês, pago ou não.
 */

export const PAYMENT_METHODS = ['pix', 'boleto', 'cartao', 'dinheiro', 'transferencia', 'outro'];

const pad = (n) => String(n).padStart(2, '0');

export function addMonthsStr(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Soma meses a uma data mantendo o dia (ou o último dia do mês, se não existir). */
export function addMonthsToDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const target = addMonthsStr(`${y}-${pad(m)}`, n);
  const [ty, tm] = target.split('-').map(Number);
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${target}-${pad(Math.min(d, last))}`;
}

export const invoiceDueDate = (month, rules) => `${addMonthsStr(month, 1)}-${pad(Math.min(28, Math.max(1, Number(rules.invoice_due_day) || 10)))}`;

const statusOf = (open, due, today) => (open <= 0 ? 'paid' : due < today ? 'overdue' : 'open');

/** `YYYY-MM-DD` informado pelo usuário (ou agora) → carimbo gravado no banco. */
export const paidStamp = (date) => (date ? `${date} 12:00:00` : nowStamp());

const method = (m) => (PAYMENT_METHODS.includes(m) ? m : 'outro');

/* ---------------- contas a receber ---------------- */

const invoiceSelect = `
  SELECT b.user_id, u.name AS user_name, u.email AS user_email, u.company AS user_company, SUBSTR(b.date, 1, 7) AS month,
         COUNT(*) AS bookings,
         SUM(b.price_cents) AS price, SUM(b.overtime_cents) AS overtime,
         SUM(CASE WHEN b.payment_status = 'paid' THEN b.price_cents ELSE 0 END) AS price_paid,
         SUM(CASE WHEN b.overtime_payment_status = 'paid' THEN b.overtime_cents ELSE 0 END) AS overtime_paid
    FROM bookings b JOIN users u ON u.id = b.user_id
   WHERE b.status IN (${inList(CONSUMING)}) AND (b.price_cents > 0 OR b.overtime_cents > 0)`;

/** Todas as contas a receber (faturas por cliente/mês e lançamentos avulsos), já com situação e vencimento. */
export async function loadReceivables(rules, today = nowLocal().date) {
  const invoices = await db.query(`${invoiceSelect} GROUP BY b.user_id, u.name, u.email, u.company, SUBSTR(b.date, 1, 7)`);
  const manual = await db.query(
    `SELECT r.*, u.name AS user_name, u.email AS user_email, u.company AS user_company FROM receivables r LEFT JOIN users u ON u.id = r.user_id`,
  );

  const rows = [];
  for (const i of invoices) {
    const amount = Number(i.price) + Number(i.overtime);
    const paid = Number(i.price_paid) + Number(i.overtime_paid);
    const due = invoiceDueDate(i.month, rules);
    rows.push({
      kind: 'invoice',
      key: `inv:${i.user_id}:${i.month}`,
      user: { id: Number(i.user_id), name: i.user_name, email: i.user_email, company: i.user_company },
      month: i.month,
      description: `Fatura de ${i.month.slice(5)}/${i.month.slice(0, 4)}`,
      category: 'Reservas de salas',
      bookings: Number(i.bookings),
      amount_cents: amount,
      paid_cents: paid,
      open_cents: amount - paid,
      due_date: due,
      status: statusOf(amount - paid, due, today),
    });
  }
  for (const r of manual) {
    const paid = r.status === 'paid';
    rows.push({
      kind: 'manual',
      key: `man:${r.id}`,
      id: Number(r.id),
      user: r.user_id ? { id: Number(r.user_id), name: r.user_name, email: r.user_email, company: r.user_company } : null,
      description: r.description,
      category: r.category,
      amount_cents: Number(r.amount_cents),
      paid_cents: paid ? Number(r.amount_cents) : 0,
      open_cents: paid ? 0 : Number(r.amount_cents),
      due_date: r.due_date,
      status: statusOf(paid ? 0 : Number(r.amount_cents), r.due_date, today),
      paid_at: r.paid_at,
      payment_method: r.payment_method,
      notes: r.notes || '',
      ref: r.ref,
      series_id: r.series_id,
    });
  }
  return rows;
}

export const sumReceivables = (rows) => ({
  amount_cents: rows.reduce((a, r) => a + r.amount_cents, 0),
  paid_cents: rows.reduce((a, r) => a + r.paid_cents, 0),
  open_cents: rows.reduce((a, r) => a + r.open_cents, 0),
  overdue_cents: rows.filter((r) => r.status === 'overdue').reduce((a, r) => a + r.open_cents, 0),
  count: rows.length,
});

const priority = { overdue: 0, open: 1, paid: 2 };
export const sortReceivables = (rows) =>
  [...rows].sort((a, b) => priority[a.status] - priority[b.status] || (a.status === 'paid' ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)));

/** Reservas que compõem uma fatura (para o detalhe). */
export async function invoiceLines(userId, month) {
  const rows = await db.query(
    `SELECT b.id, b.code, b.date, b.start_time, b.end_time, b.status, b.price_cents, b.overtime_cents, b.overtime_minutes,
            b.payment_status, b.overtime_payment_status, b.paid_at, b.payment_method, b.overtime_paid_at, b.overtime_payment_method,
            r.name AS room_name
       FROM bookings b JOIN rooms r ON r.id = b.room_id
      WHERE b.user_id = ? AND SUBSTR(b.date, 1, 7) = ? AND b.status IN (${inList(CONSUMING)}) AND (b.price_cents > 0 OR b.overtime_cents > 0)
      ORDER BY b.start_at`,
    [userId, month],
  );
  return rows.map((b) => ({
    id: Number(b.id), code: b.code, date: b.date, start_time: b.start_time, end_time: b.end_time, room: b.room_name, status: b.status,
    price_cents: Number(b.price_cents), payment_status: b.payment_status, paid_at: b.paid_at, payment_method: b.payment_method,
    overtime_cents: Number(b.overtime_cents), overtime_minutes: Number(b.overtime_minutes), overtime_payment_status: b.overtime_payment_status,
    overtime_paid_at: b.overtime_paid_at, overtime_payment_method: b.overtime_payment_method,
  }));
}

export async function payInvoice({ userId, month, method: m, date }) {
  const stamp = paidStamp(date);
  const args = [stamp, method(m), nowStamp(), userId, month];
  const a = await db.run(
    `UPDATE bookings SET payment_status = 'paid', paid_at = ?, payment_method = ?, updated_at = ?
      WHERE user_id = ? AND SUBSTR(date, 1, 7) = ? AND payment_status = 'pending' AND status IN (${inList(CONSUMING)})`,
    args,
  );
  const b = await db.run(
    `UPDATE bookings SET overtime_payment_status = 'paid', overtime_paid_at = ?, overtime_payment_method = ?, updated_at = ?
      WHERE user_id = ? AND SUBSTR(date, 1, 7) = ? AND overtime_payment_status = 'pending' AND status IN (${inList(CONSUMING)})`,
    args,
  );
  return a.changes + b.changes;
}

export async function reopenInvoice({ userId, month }) {
  const a = await db.run(
    `UPDATE bookings SET payment_status = 'pending', paid_at = NULL, payment_method = NULL, updated_at = ?
      WHERE user_id = ? AND SUBSTR(date, 1, 7) = ? AND payment_status = 'paid' AND price_cents > 0 AND status IN (${inList(CONSUMING)})`,
    [nowStamp(), userId, month],
  );
  const b = await db.run(
    `UPDATE bookings SET overtime_payment_status = 'pending', overtime_paid_at = NULL, overtime_payment_method = NULL, updated_at = ?
      WHERE user_id = ? AND SUBSTR(date, 1, 7) = ? AND overtime_payment_status = 'paid' AND overtime_cents > 0 AND status IN (${inList(CONSUMING)})`,
    [nowStamp(), userId, month],
  );
  return a.changes + b.changes;
}

/* ---------------- lançamentos (a pagar / avulsos a receber) ---------------- */

const TABLES = { payables: 'payables', receivables: 'receivables' };

/** Cria o lançamento e, se pedido, as repetições mensais seguintes (mesma série). */
export async function createEntries(table, data, repeatMonths = 0) {
  const t = TABLES[table];
  const series = repeatMonths > 0 ? crypto.randomBytes(8).toString('hex') : null;
  const ids = [];
  for (let i = 0; i <= repeatMonths; i++) {
    const due = addMonthsToDate(data.due_date, i);
    const cols = ['description', 'category', 'amount_cents', 'due_date', 'notes', 'series_id', 'status', 'created_at', 'updated_at'];
    const vals = [data.description, data.category, data.amount_cents, due, data.notes || '', series, 'pending', nowStamp(), nowStamp()];
    if (table === 'payables') { cols.push('supplier'); vals.push(data.supplier || ''); }
    else { cols.push('user_id'); vals.push(data.user_id ?? null); }
    const r = await db.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    ids.push(r.insertId);
  }
  return ids;
}

export async function updateEntry(table, id, data) {
  const t = TABLES[table];
  const row = await db.get(`SELECT id, status FROM ${t} WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  const sets = ['description = ?', 'category = ?', 'amount_cents = ?', 'due_date = ?', 'notes = ?', 'updated_at = ?'];
  const vals = [data.description, data.category, data.amount_cents, data.due_date, data.notes || '', nowStamp()];
  if (table === 'payables') { sets.push('supplier = ?'); vals.push(data.supplier || ''); }
  else { sets.push('user_id = ?'); vals.push(data.user_id ?? null); }
  await db.run(`UPDATE ${t} SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

export async function deleteEntry(table, id, scope = 'one') {
  const t = TABLES[table];
  const row = await db.get(`SELECT id, series_id, due_date FROM ${t} WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  if (scope === 'following' && row.series_id) {
    const r = await db.run(`DELETE FROM ${t} WHERE series_id = ? AND due_date >= ? AND status = 'pending'`, [row.series_id, row.due_date]);
    return r.changes;
  }
  await db.run(`DELETE FROM ${t} WHERE id = ?`, [id]);
  return 1;
}

export async function setEntryPaid(table, id, paid, { method: m, date } = {}) {
  const t = TABLES[table];
  const row = await db.get(`SELECT id FROM ${t} WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  if (paid) {
    await db.run(`UPDATE ${t} SET status = 'paid', paid_at = ?, payment_method = ?, updated_at = ? WHERE id = ?`, [paidStamp(date), method(m), nowStamp(), id]);
    if (table === 'receivables') {
      // Baixa manual de uma troca de plano ou de uma compra de pacote também vale.
      await activatePlanForReceivable(id);
      await activatePackageForReceivable(id);
    }
  } else {
    await db.run(`UPDATE ${t} SET status = 'pending', paid_at = NULL, payment_method = NULL, updated_at = ? WHERE id = ?`, [nowStamp(), id]);
  }
}

export async function loadPayables(today = nowLocal().date) {
  const rows = await db.query('SELECT * FROM payables');
  return rows.map((r) => {
    const paid = r.status === 'paid';
    return {
      id: Number(r.id),
      description: r.description,
      supplier: r.supplier,
      category: r.category,
      amount_cents: Number(r.amount_cents),
      due_date: r.due_date,
      status: statusOf(paid ? 0 : 1, r.due_date, today),
      paid_at: r.paid_at,
      payment_method: r.payment_method,
      notes: r.notes || '',
      series_id: r.series_id,
    };
  });
}

/** Gera a mensalidade dos planos (valor de referência do plano) do mês, uma vez por cliente. */
export async function generatePlanFees(month, rules) {
  const due = `${month}-${pad(Math.min(28, Math.max(1, Number(rules.invoice_due_day) || 10)))}`;
  const users = await db.query(
    `SELECT u.id, u.name, p.name AS plan_name, p.price_cents FROM users u JOIN plans p ON p.id = u.plan_id
      WHERE u.role = 'client' AND u.active = 1 AND p.active = 1 AND p.price_cents > 0`,
  );
  let created = 0;
  for (const u of users) {
    const ref = `plan:${u.id}:${month}`;
    // Também conta a mensalidade gerada quando o cliente trocou de plano no mês (referência com sufixo).
    if (await db.get('SELECT id FROM receivables WHERE ref = ? OR ref LIKE ?', [ref, `${ref}:%`])) continue;
    await db.run(
      `INSERT INTO receivables (user_id, description, category, amount_cents, due_date, status, ref, created_at, updated_at)
       VALUES (?, ?, 'Mensalidade de plano', ?, ?, 'pending', ?, ?, ?)`,
      [u.id, `Mensalidade ${u.plan_name} — ${month.slice(5)}/${month.slice(0, 4)}`, Number(u.price_cents), due, ref, nowStamp(), nowStamp()],
    );
    created++;
  }
  return { created, considered: users.length };
}

/* ---------------- fluxo de caixa ---------------- */

const day = (stamp) => stamp.slice(0, 10);

/** Entradas e saídas efetivamente pagas no período, uma linha por pagamento (reservas agrupadas por cliente/dia/forma). */
export async function loadMovements(from, to) {
  const lo = `${from} 00:00:00`;
  const hi = `${to} 23:59:59`;
  const movements = [];

  const bookings = await db.query(
    `SELECT b.user_id, u.name AS user_name, SUBSTR(b.paid_at, 1, 10) AS day, b.payment_method AS method, COUNT(*) AS n, SUM(b.price_cents) AS total
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.payment_status = 'paid' AND b.price_cents > 0 AND b.paid_at >= ? AND b.paid_at <= ?
      GROUP BY b.user_id, u.name, SUBSTR(b.paid_at, 1, 10), b.payment_method`,
    [lo, hi],
  );
  for (const r of bookings) {
    movements.push({
      id: `bk:${r.user_id}:${r.day}:${r.method}`, date: r.day, type: 'in', category: 'Reservas de salas', party: r.user_name,
      description: `Reservas (${r.n})`, method: r.method, amount_cents: Number(r.total),
    });
  }

  const overtime = await db.query(
    `SELECT b.user_id, u.name AS user_name, SUBSTR(b.overtime_paid_at, 1, 10) AS day, b.overtime_payment_method AS method, COUNT(*) AS n, SUM(b.overtime_cents) AS total
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.overtime_payment_status = 'paid' AND b.overtime_cents > 0 AND b.overtime_paid_at >= ? AND b.overtime_paid_at <= ?
      GROUP BY b.user_id, u.name, SUBSTR(b.overtime_paid_at, 1, 10), b.overtime_payment_method`,
    [lo, hi],
  );
  for (const r of overtime) {
    movements.push({
      id: `ot:${r.user_id}:${r.day}:${r.method}`, date: r.day, type: 'in', category: 'Excedente de horário', party: r.user_name,
      description: `Excedente (${r.n})`, method: r.method, amount_cents: Number(r.total),
    });
  }

  const manual = await db.query(
    `SELECT r.*, u.name AS user_name FROM receivables r LEFT JOIN users u ON u.id = r.user_id WHERE r.status = 'paid' AND r.paid_at >= ? AND r.paid_at <= ?`,
    [lo, hi],
  );
  for (const r of manual) {
    movements.push({
      id: `rc:${r.id}`, date: day(r.paid_at), type: 'in', category: r.category, party: r.user_name || '', description: r.description,
      method: r.payment_method, amount_cents: Number(r.amount_cents),
    });
  }

  const payables = await db.query(`SELECT * FROM payables WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`, [lo, hi]);
  for (const p of payables) {
    movements.push({
      id: `pg:${p.id}`, date: day(p.paid_at), type: 'out', category: p.category, party: p.supplier, description: p.description,
      method: p.payment_method, amount_cents: Number(p.amount_cents),
    });
  }

  movements.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'in' ? -1 : 1));
  let balance = 0;
  for (const m of movements) {
    balance += m.type === 'in' ? m.amount_cents : -m.amount_cents;
    m.balance_cents = balance;
  }
  const totalIn = movements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount_cents, 0);
  const totalOut = movements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount_cents, 0);
  return { movements, totals: { in_cents: totalIn, out_cents: totalOut, result_cents: totalIn - totalOut } };
}

/** Entradas e saídas (caixa) por mês, para os gráficos. */
export async function monthlyCash(endMonth, months = 6) {
  const first = addMonthsStr(endMonth, -(months - 1));
  const lo = `${first}-01 00:00:00`;
  const hi = `${endMonth}-31 23:59:59`;
  const map = new Map();
  for (let i = 0; i < months; i++) map.set(addMonthsStr(first, i), { month: addMonthsStr(first, i), in_cents: 0, out_cents: 0 });
  const add = (rows, key) => {
    for (const r of rows) if (map.has(r.month)) map.get(r.month)[key] += Number(r.total);
  };
  add(await db.query(`SELECT SUBSTR(paid_at, 1, 7) AS month, SUM(price_cents) AS total FROM bookings WHERE payment_status = 'paid' AND price_cents > 0 AND paid_at >= ? AND paid_at <= ? GROUP BY SUBSTR(paid_at, 1, 7)`, [lo, hi]), 'in_cents');
  add(await db.query(`SELECT SUBSTR(overtime_paid_at, 1, 7) AS month, SUM(overtime_cents) AS total FROM bookings WHERE overtime_payment_status = 'paid' AND overtime_cents > 0 AND overtime_paid_at >= ? AND overtime_paid_at <= ? GROUP BY SUBSTR(overtime_paid_at, 1, 7)`, [lo, hi]), 'in_cents');
  add(await db.query(`SELECT SUBSTR(paid_at, 1, 7) AS month, SUM(amount_cents) AS total FROM receivables WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ? GROUP BY SUBSTR(paid_at, 1, 7)`, [lo, hi]), 'in_cents');
  add(await db.query(`SELECT SUBSTR(paid_at, 1, 7) AS month, SUM(amount_cents) AS total FROM payables WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ? GROUP BY SUBSTR(paid_at, 1, 7)`, [lo, hi]), 'out_cents');
  return [...map.values()].map((m) => ({ ...m, result_cents: m.in_cents - m.out_cents }));
}

/** Resumo financeiro de um mês: caixa, competência, pendências e quebras por sala/forma/categoria. */
export async function overview(month, rules) {
  const today = nowLocal().date;
  const from = `${month}-01`;
  const to = `${month}-31`;
  const { movements, totals } = await loadMovements(from, to);

  const receivables = await loadReceivables(rules, today);
  const payables = await loadPayables(today);
  const openRec = receivables.filter((r) => r.status !== 'paid');
  const openPay = payables.filter((p) => p.status !== 'paid');
  const in7 = addDays(today, 7);

  const billed = await db.get(
    `SELECT COALESCE(SUM(price_cents + overtime_cents), 0) AS total FROM bookings WHERE date >= ? AND date <= ? AND status IN (${inList(CONSUMING)})`,
    [from, to],
  );
  const billedManual = receivables.filter((r) => r.kind === 'manual' && r.due_date >= from && r.due_date <= to).reduce((a, r) => a + r.amount_cents, 0);

  const byRoom = await db.query(
    `SELECT r.name, COALESCE(SUM(b.price_cents + b.overtime_cents), 0) AS total, COUNT(*) AS bookings
       FROM bookings b JOIN rooms r ON r.id = b.room_id
      WHERE b.date >= ? AND b.date <= ? AND b.status IN (${inList(CONSUMING)}) AND (b.price_cents > 0 OR b.overtime_cents > 0)
      GROUP BY r.id, r.name ORDER BY total DESC`,
    [from, to],
  );

  const byMethod = {};
  for (const m of movements.filter((x) => x.type === 'in')) byMethod[m.method || 'outro'] = (byMethod[m.method || 'outro'] || 0) + m.amount_cents;

  const expenseByCategory = {};
  for (const p of payables.filter((x) => x.due_date >= from && x.due_date <= to)) expenseByCategory[p.category] = (expenseByCategory[p.category] || 0) + p.amount_cents;

  const debtors = new Map();
  for (const r of openRec.filter((x) => x.user)) {
    const d = debtors.get(r.user.id) ?? { user: r.user, open_cents: 0, overdue_cents: 0 };
    d.open_cents += r.open_cents;
    if (r.status === 'overdue') d.overdue_cents += r.open_cents;
    debtors.set(r.user.id, d);
  }

  return {
    month,
    cash: { in_cents: totals.in_cents, out_cents: totals.out_cents, result_cents: totals.result_cents },
    billed_cents: Number(billed.total) + billedManual,
    receivable: { open_cents: sumReceivables(openRec).open_cents, overdue_cents: sumReceivables(openRec).overdue_cents, count: openRec.length },
    payable: {
      open_cents: openPay.reduce((a, p) => a + p.amount_cents, 0),
      overdue_cents: openPay.filter((p) => p.status === 'overdue').reduce((a, p) => a + p.amount_cents, 0),
      due_7d_cents: openPay.filter((p) => p.due_date >= today && p.due_date <= in7).reduce((a, p) => a + p.amount_cents, 0),
      count: openPay.length,
    },
    series: await monthlyCash(month, 6),
    by_room: byRoom.map((r) => ({ name: r.name, total_cents: Number(r.total), bookings: Number(r.bookings) })),
    by_method: Object.entries(byMethod).map(([m, total]) => ({ method: m, total_cents: total })).sort((a, b) => b.total_cents - a.total_cents),
    expenses_by_category: Object.entries(expenseByCategory).map(([category, total]) => ({ category, total_cents: total })).sort((a, b) => b.total_cents - a.total_cents),
    top_debtors: [...debtors.values()].sort((a, b) => b.open_cents - a.open_cents).slice(0, 5),
    next_receivables: sortReceivables(openRec).slice(0, 5).map((r) => ({ key: r.key, description: r.description, party: r.user?.name ?? '', due_date: r.due_date, open_cents: r.open_cents, status: r.status })),
    next_payables: openPay.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5).map((p) => ({ id: p.id, description: p.description, party: p.supplier, due_date: p.due_date, amount_cents: p.amount_cents, status: p.status })),
  };
}

export async function financeSettings() {
  const rules = await getSettings();
  return { invoice_due_day: rules.invoice_due_day };
}
