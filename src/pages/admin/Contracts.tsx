import { useState, type FormEvent } from 'react';
import { FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { contractBadge } from '../../components/contracts/ContractBadge';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, SearchInput, Select, Switch, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { fmtDateFull, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Client, Contract } from '../../types';
import { ImportContractsModal } from './ImportContracts';

const PER_PAGE = 25;
const PERIODS = ['Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'];
const DEFAULT_KINDS = ['Cliente Mensalista', 'Endereço comercial', 'Endereço fiscal'];
const DEFAULT_UNIT = 'Coworking Harmonize o Ser';

const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Contratos dos clientes: cadastro do que foi combinado (tipo, período, valor, vencimento, fidelidade e reajuste). */
export default function AdminContracts() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEdit = can('clients', 'edit');
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ contract?: Contract } | null>(null);
  const [importing, setImporting] = useState(false);

  const list = useApi(
    () => api.get<{ contracts: Contract[]; total: number; kinds: string[] }>('/admin/contracts', { q, status, kind, page: String(page), per_page: String(PER_PAGE) }),
    [q, status, kind, page],
  );
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(page * PER_PAGE, total);
  const kinds = [...new Set([...DEFAULT_KINDS, ...(list.data?.kinds ?? [])])];

  const remove = async (c: Contract) => {
    if (!(await confirm({ title: `Excluir o contrato de ${c.client_name}?`, description: `${c.kind} · ${c.period}. Isso só apaga o cadastro do contrato; reservas e cobranças não mudam.`, confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/contracts/${c.id}`);
      toast.success('Contrato excluído.');
      setEditing(null);
      list.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Contratos"
        description="O que foi combinado com cada cliente: tipo, período, valor, vencimento, fidelidade e reajuste. Por enquanto é só cadastro, sem cobrança automática."
        actions={canEdit && (
          <>
            <Button variant="secondary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>Importar contratos</Button>
            <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo contrato</Button>
          </>
        )}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr]">
        <SearchInput placeholder="Buscar por cliente, e-mail, empresa ou tipo…" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} aria-label="Buscar" />
        <Select aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todas as situações</option>
          <option value="active">Vigentes</option>
          <option value="ending">Vencendo em 30 dias</option>
          <option value="fidelity">Com fidelidade ativa</option>
          <option value="closed">Encerrados ou inativos</option>
        </Select>
        <Select aria-label="Tipo" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">Todos os tipos</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </Select>
      </div>

      {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}
      {!list.data ? <Skeleton className="h-[320px] rounded-[22px]" /> : list.data.contracts.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream">
          <EmptyState icon={<FileText />} title="Nenhum contrato encontrado" description={canEdit ? 'Cadastre um contrato ou importe a listagem do sistema anterior.' : undefined} />
        </div>
      ) : (
        <>
          <DataTable fit className={list.loading ? 'opacity-60' : ''}>
            <colgroup><col className="w-[26%]" /><col className="w-[22%]" /><col className="w-[17%]" /><col className="w-[17%]" /><col className="w-[18%]" /></colgroup>
            <thead><tr>{['Cliente', 'Contrato', 'Valor e vencimento', 'Vigência', 'Situação'].map((h) => <Th key={h} className="px-3 whitespace-normal">{h}</Th>)}</tr></thead>
            <tbody>
              {list.data.contracts.map((c) => (
                <tr key={c.id} className={canEdit ? 'cursor-pointer transition-colors hover:bg-sage-dim/50' : undefined} onClick={canEdit ? () => setEditing({ contract: c }) : undefined}>
                  <Td className="px-3">
                    <p className="font-medium break-words">{c.client_name}</p>
                    {c.client_code && <p className="text-[12px] text-stone">Nº {c.client_code} no sistema anterior</p>}
                  </Td>
                  <Td className="px-3">
                    <p className="break-words">{c.kind}</p>
                    <p className="text-[12px] text-stone">{c.period}{c.private_office ? ` · ${c.private_office}` : ''}</p>
                  </Td>
                  <Td className="px-3">
                    <p className="font-medium">{c.amount_cents > 0 ? fmtMoney(c.amount_cents) : 'R$ 0,00'}</p>
                    <p className="text-[12px] text-stone">{c.due_day ? `Vence dia ${c.due_day}` : 'Sem dia fixo'}{c.adjustment_index ? ` · ${c.adjustment_index}` : ''}</p>
                  </Td>
                  <Td className="px-3">
                    <p>{fmtDateFull(c.start_date)}{c.end_date ? ` a ${fmtDateFull(c.end_date)}` : ''}</p>
                    <p className="text-[12px] text-stone">{c.fidelity_until ? `Fidelidade até ${fmtDateFull(c.fidelity_until)}` : 'Sem fidelidade'}</p>
                  </Td>
                  <Td className="px-3">
                    <div className="flex items-start justify-between gap-2">
                      {contractBadge(c.status)}
                      {canEdit && <Pencil size={14} className="mt-1 shrink-0 text-stone-light" aria-hidden />}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-stone">
            <span>{from}–{to} de {total} contrato{total === 1 ? '' : 's'}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1 || list.loading} onClick={() => setPage(page - 1)}>Anterior</Button>
                <span>Página {page} de {pages}</span>
                <Button size="sm" variant="secondary" disabled={page >= pages || list.loading} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            )}
          </div>
        </>
      )}

      <ContractForm open={!!editing} contract={editing?.contract} kinds={kinds} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} onDelete={remove} />
      <ImportContractsModal open={importing} onClose={() => setImporting(false)} onDone={() => { setPage(1); list.reload(); }} />
    </>
  );
}

const blank = {
  kind: '', unit: DEFAULT_UNIT, period: 'Mensal', signed_at: '', start_date: '', end_date: '', fidelity_until: '', amount: '0,00', due_day: '',
  private_office: '', adjustment_index: '', last_adjustment: '', active: true, notes: '',
};

/** Busca de um cliente por nome, e-mail ou empresa. */
function ClientSelect({ value, onChange }: { value: { id: number; name: string } | null; onChange: (c: { id: number; name: string } | null) => void }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const found = useApi(() => (q.length >= 2 ? api.get<{ users: Client[] }>('/admin/users', { q, role: 'client', page: '1', per_page: '6' }) : Promise.resolve(null)), [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-sage-700/30 bg-sage-dim px-4 py-3">
        <span className="min-w-0 truncate text-[14px] font-medium text-ink">{value.name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Trocar</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <SearchInput placeholder="Buscar cliente por nome, e-mail ou empresa…" aria-label="Buscar cliente" value={text} onChange={(e) => setText(e.target.value)} />
      {text.trim().length > 0 && text.trim().length < 2 && <p className="text-[12.5px] text-stone-light">Digite ao menos 2 letras.</p>}
      {q.length >= 2 && found.data && (
        found.data.users.length === 0 ? <p className="text-[12.5px] text-stone">Nenhum cliente encontrado.</p> : (
          <ul className="divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10 bg-cream" aria-label="Resultados da busca">
            {found.data.users.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => onChange({ id: u.id, name: u.name })} className="flex w-full cursor-pointer flex-col px-4 py-2.5 text-left text-[13.5px] transition-colors hover:bg-sage-dim/60">
                  <span className="truncate font-medium text-ink">{u.name}</span>
                  <span className="truncate text-[12px] text-stone">{u.company || (u.has_email ? u.email : u.city) || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function ContractForm({ open, contract, kinds, onClose, onSaved, onDelete }: { open: boolean; contract?: Contract; kinds: string[]; onClose: () => void; onSaved: () => void; onDelete: (c: Contract) => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(-1);

  const key = open ? (contract?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setClient(contract ? { id: contract.user_id, name: contract.client_name } : null);
      setF(contract ? {
        kind: contract.kind, unit: contract.unit, period: contract.period, signed_at: contract.signed_at, start_date: contract.start_date, end_date: contract.end_date,
        fidelity_until: contract.fidelity_until, amount: money(contract.amount_cents), due_day: contract.due_day ? String(contract.due_day) : '', private_office: contract.private_office,
        adjustment_index: contract.adjustment_index, last_adjustment: contract.last_adjustment, active: contract.active, notes: contract.notes,
      } : blank);
    }
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!client) return setError('Escolha o cliente do contrato.');
    setSaving(true);
    try {
      const body = {
        kind: f.kind, unit: f.unit, period: f.period, signed_at: f.signed_at, start_date: f.start_date, end_date: f.end_date, fidelity_until: f.fidelity_until,
        amount_cents: parseMoney(f.amount), due_day: f.due_day ? Number(f.due_day) : '', private_office: f.private_office, adjustment_index: f.adjustment_index,
        last_adjustment: f.last_adjustment, active: f.active, notes: f.notes,
      };
      if (contract) await api.put(`/admin/contracts/${contract.id}`, body);
      else await api.post('/admin/contracts', { ...body, user_id: client.id });
      toast.success(contract ? 'Contrato atualizado.' : 'Contrato cadastrado.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      size="lg"
      title={contract ? 'Editar contrato' : 'Novo contrato'}
      footer={
        <>
          {contract && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(contract)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('contract-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="contract-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12px] font-semibold tracking-wide text-ink">Cliente<span className="ml-0.5 text-clay">*</span></span>
          {contract ? (
            <p className="rounded-xl border border-ink/10 bg-sand/50 px-4 py-3 text-[14px] font-medium text-ink">{contract.client_name}</p>
          ) : (
            <ClientSelect value={client} onChange={setClient} />
          )}
        </div>

        <Input label="Tipo de contrato" required list="contract-kinds" maxLength={80} placeholder="Ex.: Endereço fiscal" value={f.kind} onChange={set('kind')} />
        <datalist id="contract-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist>
        <Select label="Periodicidade" value={f.period} onChange={set('period')}>{PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
        <Input label="Unidade" maxLength={80} value={f.unit} onChange={set('unit')} />
        <Input label="Escritório privativo" maxLength={80} placeholder="Se houver" value={f.private_office} onChange={set('private_office')} />

        <Input label="Início" type="date" required value={f.start_date} onChange={set('start_date')} />
        <Input label="Fim" type="date" min={f.start_date || undefined} value={f.end_date} onChange={set('end_date')} hint="Deixe em branco se não tem data de término." />
        <Input label="Assinatura" type="date" value={f.signed_at} onChange={set('signed_at')} />
        <Input label="Fidelidade até" type="date" value={f.fidelity_until} onChange={set('fidelity_until')} hint="Prazo mínimo de permanência." />

        <Input label="Valor (R$)" inputMode="decimal" value={f.amount} onChange={set('amount')} hint="Valor do contrato no período escolhido. R$ 0,00 = paga só o que usar." />
        <Input label="Dia do vencimento" type="number" min={1} max={31} value={f.due_day} onChange={set('due_day')} placeholder="Ex.: 10" />
        <Input label="Índice de reajuste" maxLength={20} placeholder="Ex.: IGPM" value={f.adjustment_index} onChange={set('adjustment_index')} />
        <Input label="Último reajuste" type="date" value={f.last_adjustment} onChange={set('last_adjustment')} />

        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} label="Contrato ativo" description="Desmarque para marcar como encerrado sem apagar o histórico." /></div>
        <Textarea containerClassName="sm:col-span-2" label="Observações" value={f.notes} onChange={set('notes')} placeholder="Anotações internas sobre o contrato" />
      </form>
    </Modal>
  );
}
