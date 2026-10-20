import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { PLAN_ICONS, PlanCard } from '../../components/plans/PlanCard';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Switch } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { api } from '../../services/api';
import type { Plan, PlanIconKey } from '../../types';

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
      <PageHeader eyebrow="Comercial" title="Planos" description="Monte a vitrine dos planos como o cliente vai ver e defina quantas horas cada um inclui e que desconto vale nas horas extras." actions={<Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo plano</Button>} />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
        {!q.data ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[520px] rounded-[24px]" />) : q.data.plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            className={cn(!p.active && 'opacity-60')}
            badges={!p.active ? <Badge tone="mist">Inativo</Badge> : null}
            footer={
              <div className="flex items-center justify-between gap-3">
                <span className={cn('text-[12.5px]', p.featured ? 'text-cream/70' : 'text-stone-light')}>{p.users_count} cliente{p.users_count === 1 ? '' : 's'}</span>
                <Button variant={p.featured ? 'light' : 'secondary'} size="sm" icon={<Pencil size={14} />} onClick={() => setEditing({ plan: p })}>Editar</Button>
              </div>
            }
          />
        ))}
      </div>

      <PlanForm open={!!editing} plan={editing?.plan} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); }} onDelete={remove} />
    </>
  );
}

const blank = {
  name: '', description: '', hours: '0', unlimited: false, discount: 0, price: '0,00', active: true,
  subtitle: '', icon: '' as PlanIconKey | '', price_label: '', price_note: '', featured: false,
  features: [] as string[], tiers: [] as { label: string; benefit: string }[], tiers_note: '',
  layout: 'card' as Plan['layout'], headline: '', cta_label: '', contact_only: false,
};

