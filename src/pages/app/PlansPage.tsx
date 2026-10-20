import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Infinity as InfinityIcon, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import { PageHeader } from '../../components/ui/Misc';
import type { ClientPlan, ClientPlans, OnlinePayment, User } from '../../types';

export default function PlansPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<number | null>(null);
  const q = useApi(() => api.get<ClientPlans>('/me/plans'), []);
  const d = q.data;

  const refreshUser = () => api.get<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => {});

  // Volta do Pagar.me: confirma o pagamento direto na fonte e atualiza o plano na tela.
  const returned = params.get('pagamento');
  useEffect(() => {
    if (!returned) return;
    setParams({}, { replace: true });
    api
      .post<{ payment: OnlinePayment }>(`/payments/${returned}/sync`)
      .then((r) => {
        if (r.payment.status === 'paid') toast.success('Pagamento confirmado. Seu novo plano já está valendo!');
        else toast.info('Recebemos o seu retorno. Pix e boleto podem levar alguns minutos; o plano muda assim que o pagamento for confirmado.');
        q.reload();
        refreshUser();
      })
      .catch(() => toast.info('Não conseguimos confirmar agora. Se você já pagou, o plano muda sozinho em instantes.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned]);

  const choose = async (p: ClientPlan) => {
    if (p.price_cents <= 0 && !(await confirm({
      title: `Mudar para o plano ${p.name}?`,
      description: 'O plano atual deixa de valer agora e não há reembolso de mensalidade já paga.',
      confirmLabel: 'Mudar de plano',
    }))) return;
    setBusy(p.id);
    try {
      const r = await api.post<{ activated: boolean; payment?: OnlinePayment }>(`/me/plans/${p.id}/subscribe`);
      if (r.activated) {
        toast.success(`Plano ${p.name} ativado.`);
        q.reload();
        refreshUser();
      } else if (r.payment?.checkout_url) {
        window.location.href = r.payment.checkout_url;
        return;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível escolher o plano.');
    }
    setBusy(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Conta"
        title="Planos"
        description="Escolha o plano que combina com o seu uso. Planos com mensalidade são pagos online, com Pix, cartão ou boleto."
      />

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {!d ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[330px] rounded-[24px]" />) : d.plans.map((p) => {
          const current = p.id === d.current_plan_id;
          const pending = p.id === d.pending_plan_id;
          const paid = p.price_cents > 0;
          const blocked = paid && !d.online_payments;
          return (
            <article
              key={p.id}
              className={cn('flex flex-col rounded-[24px] border bg-cream p-6', current ? 'border-sage-700 ring-2 ring-sage-700/15' : 'border-ink/8')}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-[20px] font-medium text-ink">{p.name}</h2>
                {current ? <Badge tone="sage"><Check size={12} />Seu plano</Badge> : pending ? <Badge tone="amber">Aguardando pagamento</Badge> : null}
              </div>
              <p className="mt-1.5 min-h-[40px] text-[13px] leading-snug text-stone">{p.description}</p>
              <p className="mt-5 font-display text-[30px] leading-none font-medium text-ink">
                {paid ? fmtMoney(p.price_cents) : 'Sem mensalidade'}
                {paid && <span className="text-[13px] font-normal text-stone">/mês</span>}
              </p>
              <ul className="mt-5 flex flex-1 flex-col gap-2 text-[13px] text-stone">
                <li className="flex items-center gap-2">
                  {p.unlimited ? <><InfinityIcon size={15} className="text-sage-700" />Salas ilimitadas</>
                    : p.included_minutes ? <><Check size={15} className="text-sage-700" />{fmtDuration(p.included_minutes)} de sala por mês</>
                    : <><span className="w-[15px] text-center text-stone-light">•</span>Sem horas incluídas</>}
                </li>
                {p.room_discount_percent > 0 && <li className="flex items-center gap-2"><Check size={15} className="text-sage-700" />{p.room_discount_percent}% off nas horas extras</li>}
                {!p.unlimited && <li className="flex items-center gap-2"><span className="w-[15px] text-center text-stone-light">•</span>Horas além do plano pagas por uso</li>}
              </ul>
              <Button
                className="mt-6"
                variant={current ? 'secondary' : 'primary'}
                disabled={current || blocked}
                loading={busy === p.id}
                onClick={() => choose(p)}
              >
                {current ? 'Plano atual' : blocked ? 'Fale com a recepção' : paid ? (pending ? 'Continuar pagamento' : `Assinar · ${fmtMoney(p.price_cents)}`) : 'Mudar para este plano'}
              </Button>
            </article>
          );
        })}
      </div>

      {d && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-ink/8 bg-cream px-5 py-4 text-[13px] leading-relaxed text-stone">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-sage-700" />
          <p>
            {d.online_payments
              ? 'Pagamento em ambiente seguro do Pagar.me. O novo plano passa a valer assim que o pagamento é confirmado, e a mensalidade do mês é cobrada por inteiro.'
              : `O pagamento online ainda não está ativado. Para mudar para um plano com mensalidade, fale com a recepção${settings?.business_phone ? ` (${settings.business_phone})` : ''}.`}
          </p>
        </div>
      )}
    </>
  );
}
