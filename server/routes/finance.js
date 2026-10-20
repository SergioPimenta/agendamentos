import express from 'express';
import { z } from 'zod';
import { requireAdmin, verifyToken } from '../middleware/auth.js';
import {
  PAYMENT_METHODS,
  createEntries,
  deleteEntry,
  generatePlanFees,
  invoiceDueDate,
  invoiceLines,
  loadMovements,
  loadPayables,
  loadReceivables,
  monthlyCash,
  overview,
  payInvoice,
  reopenInvoice,
  setEntryPaid,
  sortReceivables,
  sumReceivables,
  updateEntry,
} from '../services/finance.js';
import { createCharge, gatewayStatus, listPayments, syncPayment } from '../services/onlinePayments.js';
import { pingPagarme, pagarmeMode } from '../services/pagarme.js';
import { getSettings } from '../services/settings.js';
import { db } from '../db/index.js';
import { HttpError, asyncHandler, parse } from '../utils/http.js';
import { DATE_RE, isValidDate, nowLocal } from '../utils/time.js';

const router = express.Router();
router.use(verifyToken, requireAdmin);

const date = z.string().regex(DATE_RE, 'Data inválida').refine(isValidDate, 'Data inválida');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido');
const id = z.coerce.number().int().positive();
const payBody = z.object({ method: z.enum(PAYMENT_METHODS).optional().default('pix'), date: date.optional() });
const currentMonth = () => nowLocal().date.slice(0, 7);

const entryBase = {
  description: z.string().trim().min(2, 'Descreva o lançamento').max(160),
  category: z.string().trim().min(1, 'Escolha a categoria').max(40),
  amount_cents: z.coerce.number().int().min(1, 'Informe um valor maior que zero').max(100_000_000),
  due_date: date,
  notes: z.string().trim().max(1000).optional().default(''),
};
const payableInput = z.object({ ...entryBase, supplier: z.string().trim().max(120).optional().default(''), repeat_months: z.coerce.number().int().min(0).max(36).optional().default(0) });
const receivableInput = z.object({ ...entryBase, user_id: z.coerce.number().int().positive().nullable().optional(), repeat_months: z.coerce.number().int().min(0).max(36).optional().default(0) });

/* ---------------- visão geral ---------------- */

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ month: month.optional() }), req.query);
    res.json(await overview(q.month ?? currentMonth(), await getSettings()));
  }),
);

/* ---------------- contas a receber ---------------- */

router.get(
  '/receivables',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['all', 'open', 'overdue', 'paid']).optional().default('open'),
        from: date.optional(),
        to: date.optional(),
        q: z.string().trim().max(80).optional().default(''),
      }),
      req.query,
    );
    const rules = await getSettings();
    const all = await loadReceivables(rules);
    const needle = q.q.toLowerCase();
    const rows = sortReceivables(
      all.filter((r) => {
        if (q.status === 'open' && r.status === 'paid') return false;
        if (q.status === 'overdue' && r.status !== 'overdue') return false;
        if (q.status === 'paid' && r.status !== 'paid') return false;
        if (q.from && r.due_date < q.from) return false;
        if (q.to && r.due_date > q.to) return false;
        if (needle && !`${r.user?.name ?? ''} ${r.user?.email ?? ''} ${r.user?.company ?? ''} ${r.description}`.toLowerCase().includes(needle)) return false;
        return true;
      }),
    );
    res.json({ rows, totals: sumReceivables(rows), totals_all: sumReceivables(all.filter((r) => r.status !== 'paid')), invoice_due_day: rules.invoice_due_day });
  }),
);

router.get(
  '/receivables/invoice',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ user_id: id, month }), req.query);
    const lines = await invoiceLines(q.user_id, q.month);
    if (!lines.length) throw new HttpError(404, 'Fatura não encontrada.');
    const user = await db.get('SELECT id, name, email, phone, company FROM users WHERE id = ?', [q.user_id]);
    res.json({ user, month: q.month, due_date: invoiceDueDate(q.month, await getSettings()), bookings: lines });
  }),
);

