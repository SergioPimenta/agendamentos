import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Clock, MessageCircle, ShieldCheck } from 'lucide-react';
import { PackageCard } from '../../components/plans/PackageCard';
import { PlanCard } from '../../components/plans/PlanCard';
import { Button, buttonClass } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { fmtDateFull, fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import { PageHeader } from '../../components/ui/Misc';
import type { ClientPackages, ClientPlan, ClientPlans, HourPackage, OnlinePayment, User } from '../../types';

export default function PlansPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<number | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const q = useApi(() => api.get<ClientPlans>('/me/plans'), []);
  const pk = useApi(() => api.get<ClientPackages>('/me/packages'), []);
  const d = q.data;

  const buy = async (p: HourPackage) => {
    setBuying(p.id);
    try {
      const r = await api.post<{ payment: OnlinePayment }>(`/me/packages/${p.id}/purchase`);
      if (r.payment.checkout_url) {
        window.location.href = r.payment.checkout_url;
        return;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.');
    }
    setBuying(null);
  };

  const refreshUser = () => api.get<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => {});

  // Volta do Pagar.me: confirma o pagamento direto na fonte e atualiza o plano na tela.
  const returned = params.get('pagamento');
  useEffect(() => {
    if (!returned) return;
    setParams({}, { replace: true });
    api
      .post<{ payment: OnlinePayment }>(`/payments/${returned}/sync`)
      .then((r) => {
        if (r.payment.status === 'paid') toast.success('Pagamento confirmado. Seu plano ou pacote já está valendo!');
        else toast.info('Recebemos o seu retorno. Pix e boleto podem levar alguns minutos; o plano ou as horas valem assim que o pagamento for confirmado.');
        q.reload();
        pk.reload();
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
        title="Planos e pacotes"
        description="Escolha o plano que combina com o seu uso e, se quiser, compre pacotes de horas. O pagamento é online, com Pix, cartão ou boleto."
      />

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
        {!d ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[520px] rounded-[24px]" />) : d.plans.map((p) => {
          const current = p.id === d.current_plan_id;
          const pending = p.id === d.pending_plan_id;
          const paid = p.price_cents > 0;
          const blocked = paid && !d.online_payments;
          const label = current ? 'Plano atual' : blocked ? 'Fale com a recepção' : paid ? (pending ? 'Continuar pagamento' : `Assinar · ${fmtMoney(p.price_cents)}`) : 'Mudar para este plano';
          // Plano contratado pela recepção: o botão abre o WhatsApp do espaço com a mensagem pronta.
          const whatsapp = settings?.business_whatsapp?.replace(/\D/g, '');
          const contactHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Quero contratar o plano ${p.name}.`)}` : undefined;
          const contactButton = contactHref
            ? (
              <a href={contactHref} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg', 'no-underline')}>
                <MessageCircle size={17} />{p.cta_label || 'Falar com a recepção'}
              </a>
            )
            : <Button size="lg" disabled>{p.cta_label || 'Fale com a recepção'}</Button>;
          return (
            <PlanCard
              key={p.id}
              plan={p}
              className={current && !p.featured ? 'border-sage-700 ring-2 ring-sage-700/15' : undefined}
              badges={current ? <Badge tone={p.featured ? 'mist' : 'sage'}><Check size={12} />Seu plano</Badge> : pending ? <Badge tone="amber">Aguardando pagamento</Badge> : null}
              footer={p.contact_only && !current ? contactButton : (
                <Button
                  className="w-full"
                  variant={p.featured ? (current ? 'outline-light' : 'light') : current ? 'secondary' : 'primary'}
                  disabled={current || blocked}
                  loading={busy === p.id}
                  onClick={() => choose(p)}
                >
                  {label}
                </Button>
              )}
            />
          );
        })}
      </div>

      {pk.data && (pk.data.packages.length > 0 || pk.data.balance.minutes_available > 0) && (
        <section className="mt-14" aria-labelledby="pacotes-titulo">
          <h2 id="pacotes-titulo" className="font-display text-[clamp(1.5rem,2.4vw,1.9rem)] font-medium text-ink">Pacotes de horas</h2>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-stone">
            Compre horas de sala de uma vez e use quando quiser. O saldo é descontado automaticamente nas suas reservas, depois das horas do seu plano.
          </p>

          {pk.data.balance.minutes_available > 0 && (
            <div className="mt-5 rounded-[22px] border border-sage-700/25 bg-cream p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sage-dim text-sage-700"><Clock size={20} /></span>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">Seu saldo de pacotes</p>
                  <p className="font-display text-[26px] leading-tight font-medium text-ink">{fmtDuration(pk.data.balance.minutes_available)} <span className="text-[14px] font-normal text-stone">disponíveis</span></p>
                </div>
              </div>
              <ul className="mt-4 flex flex-col gap-2 border-t border-ink/8 pt-4 text-[13px] text-stone">
                {pk.data.balance.lots.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                    <span><strong className="font-semibold text-ink">{l.name}</strong> · restam {fmtDuration(l.remaining)} de {fmtDuration(l.minutes_total)}</span>
                    <span className="text-stone-light">{l.expires_at ? `vale até ${fmtDateFull(l.expires_at)}` : 'sem validade'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pk.data.packages.length > 0 && (
            <div className="mt-6 grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
              {pk.data.packages.map((p) => {
                const pending = p.id === pk.data!.pending_package_id;
                const blocked = !pk.data!.online_payments || p.price_cents <= 0;
                return (
                  <PackageCard
                    key={p.id}
                    pkg={p}
                    badges={pending ? <Badge tone="amber">Aguardando pagamento</Badge> : null}
                    footer={
                      <Button
                        className="w-full"
                        variant={p.featured ? 'light' : 'primary'}
                        disabled={blocked}
                        loading={buying === p.id}
                        onClick={() => buy(p)}
                      >
                        {blocked ? 'Fale com a recepção' : pending ? 'Continuar pagamento' : `Comprar · ${fmtMoney(p.price_cents)}`}
                      </Button>
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

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
