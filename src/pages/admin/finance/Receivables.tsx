import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../../components/ui/Feedback';
import { Input, SearchInput, Select, Textarea } from '../../../components/ui/Form';
import { Modal } from '../../../components/ui/Modal';
import { Card, DataTable, Segmented, Td, Th } from '../../../components/ui/Misc';
import { useAuth } from '../../../contexts/AuthContext';
import { useApi, useDebounced } from '../../../hooks/useApi';
import { fmtDateFull, fmtDuration, fmtMonth, fmtMoney, todayStr } from '../../../lib/format';
import { api } from '../../../services/api';
import type { Client, InvoiceLine, OnlinePayment, PayMethod, Receivable, ReceivableTotals } from '../../../types';
import { ChargeLinkModal } from './ChargeLink';
import { DueDate, FinBadge, Money, PayModal, RECEIVABLE_CATEGORIES, methodLabel, moneyInput, parseMoney } from './shared';

type Filter = 'open' | 'overdue' | 'paid' | 'all';

interface ListResponse { rows: Receivable[]; totals: ReceivableTotals; totals_all: ReceivableTotals; invoice_due_day: number }
interface InvoiceResponse { user: { id: number; name: string; email: string; phone: string; company: string }; month: string; due_date: string; bookings: InvoiceLine[] }

export default function Receivables() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Filter>((params.get('status') as Filter) || 'open');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = useDebounced(text, 300);

  const q = useApi(() => api.get<ListResponse>('/admin/finance/receivables', { status, q: search, from, to }), [status, search, from, to]);
  const [invoice, setInvoice] = useState<Receivable | null>(null);
  const [editing, setEditing] = useState<{ row?: Receivable } | null>(null);
  const [paying, setPaying] = useState<Receivable | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.has('status')) setParams({}, { replace: true });
  }, [params, setParams]);

  const pay = async (row: Receivable, v: { method: PayMethod; date: string }) => {
    setBusy(true);
    try {
      if (row.kind === 'invoice') await api.post('/admin/finance/receivables/invoice/pay', { user_id: row.user!.id, month: row.month, ...v });
      else await api.post(`/admin/finance/receivables/${row.id}/pay`, v);
      toast.success('Recebimento registrado.');
      setPaying(null);
      setInvoice(null);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  };

  const generateFees = async () => {
    const month = todayStr().slice(0, 7);
    if (!(await confirm({ title: 'Gerar mensalidades dos planos?', confirmLabel: 'Gerar', description: `Cria uma conta a receber para cada cliente ativo com plano pago, em ${fmtMonth(month)}, usando a mensalidade de referência de cada plano. Quem já tem a mensalidade do mês não é duplicado.` }))) return;
    try {
      const r = await api.post<{ created: number; considered: number }>('/admin/finance/receivables/plan-fees', { month });
      toast.success(r.created ? `${r.created} mensalidade(s) criada(s).` : 'Todas as mensalidades do mês já estavam lançadas.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar.');
    }
  };

  const t = q.data?.totals;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter> value={status} onChange={setStatus} options={[{ value: 'open', label: 'Em aberto' }, { value: 'overdue', label: 'Vencidas' }, { value: 'paid', label: 'Pagas' }, { value: 'all', label: 'Todas' }]} />
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" icon={<CalendarClock size={16} />} onClick={generateFees}>Gerar mensalidades</Button>
          <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo lançamento</Button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Em aberto</p><p className="mt-1 font-display text-[24px] font-medium text-ink">{fmtMoney(q.data?.totals_all.open_cents ?? 0)}</p><p className="text-[12px] text-stone">{q.data?.totals_all.count ?? 0} conta(s) no total</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Vencido</p><p className="mt-1 font-display text-[24px] font-medium text-rose">{fmtMoney(q.data?.totals_all.overdue_cents ?? 0)}</p><p className="text-[12px] text-stone">Já passou do vencimento</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Nesta lista</p><p className="mt-1 font-display text-[24px] font-medium text-ink">{fmtMoney(status === 'paid' ? t?.paid_cents ?? 0 : t?.open_cents ?? 0)}</p><p className="text-[12px] text-stone">{t?.count ?? 0} conta(s) · {status === 'paid' ? 'recebido' : 'a receber'}</p></Card>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
        <SearchInput placeholder="Buscar por cliente, empresa ou descrição…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar" />
        <Input aria-label="Vencimento a partir de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="Vencimento até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {q.loading && !q.data ? <Skeleton className="h-[260px] rounded-[22px]" /> : q.data && q.data.rows.length === 0 ? (
        <Card><EmptyState title="Nada por aqui" description={status === 'open' ? 'Nenhuma conta em aberto com esses filtros.' : 'Nenhuma conta encontrada com esses filtros.'} /></Card>
      ) : (
        <DataTable>
          <thead><tr><Th>Cliente / descrição</Th><Th>Vencimento</Th><Th className="text-right">Valor</Th><Th className="text-right">Em aberto</Th><Th>Situação</Th><Th className="text-right">Ação</Th></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.key} onClick={() => (r.kind === 'invoice' ? setInvoice(r) : setEditing({ row: r }))} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                <Td>
                  <span className="block font-medium">{r.user?.name ?? r.description}</span>
                  <span className="block text-[12px] text-stone">{r.user ? r.description : r.category}{r.kind === 'invoice' ? ` · ${r.bookings} reserva(s)` : r.user ? ` · ${r.category}` : ''}</span>
                </Td>
                <Td><DueDate date={r.due_date} status={r.status} /></Td>
                <Td className="text-right"><Money cents={r.amount_cents} /></Td>
                <Td className="text-right"><Money cents={r.open_cents} className={r.open_cents ? 'font-semibold' : 'text-stone-light'} /></Td>
                <Td><FinBadge status={r.status} paidLabel="Recebida" /></Td>
                <Td className="text-right">
                  {r.status !== 'paid' && <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); setPaying(r); }}>Receber</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {invoice && <InvoiceModal row={invoice} onClose={() => setInvoice(null)} onPay={() => setPaying(invoice)} onChanged={() => { q.reload(); setInvoice(null); }} />}
      {paying && (
        <PayModal
          open
          title="Registrar recebimento"
          subtitle={paying.user ? `${paying.user.name} · ${paying.description}` : paying.description}
          amount_cents={paying.open_cents}
          confirmLabel="Confirmar recebimento"
          busy={busy}
          onClose={() => setPaying(null)}
          onConfirm={(v) => pay(paying, v)}
        />
      )}
      {editing && <ManualModal row={editing.row} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); }} onPay={(r) => { setEditing(null); setPaying(r); }} />}
    </>
  );
}