router.post(
  '/receivables/invoice/pay',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ user_id: id, month }).merge(payBody), req.body);
    res.json({ updated: await payInvoice({ userId: d.user_id, month: d.month, method: d.method, date: d.date }) });
  }),
);

router.post(
  '/receivables/invoice/reopen',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ user_id: id, month }), req.body);
    res.json({ updated: await reopenInvoice({ userId: d.user_id, month: d.month }) });
  }),
);

router.post(
  '/receivables/plan-fees',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ month: month.optional() }), req.body ?? {});
    res.json(await generatePlanFees(d.month ?? currentMonth(), await getSettings()));
  }),
);

router.post(
  '/receivables',
  asyncHandler(async (req, res) => {
    const d = parse(receivableInput, req.body);
    if (d.user_id && !(await db.get('SELECT id FROM users WHERE id = ?', [d.user_id]))) throw new HttpError(400, 'Cliente inválido.');
    res.status(201).json({ created: (await createEntries('receivables', d, d.repeat_months)).length });
  }),
);

router.put(
  '/receivables/:id',
  asyncHandler(async (req, res) => {
    await updateEntry('receivables', Number(req.params.id), parse(receivableInput.omit({ repeat_months: true }), req.body));
    res.json({ ok: true });
  }),
);

router.delete(
  '/receivables/:id',
  asyncHandler(async (req, res) => {
    const scope = req.query.scope === 'following' ? 'following' : 'one';
    res.json({ deleted: await deleteEntry('receivables', Number(req.params.id), scope) });
  }),
);

router.post('/receivables/:id/pay', asyncHandler(async (req, res) => {
  await setEntryPaid('receivables', Number(req.params.id), true, parse(payBody, req.body ?? {}));
  res.json({ ok: true });
}));

router.post('/receivables/:id/reopen', asyncHandler(async (req, res) => {
  await setEntryPaid('receivables', Number(req.params.id), false);
  res.json({ ok: true });
}));

/* ---------------- contas a pagar ---------------- */

router.get(
  '/payables',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['all', 'open', 'overdue', 'paid']).optional().default('open'),
        category: z.string().trim().max(40).optional().default(''),
        from: date.optional(),
        to: date.optional(),
        q: z.string().trim().max(80).optional().default(''),
      }),
      req.query,
    );
    const all = await loadPayables();
    const needle = q.q.toLowerCase();
    const rows = all
      .filter((p) => {
        if (q.status === 'open' && p.status === 'paid') return false;
        if (q.status === 'overdue' && p.status !== 'overdue') return false;
        if (q.status === 'paid' && p.status !== 'paid') return false;
        if (q.category && p.category !== q.category) return false;
        if (q.from && p.due_date < q.from) return false;
        if (q.to && p.due_date > q.to) return false;
        if (needle && !`${p.description} ${p.supplier}`.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => (a.status === 'paid') - (b.status === 'paid') || (a.status === 'paid' ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)));
    const sum = (list) => list.reduce((a, p) => a + p.amount_cents, 0);
    res.json({
      rows,
      totals: {
        amount_cents: sum(rows),
        open_cents: sum(rows.filter((p) => p.status !== 'paid')),
        overdue_cents: sum(rows.filter((p) => p.status === 'overdue')),
        paid_cents: sum(rows.filter((p) => p.status === 'paid')),
        count: rows.length,
      },
      categories: [...new Set(all.map((p) => p.category))].sort(),
    });
  }),
);

router.post(
  '/payables',
  asyncHandler(async (req, res) => {
    const d = parse(payableInput, req.body);
    res.status(201).json({ created: (await createEntries('payables', d, d.repeat_months)).length });
  }),
);

router.put(
  '/payables/:id',
  asyncHandler(async (req, res) => {
    await updateEntry('payables', Number(req.params.id), parse(payableInput.omit({ repeat_months: true }), req.body));
    res.json({ ok: true });
  }),
);

