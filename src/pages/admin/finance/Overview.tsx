import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, Banknote, Scale, Wallet } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback';
import { Card, CardHeader, Stat } from '../../../components/ui/Misc';
import { useApi } from '../../../hooks/useApi';
import { cn } from '../../../lib/cn';
import { addMonths, fmtDateShort, fmtMonth, fmtMoney, todayStr } from '../../../lib/format';
import { api } from '../../../services/api';
import type { FinanceOverview } from '../../../types';
import { DueDate, FinBadge, Money, methodLabel } from './shared';

/** Barras de entradas x saídas por mês. */
export function CashBars({ series, highlight }: { series: { month: string; in_cents: number; out_cents: number }[]; highlight?: string }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.in_cents, s.out_cents]));
  return (
    <div className="flex h-[220px] items-end gap-2 sm:gap-3" role="img" aria-label="Entradas e saídas por mês">
      {series.map((s) => (
        <div key={s.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${fmtMonth(s.month)} · entradas ${fmtMoney(s.in_cents)} · saídas ${fmtMoney(s.out_cents)}`}>
          <div className="flex w-full flex-1 items-end justify-center gap-1">
            <div className="w-full max-w-[22px] rounded-t-[8px] bg-sage-700" style={{ height: `${Math.max(2, (s.in_cents / max) * 100)}%`, opacity: s.in_cents ? 1 : 0.2 }} />
            <div className="w-full max-w-[22px] rounded-t-[8px] bg-clay" style={{ height: `${Math.max(2, (s.out_cents / max) * 100)}%`, opacity: s.out_cents ? 1 : 0.2 }} />
          </div>
          <span className={cn('text-[10.5px] font-medium capitalize', s.month === highlight ? 'text-sage-700' : 'text-stone-light')}>{fmtMonth(s.month).split(' ')[0].slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

export const Legend = () => (
  <p className="mt-4 flex items-center gap-5 text-[12px] text-stone">
    <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-sage-700" />Entradas</span>
    <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-clay" />Saídas</span>
  </p>
);

function Ranking({ rows, empty }: { rows: { label: string; value: number; hint?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-5 text-center text-[13.5px] text-stone">{empty}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-medium text-ink">{r.label}</span>
            <span className="text-stone">{fmtMoney(r.value)}{r.hint ? ` · ${r.hint}` : ''}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sage-dim"><div className="h-full rounded-full bg-sage-700" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function FinanceOverviewPage() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const q = useApi(() => api.get<FinanceOverview>('/admin/finance/overview', { month }), [month]);
  const d = q.data;

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-ink/12 bg-cream hover:border-sage-700"><ChevronLeft size={18} /></button>
        <h2 className="min-w-[190px] text-center font-display text-[22px] font-medium text-ink">{fmtMonth(month)}</h2>
        <button type="button" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-ink/12 bg-cream hover:border-sage-700"><ChevronRight size={18} /></button>
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className={cn('mb-6 grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-3 lg:gap-4 xl:grid-cols-5', q.loading && d && 'opacity-60')}>
        {!d ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[128px] rounded-[22px]" />) : (
          <>
            <Stat label="Recebido no mês" value={fmtMoney(d.cash.in_cents)} hint={`Faturado: ${fmtMoney(d.billed_cents)}`} icon={<ArrowDownCircle />} />
            <Stat label="Pago no mês" value={fmtMoney(d.cash.out_cents)} hint="Despesas quitadas" icon={<ArrowUpCircle />} tone="clay" />
            <Stat label="Resultado do mês" value={fmtMoney(d.cash.result_cents)} hint={d.cash.result_cents >= 0 ? 'Entrou mais do que saiu' : 'Saiu mais do que entrou'} icon={<Scale />} tone={d.cash.result_cents >= 0 ? 'sage' : 'clay'} />
            <Stat
              label="A receber"
              value={fmtMoney(d.receivable.open_cents)}
              hint={d.receivable.overdue_cents > 0 ? <Link to="/admin/financeiro/receber?status=overdue" className="font-semibold text-rose no-underline">{fmtMoney(d.receivable.overdue_cents)} vencido →</Link> : 'Nada vencido'}
              icon={<Banknote />}
              tone="amber"
            />
            <Stat
              label="A pagar"
              value={fmtMoney(d.payable.open_cents)}
              hint={d.payable.overdue_cents > 0 ? <Link to="/admin/financeiro/pagar?status=overdue" className="font-semibold text-rose no-underline">{fmtMoney(d.payable.overdue_cents)} vencido →</Link> : `${fmtMoney(d.payable.due_7d_cents)} nos próx. 7 dias`}
              icon={<Wallet />}
              tone="amber"
            />
          </>
        )}
      </div>

      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="Entradas e saídas" subtitle="Últimos 6 meses, pelo dia em que o dinheiro entrou ou saiu" />
          {!d ? <Skeleton className="h-[220px]" /> : (<><CashBars series={d.series} highlight={month} /><Legend /></>)}
        </Card>
        <Card>
          <CardHeader title="Faturamento por sala" subtitle={`Reservas de ${fmtMonth(month).toLowerCase()}`} />
          {!d ? <Skeleton className="h-[200px]" /> : <Ranking empty="Sem reservas com valor neste mês." rows={d.by_room.map((r) => ({ label: r.name, value: r.total_cents, hint: `${r.bookings}×` }))} />}
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Como recebemos" subtitle="Entradas do mês por forma de pagamento" />
          {!d ? <Skeleton className="h-[160px]" /> : <Ranking empty="Nenhum recebimento neste mês." rows={d.by_method.map((m) => ({ label: methodLabel(m.method), value: m.total_cents }))} />}
        </Card>
        <Card>
          <CardHeader title="Despesas por categoria" subtitle="Contas com vencimento no mês" />
          {!d ? <Skeleton className="h-[160px]" /> : <Ranking empty="Nenhuma despesa lançada neste mês." rows={d.expenses_by_category.map((c) => ({ label: c.category, value: c.total_cents }))} />}
        </Card>
        <Card>
          <CardHeader title="Quem mais deve" subtitle="Maiores saldos em aberto" />
          {!d ? <Skeleton className="h-[160px]" /> : d.top_debtors.length === 0 ? (
            <p className="py-5 text-center text-[13.5px] text-stone">Ninguém com pendência. 🎉</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {d.top_debtors.map((t) => (
                <li key={t.user.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span className="min-w-0"><span className="block truncate font-medium text-ink">{t.user.name}</span>{t.user.company && <span className="block truncate text-[12px] text-stone-light">{t.user.company}</span>}</span>
                  <span className="shrink-0 text-right"><Money cents={t.open_cents} className="font-semibold" />{t.overdue_cents > 0 && <span className="block text-[11.5px] font-medium text-rose">{fmtMoney(t.overdue_cents)} vencido</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próximos a receber" action={<Link to="/admin/financeiro/receber" className="text-[13px] font-semibold text-sage-700 no-underline hover:underline">Ver todos</Link>} />
          {!d ? <Skeleton className="h-[160px]" /> : d.next_receivables.length === 0 ? <EmptyState title="Nada a receber" description="Quando houver faturas em aberto, elas aparecem aqui." /> : (
            <ul className="flex flex-col divide-y divide-ink/6">
              {d.next_receivables.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-3 text-[13.5px]">
                  <span className="min-w-0"><span className="block truncate font-medium text-ink">{r.party || r.description}</span><span className="block truncate text-[12px] text-stone">{r.party ? `${r.description} · ` : ''}vence <DueDate date={r.due_date} status={r.status} /></span></span>
                  <span className="flex shrink-0 items-center gap-3"><Money cents={r.open_cents} className="font-semibold" /><FinBadge status={r.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Próximos a pagar" action={<Link to="/admin/financeiro/pagar" className="text-[13px] font-semibold text-sage-700 no-underline hover:underline">Ver todos</Link>} />
          {!d ? <Skeleton className="h-[160px]" /> : d.next_payables.length === 0 ? <EmptyState title="Nenhuma conta a pagar" description="Lance aluguel, energia, internet e outras despesas em Contas a pagar." /> : (
            <ul className="flex flex-col divide-y divide-ink/6">
              {d.next_payables.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-[13.5px]">
                  <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.description}</span><span className="block truncate text-[12px] text-stone">{p.party ? `${p.party} · ` : ''}vence {fmtDateShort(p.due_date)}</span></span>
                  <span className="flex shrink-0 items-center gap-3"><Money cents={p.amount_cents} className="font-semibold" /><FinBadge status={p.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
