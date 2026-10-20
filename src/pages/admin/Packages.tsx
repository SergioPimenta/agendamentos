import { useState, type FormEvent } from 'react';
import { Package, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { PackageCard } from '../../components/plans/PackageCard';
import { PLAN_ICONS } from '../../components/plans/PlanCard';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Select, Switch } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { fmtDateFull, fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Client, HourPackage, PackagePurchase, PlanIconKey } from '../../types';

const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);

const statusBadge = (p: PackagePurchase) =>
  p.display_status === 'paid' ? <Badge tone="sage">Ativo</Badge>
    : p.display_status === 'expired' ? <Badge tone="mist">Vencido</Badge>
      : p.display_status === 'pending' ? <Badge tone="amber">Aguardando pagamento</Badge>
        : <Badge tone="rose">Cancelado</Badge>;

export default function AdminPackages() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEdit = can('packages', 'edit');
  const list = useApi(() => api.get<{ packages: HourPackage[] }>('/admin/packages'), []);
  const purchases = useApi(() => api.get<{ purchases: PackagePurchase[] }>('/admin/packages/purchases'), []);
  const [editing, setEditing] = useState<{ pkg?: HourPackage } | null>(null);
  const [granting, setGranting] = useState(false);

  const remove = async (p: HourPackage) => {
    if (!(await confirm({ title: `Excluir o pacote ${p.name}?`, description: 'Só é possível excluir pacotes que nunca foram vendidos. Caso contrário, desative-o.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/packages/${p.id}`);
      toast.success('Pacote excluído.');
      setEditing(null);
      list.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Pacotes de horas"
        description="Monte os pacotes que o cliente pode comprar em Planos e pacotes. As horas compradas viram saldo e são usadas nas reservas."
        actions={canEdit && (
          <>
            <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => setGranting(true)}>Registrar venda</Button>
            <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo pacote</Button>
          </>
        )}
      />

      {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}
      {!list.data ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] rounded-[24px]" />)}</div> : list.data.packages.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream">
          <EmptyState icon={<Package />} title="Nenhum pacote cadastrado" description="Crie o primeiro pacote de horas para o cliente comprar." action={canEdit ? <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo pacote</Button> : undefined} />
        </div>
      ) : (
        <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.data.packages.map((p) => (
            <PackageCard
              key={p.id}
              pkg={p}
              className={cn(!p.active && 'opacity-60')}
              badges={!p.active ? <Badge tone="mist">Inativo</Badge> : null}
              footer={
                <div className="flex items-center justify-between gap-3">
                  <span className={cn('text-[12.5px]', p.featured ? 'text-cream/70' : 'text-stone-light')}>{p.sold_count ?? 0} venda{p.sold_count === 1 ? '' : 's'}</span>
                  {canEdit && <Button variant={p.featured ? 'light' : 'secondary'} size="sm" icon={<Pencil size={14} />} onClick={() => setEditing({ pkg: p })}>Editar</Button>}
                </div>
              }
            />
          ))}
        </div>
      )}

      <h2 className="mt-12 mb-1 font-display text-[22px] font-medium text-ink">Compras e saldos</h2>
      <p className="mb-5 text-[13.5px] text-stone">Pacotes comprados pelos clientes (ou registrados por você) e quantas horas ainda restam em cada um.</p>
      {purchases.error && <ErrorState message={purchases.error} onRetry={purchases.refetch} />}
      {!purchases.data ? <Skeleton className="h-[200px] rounded-[22px]" /> : purchases.data.purchases.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<Package />} title="Nenhuma compra ainda" /></div>
      ) : (
        <DataTable>
          <thead><tr><Th>Cliente</Th><Th>Pacote</Th><Th>Horas</Th><Th>Restam</Th><Th>Valor</Th><Th>Validade</Th><Th>Situação</Th></tr></thead>
          <tbody>
            {purchases.data.purchases.map((p) => (
              <tr key={p.id}>
                <Td><span className="block font-medium">{p.user_name}</span><span className="text-[12px] text-stone">{p.user_email}</span></Td>
                <Td>{p.name}</Td>
                <Td>{fmtDuration(p.minutes_total)}</Td>
                <Td className="font-medium">{p.status === 'paid' ? fmtDuration(p.minutes_left) : '—'}</Td>
                <Td>{p.price_cents > 0 ? fmtMoney(p.price_cents) : '—'}</Td>
                <Td>{p.status !== 'paid' ? '—' : p.expires_at ? `até ${fmtDateFull(p.expires_at)}` : 'Sem validade'}</Td>
                <Td>{statusBadge(p)}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <PackageForm open={!!editing} pkg={editing?.pkg} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} onDelete={remove} />
      <GrantForm open={granting} packages={list.data?.packages ?? []} onClose={() => setGranting(false)} onSaved={() => { setGranting(false); list.reload(); purchases.reload(); }} />
    </>
  );
}

const blank = {
  name: '', subtitle: '', description: '', hours: '4', price: '0,00', validity: '30', icon: '' as PlanIconKey | '',
  featured: false, active: true, features: [] as string[], sort_order: 0,
};

function PackageForm({ open, pkg, onClose, onSaved, onDelete }: { open: boolean; pkg?: HourPackage; onClose: () => void; onSaved: () => void; onDelete: (p: HourPackage) => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(-1);

  const key = open ? (pkg?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setF(pkg ? {
        name: pkg.name, subtitle: pkg.subtitle, description: pkg.description, hours: String(pkg.minutes / 60).replace('.', ','),
        price: (pkg.price_cents / 100).toFixed(2).replace('.', ','), validity: String(pkg.validity_days), icon: pkg.icon,
        featured: pkg.featured, active: pkg.active, features: [...pkg.features], sort_order: pkg.sort_order,
      } : blank);
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        name: f.name, subtitle: f.subtitle, description: f.description,
        minutes: Math.round(parseFloat(f.hours.replace(',', '.') || '0') * 60),
        price_cents: parseMoney(f.price), validity_days: Math.max(0, Math.round(Number(f.validity) || 0)),
        icon: f.icon, featured: f.featured, active: f.active, sort_order: f.sort_order,
        features: f.features.map((x) => x.trim()).filter(Boolean),
      };
      if (pkg) await api.put(`/admin/packages/${pkg.id}`, body);
      else await api.post('/admin/packages', body);
      toast.success(pkg ? 'Pacote atualizado.' : 'Pacote criado.');
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
      title={pkg ? `Editar ${pkg.name}` : 'Novo pacote de horas'}
      footer={
        <>
          {pkg && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(pkg)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('package-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="package-form" onSubmit={submit} className="flex flex-col gap-7">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-display text-[16px] font-medium text-ink sm:col-span-2">O pacote</h3>
          <Input containerClassName="sm:col-span-2" label="Nome do pacote" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Pacote 10 horas" />
          <Input label="Horas de sala" required inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} hint="Ex.: 10 ou 2,5" />
          <Input label="Preço (R$)" required inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} hint="Valor cobrado pelo pacote inteiro." />
          <Input label="Validade (dias)" type="number" min={0} max={3650} value={f.validity} onChange={(e) => setF({ ...f, validity: e.target.value })} hint="Contados a partir do pagamento. 0 = sem validade." />
          <Input label="Ordem na lista" type="number" min={0} max={999} value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-display text-[16px] font-medium text-ink sm:col-span-2">Como aparece para o cliente</h3>
          <Input label="Subtítulo" maxLength={120} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} hint="Ex.: Para quem atende toda semana" />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold tracking-wide text-ink">Ícone</span>
            <div role="radiogroup" aria-label="Ícone do pacote" className="flex flex-wrap gap-2">
              {PLAN_ICONS.map(({ key: k, label, Icon }) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.icon === k}
                  aria-label={label}
                  title={label}
                  onClick={() => setF({ ...f, icon: k })}
                  className={cn('flex h-11 w-11 items-center justify-center rounded-xl border transition-colors', f.icon === k ? 'border-sage-700 bg-sage-dim text-sage-700' : 'border-ink/12 text-stone hover:border-ink/30')}
                >
                  <Icon size={20} strokeWidth={1.8} />
                </button>
              ))}
            </div>
          </div>
          <Input containerClassName="sm:col-span-2" label="Descrição" maxLength={255} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} hint="Frase curta sobre para quem o pacote serve." />
          <div className="flex flex-col gap-4 sm:col-span-2">
            <Switch checked={f.featured} onChange={(v) => setF({ ...f, featured: v })} label="Pacote em destaque" description="O cartão fica em verde escuro, chamando mais atenção." />
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Pacote ativo" description="Inativo, não aparece para o cliente comprar." />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-[16px] font-medium text-ink">Benefícios</h3>
            <Button type="button" size="sm" variant="soft" icon={<Plus size={14} />} disabled={f.features.length >= 12} onClick={() => setF({ ...f, features: [...f.features, ''] })}>Adicionar</Button>
          </div>
          {f.features.length === 0 && <p className="text-[13px] text-stone">Opcional. O cartão já mostra as horas e a validade; use esta lista para o que mais quiser destacar.</p>}
          {f.features.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input containerClassName="flex-1" aria-label={`Benefício ${i + 1}`} maxLength={200} value={x} onChange={(e) => setF({ ...f, features: f.features.map((y, j) => (j === i ? e.target.value : y)) })} placeholder="Ex.: Use em qualquer sala" />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remover benefício ${i + 1}`} icon={<X size={16} />} onClick={() => setF({ ...f, features: f.features.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </section>
      </form>
    </Modal>
  );
}

const METHODS = [['outro', 'Outro'], ['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['cartao', 'Cartão'], ['transferencia', 'Transferência'], ['boleto', 'Boleto']] as const;

/** Venda feita pela recepção (ex.: paga no balcão): o pacote entra paga, no saldo e no Financeiro. */
function GrantForm({ open, packages, onClose, onSaved }: { open: boolean; packages: HourPackage[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const clients = useApi(() => (open ? api.get<{ users: Client[] }>('/admin/users', { role: 'client', active: 'true' }) : Promise.resolve(null)), [open]);
  const [userId, setUserId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [method, setMethod] = useState('outro');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/admin/packages/grant', { user_id: Number(userId), package_id: Number(packageId), method });
      toast.success('Venda registrada. As horas já estão no saldo do cliente.');
      setUserId('');
      setPackageId('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title="Registrar venda de pacote"
      subtitle="Para quando o cliente já pagou (balcão, Pix, etc.). Entra como pago, com saldo e lançamento no Financeiro."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} disabled={!userId || !packageId} onClick={() => (document.getElementById('grant-form') as HTMLFormElement)?.requestSubmit()}>Registrar venda</Button>
        </>
      }
    >
      <form id="grant-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}
        <Select label="Cliente" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Escolha o cliente…</option>
          {clients.data?.users.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
        </Select>
        <Select label="Pacote" required value={packageId} onChange={(e) => setPackageId(e.target.value)}>
          <option value="">Escolha o pacote…</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtDuration(p.minutes)} · {fmtMoney(p.price_cents)}{p.active ? '' : ' (inativo)'}</option>)}
        </Select>
        <Select label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </form>
    </Modal>
  );
}