router.delete(
  '/payables/:id',
  asyncHandler(async (req, res) => {
    const scope = req.query.scope === 'following' ? 'following' : 'one';
    res.json({ deleted: await deleteEntry('payables', Number(req.params.id), scope) });
  }),
);

router.post('/payables/:id/pay', asyncHandler(async (req, res) => {
  await setEntryPaid('payables', Number(req.params.id), true, parse(payBody, req.body ?? {}));
  res.json({ ok: true });
}));

router.post('/payables/:id/reopen', asyncHandler(async (req, res) => {
  await setEntryPaid('payables', Number(req.params.id), false);
  res.json({ ok: true });
}));

/* ---------------- pagamentos online (Pagar.me) ---------------- */

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ status: z.enum(['all', 'pending', 'paid', 'failed', 'canceled', 'expired', 'review']).optional().default('all') }), req.query);
    res.json({ payments: await listPayments({ status: q.status }) });
  }),
);

/** Gera o link de pagamento de uma fatura, reserva ou lançamento, para enviar ao cliente. */
router.post(
  '/payments',
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        user_id: id,
        scope: z.enum(['month', 'booking', 'receivable']),
        month: month.optional(),
        booking_id: id.optional(),
        receivable_id: id.optional(),
      }).refine((v) => (v.scope === 'month' ? !!v.month : v.scope === 'booking' ? !!v.booking_id : !!v.receivable_id), 'Informe o que será cobrado.'),
      req.body,
    );
    res.status(201).json({ payment: await createCharge({ actor: req.user, userId: d.user_id, scope: d.scope, month: d.month, bookingId: d.booking_id, receivableId: d.receivable_id }) });
  }),
);

router.post(
  '/payments/:id/sync',
  asyncHandler(async (req, res) => {
    res.json({ payment: await syncPayment(Number(req.params.id)) });
  }),
);

router.get('/gateway', asyncHandler(async (_req, res) => res.json(gatewayStatus())));

/** Testa se a chave secreta configurada é aceita pelo Pagar.me. */
router.post(
  '/gateway/test',
  asyncHandler(async (_req, res) => {
    await pingPagarme();
    res.json({ ok: true, mode: pagarmeMode() });
  }),
);

/* ---------------- fluxo de caixa ---------------- */

const periodQuery = z.object({ from: date.optional(), to: date.optional() });
const period = (q) => {
  const now = nowLocal().date;
  return { from: q.from ?? `${now.slice(0, 7)}-01`, to: q.to ?? now };
};

router.get(
  '/cashflow',
  asyncHandler(async (req, res) => {
    const { from, to } = period(parse(periodQuery, req.query));
    const data = await loadMovements(from, to);
    res.json({ from, to, ...data, series: await monthlyCash(to.slice(0, 7), 12) });
  }),
);

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get(
  '/cashflow/export',
  asyncHandler(async (req, res) => {
    const { from, to } = period(parse(periodQuery, req.query));
    const { movements, totals } = await loadMovements(from, to);
    const money = (c) => (c / 100).toFixed(2).replace('.', ',');
    const lines = [
      ['Data', 'Tipo', 'Categoria', 'Descrição', 'Cliente/Fornecedor', 'Forma', 'Valor', 'Saldo do período'],
      ...movements.map((m) => [m.date.split('-').reverse().join('/'), m.type === 'in' ? 'Entrada' : 'Saída', m.category, m.description, m.party, m.method ?? '', money(m.type === 'in' ? m.amount_cents : -m.amount_cents), money(m.balance_cents)]),
      [],
      ['Entradas', '', '', '', '', '', money(totals.in_cents)],
      ['Saídas', '', '', '', '', '', money(-totals.out_cents)],
      ['Resultado', '', '', '', '', '', money(totals.result_cents)],
    ];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="fluxo-de-caixa-${from}_${to}.csv"` });
    res.send(`﻿${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}`);
  }),
);

export default router;
