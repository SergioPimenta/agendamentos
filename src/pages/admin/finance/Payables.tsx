import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../../components/ui/Feedback';
import { Input, SearchInput, Select, Textarea } from '../../../components/ui/Form';
import { Modal } from '../../../components/ui/Modal';
import { Card, DataTable, Segmented, Td, Th } from '../../../components/ui/Misc';
import { useApi, useDebounced } from '../../../hooks/useApi';
import { fmtDateFull, fmtMoney, todayStr } from '../../../lib/format';
import { api } from '../../../services/api';
import type { PayMethod, Payable } from '../../../types';
import { DueDate, FinBadge, Money, PAYABLE_CATEGORIES, PayModal, methodLabel, moneyInput, parseMoney } from './shared';

type Filter = 'open' | 'overdue' | 'paid' | 'all';

interface ListResponse {
  rows: Payable[];
  totals: { amount_cents: number; open_cents: number; overdue_cents: number; paid_cents: number; count: number };
  categories: string[];
}

export default function Payables() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Filter>((params.get('status') as Filter) || 'open');
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = useDebounced(text, 300);

  const q = useApi(() => api.get<ListResponse>('/admin/finance/payables', { status, category, q: search, from, to }), [status, category, search, from, to]);
  const [editing, setEditing] = useState<{ row?: Payable } | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.has('status')) setParams({}, { replace: true });
  }, [params, setParams]);

  const pay = async (row: Payable, v: { method: PayMethod; date: string }) => {
    setBusy(true);
    try {
      await api.post(`/admin/finance/payables/${row.id}/pay`, v);
      toast.success('Pagamento registrado.');
      setPaying(null);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  };

  const t = q.data?.totals;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter> value={status} onChange={setStatus} options={[{ value: 'open', label: 'Em aberto' }, { value: 'overdue', label: 'Vencidas' }, { value: 'paid', label: 'Pagas' }, { value: 'all', label: 'Todas' }]} />
        <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Nova conta a pagar</Button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Em aberto</p><p className="mt-1 font-display text-[24px] font-medium text-ink">{fmtMoney(t?.open_cents ?? 0)}</p><p className="text-[12px] text-stone">Nesta lista</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Vencido</p><p className="mt-1 font-display text-[24px] font-medium text-rose">{fmtMoney(t?.overdue_cents ?? 0)}</p><p className="text-[12px] text-stone">Já passou do vencimento</p></Card>
        <Card className="!p-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">Pago</p><p className="mt-1 font-display text-[24px] font-medium text-ink">{fmtMoney(t?.paid_cents ?? 0)}</p><p className="text-[12px] text-stone">{t?.count ?? 0} conta(s) na lista</p></Card>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_150px_150px]">
        <SearchInput placeholder="Buscar por descrição ou fornecedor…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar" />
        <Select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {[...new Set([...PAYABLE_CATEGORIES, ...(q.data?.categories ?? [])])].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Input aria-label="Vencimento a partir de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="Vencimento até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {q.loading && !q.data ? <Skeleton className="h-[260px] rounded-[22px]" /> : q.data && q.data.rows.length === 0 ? (
        <Card><EmptyState title="Nenhuma conta por aqui" description="Cadastre o aluguel, a energia, a internet e outras despesas para acompanhar o que vence." action={<Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Nova conta a pagar</Button>} /></Card>
      ) : (
        <DataTable>
          <thead><tr><Th>Descrição</Th><Th>Categoria</Th><Th>Vencimento</Th><Th className="text-right">Valor</Th><Th>Situação</Th><Th className="text-right">Ação</Th></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.id} onClick={() => setEditing({ row: r })} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                <Td><span className="block font-medium">{r.description}</span>{r.supplier && <span className="block text-[12px] text-stone">{r.supplier}</span>}</Td>
                <Td className="text-stone">{r.category}</Td>
                <Td><DueDate date={r.due_date} status={r.status} /></Td>
                <Td className="text-right"><Money cents={r.amount_cents} className="font-medium" /></Td>
                <Td><FinBadge status={r.status} /></Td>
                <Td className="text-right">{r.status !== 'paid' && <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); setPaying(r); }}>Pagar</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {paying && <PayModal open title="Registrar pagamento" subtitle={paying.description} amount_cents={paying.amount_cents} confirmLabel="Confirmar pagamento" busy={busy} onClose={() => setPaying(null)} onConfirm={(v) => pay(paying, v)} />}
      {editing && <PayableModal row={editing.row} categories={q.data?.categories ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); }} onPay={(r) => { setEditing(null); setPaying(r); }} />}
    </>
  );
}