function PlanForm({ open, plan, onClose, onSaved, onDelete }: { open: boolean; plan?: Plan; onClose: () => void; onSaved: () => void; onDelete: (p: Plan) => void }) {
  const toast = useToast();
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
        subtitle: plan.subtitle, icon: plan.icon, price_label: plan.price_label, price_note: plan.price_note, featured: plan.featured,
        features: [...plan.features], tiers: plan.tiers.map((t) => ({ ...t })), tiers_note: plan.tiers_note,
        layout: plan.layout, headline: plan.headline, cta_label: plan.cta_label, contact_only: plan.contact_only,
      } : blank);
    }
  }

  const setFeature = (i: number, v: string) => setF((s) => ({ ...s, features: s.features.map((x, j) => (j === i ? v : x)) }));
  const setTier = (i: number, k: 'label' | 'benefit', v: string) => setF((s) => ({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        name: f.name, description: f.description, unlimited: f.unlimited, active: f.active,
        included_minutes: Math.round(parseFloat(f.hours.replace(',', '.') || '0') * 60),
        room_discount_percent: f.discount, price_cents: parseMoney(f.price),
        subtitle: f.subtitle, icon: f.icon, price_label: f.price_label, price_note: f.price_note, featured: f.featured,
        // Linhas em branco são ignoradas em vez de dar erro.
        features: f.features.map((x) => x.trim()).filter(Boolean),
        tiers: f.tiers.map((t) => ({ label: t.label.trim(), benefit: t.benefit.trim() })).filter((t) => t.label && t.benefit),
        tiers_note: f.tiers_note,
        layout: f.layout, headline: f.headline, cta_label: f.cta_label, contact_only: f.contact_only,
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
      size="lg"
      title={plan ? `Editar ${plan.name}` : 'Novo plano'}
      footer={
        <>
          {plan && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(plan)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('plan-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="flex flex-col gap-7">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-display text-[16px] font-medium text-ink sm:col-span-2">Como o plano aparece para o cliente</h3>
          <Input containerClassName="sm:col-span-2" label="Nome do plano" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Subtítulo" maxLength={120} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} hint="Ex.: Combo de 4 horas" />
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold tracking-wide text-ink">Ícone</span>
            <div role="radiogroup" aria-label="Ícone do plano" className="flex flex-wrap gap-2">
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
          <Input containerClassName="sm:col-span-2" label="Descrição" maxLength={255} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} hint="Frase curta sobre para quem o plano serve." />
          <Input label="Preço em destaque" maxLength={80} value={f.price_label} onChange={(e) => setF({ ...f, price_label: e.target.value })} hint="Ex.: R$ 144,00 ou Usa primeiro. Vazio mostra a mensalidade abaixo." />
          <Input label="Texto ao lado do preço" maxLength={120} value={f.price_note} onChange={(e) => setF({ ...f, price_note: e.target.value })} hint="Ex.: /mês (a hora sai por R$ 36,00)" />
          <div className="sm:col-span-2"><Switch checked={f.featured} onChange={(v) => setF({ ...f, featured: v })} label="Plano em destaque" description="O cartão fica em verde escuro, chamando mais atenção." /></div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12px] font-semibold tracking-wide text-ink">Formato</span>
            <div role="radiogroup" aria-label="Formato do plano" className="inline-flex w-fit rounded-full border border-ink/10 bg-cream p-1">
              {([['card', 'Cartão'], ['banner', 'Faixa larga']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.layout === v}
                  onClick={() => setF({ ...f, layout: v })}
                  className={cn('rounded-full px-4 py-2 text-[13px] font-semibold transition-colors', f.layout === v ? 'bg-sage-700 text-cream' : 'text-stone hover:text-ink')}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-stone-light">Faixa larga ocupa a linha inteira, com título grande, como o Endereço Comercial.</p>
          </div>
          {f.layout === 'banner' && <Input containerClassName="sm:col-span-2" label="Título grande da faixa" maxLength={160} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} hint="Ex.: Nosso Endereço Comercial Premium. Vazio usa o nome do plano." />}
          <Input label="Texto do botão" maxLength={80} value={f.cta_label} onChange={(e) => setF({ ...f, cta_label: e.target.value })} hint="Ex.: Contratar Endereço Comercial" />
          <div className="flex items-center"><Switch checked={f.contact_only} onChange={(v) => setF({ ...f, contact_only: v })} label="Contratação pelo WhatsApp" description="O botão abre o WhatsApp do espaço, sem assinatura nem pagamento online." /></div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-[16px] font-medium text-ink">Benefícios</h3>
            <Button type="button" size="sm" variant="soft" icon={<Plus size={14} />} disabled={f.features.length >= 12} onClick={() => setF({ ...f, features: [...f.features, ''] })}>Adicionar</Button>
          </div>
          {f.features.length === 0 && <p className="text-[13px] text-stone">Sem benefícios cadastrados: o cartão mostra um resumo automático das horas e do desconto.</p>}
          {f.features.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input containerClassName="flex-1" aria-label={`Benefício ${i + 1}`} maxLength={200} value={x} onChange={(e) => setFeature(i, e.target.value)} placeholder="Ex.: Acesso livre e agendamento online prático" />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remover benefício ${i + 1}`} icon={<X size={16} />} onClick={() => setF({ ...f, features: f.features.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-[16px] font-medium text-ink">Tabela de descontos</h3>
            <Button type="button" size="sm" variant="soft" icon={<Plus size={14} />} disabled={f.tiers.length >= 8} onClick={() => setF({ ...f, tiers: [...f.tiers, { label: '', benefit: '' }] })}>Adicionar faixa</Button>
          </div>
          {f.tiers.length === 0 && <p className="text-[13px] text-stone">Opcional. Use para mostrar descontos por faixa de horas, como no Plano Ecossistema.</p>}
          {f.tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input containerClassName="flex-1" aria-label={`Faixa ${i + 1}`} maxLength={80} value={t.label} onChange={(e) => setTier(i, 'label', e.target.value)} placeholder="De 10 a 29,5 horas no mês" />
              <Input containerClassName="flex-1" aria-label={`Desconto da faixa ${i + 1}`} maxLength={80} value={t.benefit} onChange={(e) => setTier(i, 'benefit', e.target.value)} placeholder="-R$ 2,00 de desconto por hora" />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remover faixa ${i + 1}`} icon={<X size={16} />} onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {f.tiers.length > 0 && <Input label="Observação sob a tabela" maxLength={255} value={f.tiers_note} onChange={(e) => setF({ ...f, tiers_note: e.target.value })} />}
          {f.tiers.length > 0 && <p className="text-[12.5px] text-stone">A tabela é informativa: o desconto por faixa não é aplicado automaticamente nas cobranças.</p>}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-display text-[16px] font-medium text-ink sm:col-span-2">Regras de cobrança</h3>
          <Input label="Horas de sala incluídas por mês" inputMode="decimal" disabled={f.unlimited} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} hint="Ex.: 3 ou 1,5" />
          <Input label="Desconto nas horas extras (%)" type="number" min={0} max={100} value={f.discount} onChange={(e) => setF({ ...f, discount: Number(e.target.value) })} />
          <Input label="Mensalidade de referência (R$)" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} hint="Valor cobrado quando o cliente assina e gerado em Financeiro → Gerar mensalidades. 0 = sem mensalidade." />
          <div className="flex flex-col justify-center gap-4">
            <Switch checked={f.unlimited} onChange={(v) => setF({ ...f, unlimited: v })} label="Salas ilimitadas" />
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Plano ativo" description="Inativo, não aparece para o cliente escolher." />
          </div>
        </section>
      </form>
    </Modal>
  );
}
