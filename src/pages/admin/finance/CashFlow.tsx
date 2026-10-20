import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useToast } from '../../../components/ui/Feedback';
import { Input } from '../../../components/ui/Form';
import { Card, CardHeader, DataTable, Td, Th } from '../../../components/ui/Misc';
import { useApi } from '../../../hooks/useApi';
import { cn } from '../../../lib/cn';
import { addDays, addMonths, fmtDateFull, fmtMoney, todayStr } from '../../../lib/format';
import { api } from '../../../services/api';
import type { CashMonth, Movement } from '../../../types';
import { CashBars, Legend } from './Overview';
import { Money, methodLabel } from './shared';

interface CashResponse {
  from: string;
  to: string;
  movements: Movement[];
  totals: { in_cents: number; out_cents: number; result_cents: number };
  series: CashMonth[];
}

const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => addDays(`${addMonths(m, 1)}-01`, -1);

export default function CashFlow() {
  const toast = useToast();
  const thisMonth = todayStr().slice(0, 7);
  const [from, setFrom] = useState(monthStart(thisMonth));
  const [to, setTo] = useState(todayStr());
  const q = useApi(() => api.get<CashResponse>('/admin/finance/cashflow', { from, to }), [from, to]);
  const d = q.data;

  const preset = (label: string, f: string, t: string) => (
    <button
      key={label}
      type="button"
      onClick={() => { setFrom(f); setTo(t); }}
      className={cn('cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors', from === f && to === t ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/12 text-stone hover:border-sage-700 hover:text-sage-700')}
    >
      {label}
    </button>
  );

  const lastMonth = addMonths(thisMonth, -1);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {preset('Este mês', monthStart(thisMonth), todayStr())}
          {preset('Mês passado', monthStart(lastMonth), monthEnd(lastMonth))}
          {preset('Últimos 90 dias', addDays(todayStr(), -90), todayStr())}
          {preset('Este ano', `${thisMonth.slice(0, 4)}-01-01`, todayStr())}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="De" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <Input label="Até" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => api.download('/admin/finance/cashflow/export', `fluxo-de-caixa-${from}_${to}.csv`, { from, to }).catch((e) => toast.error(e.message))}>Exportar CSV</Button>
        </div>
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Entradas</p><p className="mt-1 font-display text-[26px] font-medium text-sage-700">{fmtMoney(d?.totals.in_cents ?? 0)}</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Saídas</p><p className="mt-1 font-display text-[26px] font-medium text-clay">{fmtMoney(d?.totals.out_cents ?? 0)}</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Resultado do período</p><p className={cn('mt-1 font-display text-[26px] font-medium', (d?.totals.result_cents ?? 0) < 0 ? 'text-rose' : 'text-ink')}>{fmtMoney(d?.totals.result_cents ?? 0)}</p></Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Últimos 12 meses" subtitle="Entradas e saídas, pelo dia em que o dinheiro entrou ou saiu" />
        {!d ? <Skeleton className="h-[220px]" /> : (<><CashBars series={d.series} highlight={to.slice(0, 7)} /><Legend /></>)}
      </Card>

      <h2 className="mb-3 font-display text-[19px] font-medium text-ink">Movimentações</h2>
      {q.loading && !d ? <Skeleton className="h-[240px] rounded-[22px]" /> : d && d.movements.length === 0 ? (
        <Card><EmptyState title="Sem movimentações neste período" description="Aqui aparecem os pagamentos recebidos e as contas pagas, com a data em que foram baixados." /></Card>
      ) : (
        <DataTable className={cn(q.loading && 'opacity-60')}>
          <thead><tr><Th>Data</Th><Th>Descrição</Th><Th>Categoria</Th><Th>Forma</Th><Th className="text-right">Valor</Th><Th className="text-right">Saldo</Th></tr></thead>
          <tbody>
            {d?.movements.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{fmtDateFull(m.date)}</Td>
                <Td><span className="block font-medium">{m.description}</span>{m.party && <span className="block text-[12px] text-stone">{m.party}</span>}</Td>
                <Td><Badge tone={m.type === 'in' ? 'sage' : 'clay'}>{m.category}</Badge></Td>
                <Td className="text-stone">{methodLabel(m.method)}</Td>
                <Td className="text-right"><Money cents={m.type === 'in' ? m.amount_cents : -m.amount_cents} className={cn('font-semibold', m.type === 'in' ? 'text-sage-700' : 'text-clay')} /></Td>
                <Td className="text-right"><Money cents={m.balance_cents} className={cn(m.balance_cents < 0 && 'text-rose')} /></Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