function PayableModal({ row, categories, onClose, onSaved, onPay }: { row?: Payable; categories: string[]; onClose: () => void; onSaved: () => void; onPay: (r: Payable) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({
    description: row?.description ?? '',
    supplier: row?.supplier ?? '',
    category: row?.category ?? PAYABLE_CATEGORIES[0],
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
      const body = { description: f.description, supplier: f.supplier, category: f.category, amount_cents: parseMoney(f.amount), due_date: f.due_date, notes: f.notes };
      if (row) await api.put(`/admin/finance/payables/${row.id}`, body);
      else await api.post('/admin/finance/payables', { ...body, repeat_months: f.repeat_months });
      toast.success(row ? 'Conta atualizada.' : f.repeat_months ? `${f.repeat_months + 1} contas criadas.` : 'Conta criada.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const following = !!row?.series_id && (await confirm({ title: 'Excluir também as próximas?', confirmLabel: 'Esta e as próximas', cancelLabel: 'Só esta', description: 'Esta conta se repete todo mês. Quer excluir também as próximas, que ainda estão em aberto?' }));
    if (!(await confirm({ title: 'Excluir esta conta?', confirmLabel: 'Excluir', tone: 'danger', description: 'Essa ação não pode ser desfeita.' }))) return;
    try {
      await api.delete(`/admin/finance/payables/${row!.id}${following ? '?scope=following' : ''}`);
      toast.success('Conta excluída.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  const reopen = async () => {
    try {
      await api.post(`/admin/finance/payables/${row!.id}/reopen`);
      toast.success('Pagamento desfeito.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer.');
    }
  };

  const valid = f.description.trim().length >= 2 && parseMoney(f.amount) > 0 && !!f.due_date && !!f.category.trim();

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      title={row ? 'Conta a pagar' : 'Nova conta a pagar'}
      footer={
        <>
          {row && <Button variant="danger" icon={<Trash2 size={15} />} onClick={remove}>Excluir</Button>}
          {row && paid && <Button variant="secondary" icon={<RotateCcw size={15} />} onClick={reopen}>Desfazer pagamento</Button>}
          {row && !paid && <Button variant="soft" onClick={() => onPay(row)}>Pagar</Button>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button loading={saving} disabled={!valid} onClick={save}>Salvar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {paid && <p className="rounded-xl bg-sage-dim px-4 py-2.5 text-[13px] text-sage-800">Pago em {fmtDateFull(row!.paid_at!.slice(0, 10))} · {methodLabel(row!.payment_method)}</p>}
        <Input label="Descrição" required maxLength={160} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Aluguel do espaço — novembro" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Fornecedor (opcional)" maxLength={120} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          <Select label="Categoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {[...new Set([...PAYABLE_CATEGORIES, ...categories, f.category])].map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Input label="Valor (R$)" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" />
          <Input label="Vencimento" type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </div>
        {!row && (
          <Select label="Repetição" value={f.repeat_months} onChange={(e) => setF({ ...f, repeat_months: Number(e.target.value) })} hint="Para contas fixas, como aluguel e internet.">
            <option value={0}>Não repetir</option>
            {[1, 2, 3, 5, 11, 23].map((n) => <option key={n} value={n}>Todo mês, por mais {n} {n === 1 ? 'mês' : 'meses'}</option>)}
          </Select>
        )}
        <Textarea label="Observações (opcional)" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}
