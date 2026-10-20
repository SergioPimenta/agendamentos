import { useMemo, useState, type FormEvent } from 'react';
import { Clock, Hourglass, Plus, Undo2, Users } from 'lucide-react';
import { BankLots, SOURCE_LABEL } from '../../components/plans/BankLots';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, SearchInput, Select, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Card, PageHeader, Stat } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { fmtDuration, todayStr } from '../../lib/format';
import { api } from '../../services/api';
import type { BankOverview, Client, LotSource, PackageLot } from '../../types';

const SOURCES: LotSource[] = ['package', 'cancellation', 'manual'];

export default function AdminHourBank() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEdit = can('hour_bank', 'edit');
  const q = useApi(() => api.get<BankOverview>('/admin/hour-bank'), []);
  const [text, setText] = useState('');
  const search = useDebounced(text, 250).trim().toLowerCase();
  const [source, setSource] = useState<'' | LotSource>('');
  const [adding, setAdding] = useState(false);
  const today = todayStr();
  const d = q.data;

  // Filtra por nome/e-mail e por origem; com filtro de origem, só os lotes daquela origem aparecem.
  const clients = useMemo(() => {
    if (!d) return [];
    return d.clients
      .filter((c) => !search || c.name.toLowerCase().includes(search) || c.email.toLowerCase().includes(search))
      .map((c) => {
        const lots = source ? c.lots.filter((l) => l.source === source) : c.lots;
        return { ...c, lots, minutes_available: lots.reduce((a, l) => a + l.remaining, 0) };
      })
      .filter((c) => c.lots.length > 0);
  }, [d, search, source]);

  const revoke = async (lot: PackageLot, clientName: string) => {
    const ok = await confirm({
      title: 'Retirar este lote do banco de horas?',
      description: `${fmtDuration(lot.remaining)} de ${clientName} (${lot.name}) deixam de valer. Reservas já feitas com este lote não são alteradas.`,
      confirmLabel: 'Retirar horas',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/hour-bank/lots/${lot.id}/revoke`);
      toast.success('Lote retirado do banco de horas.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível retirar.');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Banco de horas"
        description="Clientes com horas guardadas e de onde vem cada saldo: pacotes comprados, reservas pagas e canceladas e ajustes da recepção."
        actions={canEdit && <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Adicionar horas</Button>}
      />

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Clientes com saldo" value={d ? d.totals.clients : '—'} hint="com horas disponíveis" icon={<Users />} />
        <Stat label="Horas no banco" value={d ? fmtDuration(d.totals.minutes) : '—'} hint="somando todos os clientes" icon={<Hourglass />} tone="clay" />
        <Stat label="Vencem em 30 dias" value={d ? fmtDuration(d.totals.expiring_minutes) : '—'} hint="para avisar quem ainda não usou" icon={<Clock />} tone="amber" />
      </div>

      {d && d.totals.minutes > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-stone">
          <span className="mr-1">Por origem:</span>
          {SOURCES.map((s) => (
            <Badge key={s} tone={s === 'package' ? 'sage' : s === 'cancellation' ? 'clay' : 'amber'}>{SOURCE_LABEL[s]}: {fmtDuration(d.totals.by_source[s])}</Badge>
          ))}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-[1.6fr_1fr]">
        <SearchInput placeholder="Buscar cliente por nome ou e-mail…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar cliente" />
        <Select aria-label="Filtrar por origem" value={source} onChange={(e) => setSource(e.target.value as '' | LotSource)}>
          <option value="">Todas as origens</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </Select>
      </div>

      {!d ? <Skeleton className="h-[280px] rounded-[22px]" /> : clients.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream">
          <EmptyState
            icon={<Hourglass />}
            title={d.clients.length === 0 ? 'Nenhum cliente com saldo no banco de horas' : 'Nenhum cliente encontrado'}
            description={d.clients.length === 0 ? 'Quando alguém comprar um pacote ou cancelar uma reserva já paga, as horas aparecem aqui.' : 'Ajuste a busca ou o filtro de origem.'}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {clients.map((c) => (
            <Card key={c.user_id} className="p-0" padded={false}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink/8 px-5 py-4 sm:px-6">
                <Avatar name={c.name} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[18px] font-medium text-ink">{c.name}</p>
                  <p className="truncate text-[12.5px] text-stone">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-[24px] leading-none font-medium text-ink">{fmtDuration(c.minutes_available)}</p>
                  <p className="mt-1 text-[11.5px] tracking-[0.1em] text-stone uppercase">disponíveis</p>
                </div>
              </div>
              <div className="px-5 py-4 sm:px-6">
                <BankLots
                  lots={c.lots}
                  today={today}
                  action={canEdit ? (lot) => (
                    <Button variant="ghost" size="sm" icon={<Undo2 size={14} />} onClick={() => revoke(lot, c.name)} aria-label={`Retirar lote ${lot.name}`}>Retirar</Button>
                  ) : undefined}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreditForm open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); q.reload(); }} />
    </>
  );
}

/** Crédito manual: cortesia, correção, reposição de horas... sempre com o motivo anotado. */
function CreditForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const clients = useApi(() => (open ? api.get<{ users: Client[] }>('/admin/users', { role: 'client', active: 'true' }) : Promise.resolve(null)), [open]);
  const [userId, setUserId] = useState('');
  const [hours, setHours] = useState('1');
  const [validity, setValidity] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/admin/hour-bank/credit', {
        user_id: Number(userId),
        minutes: Math.round(parseFloat(hours.replace(',', '.') || '0') * 60),
        note,
        ...(validity.trim() !== '' ? { validity_days: Math.max(0, Math.round(Number(validity))) } : {}),
      });
      toast.success('Horas adicionadas ao banco do cliente.');
      setUserId('');
      setHours('1');
      setValidity('');
      setNote('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível adicionar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title="Adicionar horas ao banco"
      subtitle="Para cortesias, correções ou reposição de horas. O motivo fica registrado no lote, e o cliente o vê."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} disabled={!userId || !note.trim()} onClick={() => (document.getElementById('credit-form') as HTMLFormElement)?.requestSubmit()}>Adicionar horas</Button>
        </>
      }
    >
      <form id="credit-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}
        <Select label="Cliente" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Escolha o cliente…</option>
          {clients.data?.users.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Horas" required inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} hint="Ex.: 1 ou 1,5" />
          <Input label="Validade (dias)" type="number" min={0} max={3650} value={validity} onChange={(e) => setValidity(e.target.value)} hint="Vazio usa o padrão das Configurações. 0 = sem validade." />
        </div>
        <Textarea label="Motivo" required maxLength={255} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Cortesia por sala indisponível em 12/11" />
      </form>
    </Modal>
  );
}
