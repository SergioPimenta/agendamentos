import { useState, type FormEvent } from 'react';
import { Infinity as InfinityIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Switch } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Plan } from '../../types';

const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);

export default function AdminPlans() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useApi(() => api.get<{ plans: Plan[] }>('/admin/plans'), []);
  const [editing, setEditing] = useState<{ plan?: Plan } | null>(null);

  const remove = async (p: Plan) => {
    if (!(await confirm({ title: `Excluir o plano ${p.name}?`, description: 'Só é possível excluir planos sem clientes.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/plans/${p.id}`);
      toast.success('Plano excluído.');
      setEditing(null);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Planos" description="Defina quantas horas de sala cada plano inclui e que desconto vale nas horas extras." actions={<Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo plano</Button>} />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {!q.data ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[260px] rounded-[24px]" />) : q.data.plans.map((p) => (
          <article key={p.id} className={cn('flex flex-col rounded-[24px] border border-ink/8 bg-cream p-6', !p.active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-[20px] font-medium text-ink">{p.name}</h2>
              {!p.active && <Badge tone="mist">Inativo</Badge>}
            </div>
            <p className="mt-1.5 min-h-[40px] text-[13px] leading-snug text-stone">{p.description}</p>
            <p className="mt-5 font-display text-[28px] leading-none font-medium text-ink">{p.price_cents ? fmtMoney(p.price_cents) : 'Sem mensalidade'}{p.price_cents > 0 && <span className="text-[13px] font-normal text-stone">/mês</span>}</p>
            <ul className="mt-5 flex flex-col gap-2 text-[13px] text-stone">
              <li className="flex items-center gap-2">{p.unlimited ? <><InfinityIcon size={15} className="text-sage-700" />Salas ilimitadas</> : p.included_minutes ? <>✓ {fmtDuration(p.included_minutes)} de sala por mês</> : <>• Sem horas incluídas</>}</li>
              {p.room_discount_percent > 0 && <li>✓ {p.room_discount_percent}% off nas horas extras</li>}
              <li className="text-stone-light">{p.users_count} cliente{p.users_count === 1 ? '' : 's'}</li>
            </ul>
            <Button className="mt-5" variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing({ plan: p })}>Editar</Button>
          </article>
        ))}
      </div>

      <PlanForm open={!!editing} plan={editing?.plan} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); }} onDelete={remove} />
    </>
  );
}

function PlanForm({ open, plan, onClose, onSaved, onDelete }: { open: boolean; plan?: Plan; onClose: () => void; onSaved: () => void; onDelete: (p: Plan) => void }) {
  const toast = useToast();
  const blank = { name: '', description: '', hours: '0', unlimited: false, discount: 0, price: '0,00', active: true };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(-1);

  const key = open ? (plan?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setF(plan ? {
        name: plan.name, description: plan.description, hours: String(plan.included_minutes / 60).replace('.', ','), unlimited: plan.unlimited,
        discount: plan.room_discount_percent, price: (plan.price_cents / 100).toFixed(2).replace('.', ','), active: plan.active,
      } : blank);
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        name: f.name, description: f.description, unlimited: f.unlimited, active: f.active,
        included_minutes: Math.round(parseFloat(f.hours.replace(',', '.') || '0') * 60),
        room_discount_percent: f.discount, price_cents: parseMoney(f.price),
      };
      if (plan) await api.put(`/admin/plans/${plan.id}`, body);
      else await api.post('/admin/plans', body);
      toast.success(plan ? 'Plano atualizado.' : 'Plano criado.');
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
      title={plan ? `Editar ${plan.name}` : 'Novo plano'}
      footer={
        <>
          {plan && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(plan)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('plan-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}
        <Input containerClassName="sm:col-span-2" label="Nome do plano" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input containerClassName="sm:col-span-2" label="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input label="Horas de sala incluídas por mês" inputMode="decimal" disabled={f.unlimited} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} hint="Ex.: 3 ou 1,5" />
        <Input label="Desconto nas horas extras (%)" type="number" min={0} max={100} value={f.discount} onChange={(e) => setF({ ...f, discount: Number(e.target.value) })} />
        <Input label="Mensalidade de referência (R$)" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} hint="Usada em Financeiro → Contas a receber → Gerar mensalidades. Os pagamentos são registrados lá." />
        <div className="flex flex-col justify-center gap-4">
          <Switch checked={f.unlimited} onChange={(v) => setF({ ...f, unlimited: v })} label="Salas ilimitadas" />
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Plano ativo" />
        </div>
      </form>
    </Modal>
  );
}