function InvoiceModal({ row, onClose, onPay, onChanged }: { row: Receivable; onClose: () => void; onPay: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { settings } = useAuth();
  const q = useApi(() => api.get<InvoiceResponse>('/admin/finance/receivables/invoice', { user_id: row.user!.id, month: row.month }), [row.key]);
  const anyPaid = row.paid_cents > 0;
  const [charging, setCharging] = useState(false);
  const [link, setLink] = useState<OnlinePayment | null>(null);

  const charge = async () => {
    setCharging(true);
    try {
      const r = await api.post<{ payment: OnlinePayment }>('/admin/finance/payments', { user_id: row.user!.id, scope: 'month', month: row.month });
      setLink({ ...r.payment, user_name: row.user!.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o link.');
    } finally {
      setCharging(false);
    }
  };

  const reopen = async () => {
    if (!(await confirm({ title: 'Reabrir esta fatura?', confirmLabel: 'Reabrir', tone: 'danger', description: 'Tudo o que foi marcado como pago nesta fatura volta para "em aberto" e sai do fluxo de caixa.' }))) return;
    try {
      await api.post('/admin/finance/receivables/invoice/reopen', { user_id: row.user!.id, month: row.month });
      toast.success('Fatura reaberta.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível reabrir.');
    }
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={row.user?.name}
      subtitle={`Fatura de ${fmtMonth(row.month!)} · vence em ${fmtDateFull(row.due_date)}`}
      footer={
        <>
          {anyPaid && <Button variant="secondary" icon={<RotateCcw size={15} />} onClick={reopen}>Reabrir fatura</Button>}
          {settings?.online_payments && row.open_cents > 0 && <Button variant="soft" loading={charging} onClick={charge}>Cobrar online</Button>}
          {row.open_cents > 0 && <Button onClick={onPay}>Receber {fmtMoney(row.open_cents)}</Button>}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <FinBadge status={row.status} paidLabel="Recebida" />
        <span className="text-[13px] text-stone">Total <strong className="text-ink">{fmtMoney(row.amount_cents)}</strong> · recebido <strong className="text-ink">{fmtMoney(row.paid_cents)}</strong> · em aberto <strong className="text-ink">{fmtMoney(row.open_cents)}</strong></span>
      </div>
      {q.loading && !q.data ? <Skeleton className="h-[160px]" /> : (
        <div className="overflow-x-auto rounded-2xl border border-ink/8">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead><tr><Th>Reserva</Th><Th className="text-right">Valor</Th><Th>Pagamento</Th></tr></thead>
            <tbody>
              {q.data?.bookings.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <span className="block font-medium">{fmtDateFull(b.date)} · {b.start_time} às {b.end_time}</span>
                    <span className="block text-[12px] text-stone">{b.room} · {b.code}{b.status === 'no_show' ? ' · não compareceu' : ''}</span>
                  </Td>
                  <Td className="text-right">
                    <Money cents={b.price_cents} />
                    {b.overtime_cents > 0 && <span className="block text-[12px] text-rose">+ {fmtMoney(b.overtime_cents)} excedente ({fmtDuration(b.overtime_minutes)})</span>}
                  </Td>
                  <Td>
                    {b.price_cents > 0 && (b.payment_status === 'paid' ? <Badge tone="sage">Pago · {methodLabel(b.payment_method)}</Badge> : <Badge tone="amber">A pagar</Badge>)}
                    {b.overtime_cents > 0 && <span className="mt-1 block">{b.overtime_payment_status === 'paid' ? <Badge tone="sage">Excedente pago · {methodLabel(b.overtime_payment_method)}</Badge> : <Badge tone="amber">Excedente a pagar</Badge>}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
      {link && <ChargeLinkModal payment={link} phone={q.data?.user.phone} onClose={() => setLink(null)} />}
    </>
  );
}

function ManualModal({ row, onClose, onSaved, onPay }: { row?: Receivable; onClose: () => void; onSaved: () => void; onPay: (r: Receivable) => void }) {
  const toast = useToast();
  const { settings } = useAuth();
  const [link, setLink] = useState<OnlinePayment | null>(null);
  const chargeOnline = async () => {
    try {
      const r = await api.post<{ payment: OnlinePayment }>('/admin/finance/payments', { user_id: row!.user!.id, scope: 'receivable', receivable_id: row!.id });
      setLink({ ...r.payment, user_name: row!.user!.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o link.');
    }
  };
  const confirm = useConfirm();
  const clients = useApi(() => api.get<{ users: Client[] }>('/admin/users', { role: 'client', active: 'true' }), []);
  const [f, setF] = useState({
    description: row?.description ?? '',
    category: row?.category ?? RECEIVABLE_CATEGORIES[0],
    user_id: row?.user?.id ?? 0,
    amount: row ? moneyInput(row.amount_cents) : '',
    due_date: row?.due_date ?? todayStr(),
    notes: row?.notes ?? '',
    repeat_months: 0,
  });
  const [saving, setSaving] = useState(false);
  const paid = row?.status === 'paid';

  const save = async () => {
    setSaving(true);
    try {
      const body = { description: f.description, category: f.category, user_id: f.user_id || null, amount_cents: parseMoney(f.amount), due_date: f.due_date, notes: f.notes };
      if (row) await api.put(`/admin/finance/receivables/${row.id}`, body);
      else await api.post('/admin/finance/receivables', { ...body, repeat_months: f.repeat_months });
      toast.success(row ? 'Lançamento atualizado.' : f.repeat_months ? `${f.repeat_months + 1} lançamentos criados.` : 'Lançamento criado.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const series = !!row?.series_id;
    const following = series && (await confirm({ title: 'Excluir também as próximas?', confirmLabel: 'Esta e as próximas', cancelLabel: 'Só esta', description: 'Este lançamento se repete todo mês. Quer excluir também os próximos, que ainda estão em aberto?' }));
    if (!(await confirm({ title: 'Excluir este lançamento?', confirmLabel: 'Excluir', tone: 'danger', description: 'Essa ação não pode ser desfeita.' }))) return;
    try {
      await api.delete(`/admin/finance/receivables/${row!.id}${following ? '?scope=following' : ''}`);
      toast.success('Lançamento excluído.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  const reopen = async () => {
    try {
      await api.post(`/admin/finance/receivables/${row!.id}/reopen`);
      toast.success('Recebimento desfeito.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer.');
    }
  };

  const valid = f.description.trim().length >= 2 && parseMoney(f.amount) > 0 && !!f.due_date;

  return (
    <>
    <Modal
      open
      onClose={onClose}
      locked={saving}
      title={row ? 'Lançamento a receber' : 'Novo lançamento a receber'}
      subtitle="Para o que não vem das reservas: mensalidades, taxas, vendas…"
      footer={
        <>
          {row && <Button variant="danger" icon={<Trash2 size={15} />} onClick={remove}>Excluir</Button>}
          {row && paid && <Button variant="secondary" icon={<RotateCcw size={15} />} onClick={reopen}>Desfazer recebimento</Button>}
          {row && !paid && settings?.online_payments && row.user && <Button variant="soft" onClick={chargeOnline}>Cobrar online</Button>}
          {row && !paid && <Button variant="soft" onClick={() => onPay(row)}>Receber</Button>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button loading={saving} disabled={!valid} onClick={save}>Salvar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {paid && <p className="rounded-xl bg-sage-dim px-4 py-2.5 text-[13px] text-sage-800">Recebido em {fmtDateFull(row!.paid_at!.slice(0, 10))} · {methodLabel(row!.payment_method)}</p>}
        <Input label="Descrição" required maxLength={160} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Mensalidade Flex — 11/2026" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Categoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {[...new Set([...RECEIVABLE_CATEGORIES, f.category])].map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select label="Cliente (opcional)" value={f.user_id || ''} onChange={(e) => setF({ ...f, user_id: Number(e.target.value) })}>
            <option value="">Sem cliente</option>
            {clients.data?.users.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
          </Select>
          <Input label="Valor (R$)" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" />
          <Input label="Vencimento" type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </div>
        {!row && (
          <Select label="Repetição" value={f.repeat_months} onChange={(e) => setF({ ...f, repeat_months: Number(e.target.value) })}>
            <option value={0}>Não repetir</option>
            {[1, 2, 3, 5, 11, 23].map((n) => <option key={n} value={n}>Todo mês, por mais {n} {n === 1 ? 'mês' : 'meses'}</option>)}
          </Select>
        )}
        <Textarea label="Observações (opcional)" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
      {link && <ChargeLinkModal payment={link} onClose={() => setLink(null)} />}
    </>
  );
}
