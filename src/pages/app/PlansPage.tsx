import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, MessageCircle, ShieldCheck } from 'lucide-react';
import { BankCard } from '../../components/plans/BankCard';
import { PackageCard } from '../../components/plans/PackageCard';
import { PlanCard } from '../../components/plans/PlanCard';
import { Button, buttonClass } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { fmtMoney } from '../../lib/format';
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

  // Plano com combos (Plano Raiz): contrata o combo da categoria de sala escolhida.
  const [comboChoice, setComboChoice] = useState<Record<number, number>>({});
  const contractCombo = async (p: ClientPlan, packageId: number) => {
    setBusy(p.id);
    try {
      const r = await api.post<{ payment?: OnlinePayment }>(`/me/plans/${p.id}/subscribe`, { package_id: packageId });
      if (r.payment?.checkout_url) {
        window.location.href = r.payment.checkout_url;
        return;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.');
    }
    setBusy(null);
  };

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

      {pk.data && <BankCard id="banco-titulo" balance={pk.data.balance} className="mb-10" />}

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
              footer={p.combos.length > 0 ? (
                <ComboPicker
                  plan={p}
                  dark={p.featured}
                  online={d.online_payments}
                  chosen={comboChoice[p.id] ?? p.combos[0].id}
                  onChoose={(id) => setComboChoice((c) => ({ ...c, [p.id]: id }))}
                  busy={busy === p.id}
                  onContract={(id) => contractCombo(p, id)}
                />
              ) : p.contact_only && !current ? contactButton : (
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

      {pk.data && pk.data.packages.length > 0 && (
        <section className="mt-14" aria-labelledby="pacotes-titulo">
          <h2 id="pacotes-titulo" className="font-display text-[clamp(1.5rem,2.4vw,1.9rem)] font-medium text-ink">Pacotes de horas</h2>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-stone">
            Compre horas de sala de uma vez e use quando quiser. As horas vão para o seu banco de horas e são descontadas automaticamente nas reservas, depois das horas do seu plano.
          </p>

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

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

/** Escolha da categoria de sala do combo (Plano Raiz): valor fechado por categoria e o botão de contratar o ciclo. */
function ComboPicker({ plan, dark, online, chosen, onChoose, busy, onContract }: {
  plan: ClientPlan; dark: boolean; online: boolean; chosen: number; onChoose: (id: number) => void; busy: boolean; onContract: (id: number) => void;
}) {
  const selected = plan.combos.find((c) => c.id === chosen) ?? plan.combos[0];
  const cycle = plan.combo_cycle;
  const roomsOf = (c: HourPackage) => (c.rooms.length ? c.rooms.map((r) => r.replace(/^Sala /, '')).join(' e ') : 'Todas as salas');
  return (
    <div className="flex flex-col gap-3">
      <p className={`text-[12px] font-semibold tracking-[0.08em] uppercase ${dark ? 'text-cream/70' : 'text-stone'}`}>Escolha a categoria de sala</p>
      <div role="radiogroup" aria-label="Categoria de sala do combo" className="flex flex-col gap-2">
        {plan.combos.map((c) => {
          const on = c.id === selected.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(c.id)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors ${
                dark
                  ? on ? 'border-cream bg-cream/20' : 'border-cream/25 hover:border-cream/60'
                  : on ? 'border-sage-700 bg-sage-dim' : 'border-ink/12 hover:border-ink/30'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{c.name.replace('Plano Raiz · ', '')}</span>
                {c.rooms.length !== 1 && <span className={`block truncate text-[12px] ${dark ? 'text-cream/70' : 'text-stone'}`}>{roomsOf(c)}</span>}
              </span>
              <span className="shrink-0 font-display text-[16px] font-medium">{fmtMoney(c.price_cents)}</span>
            </button>
          );
        })}
      </div>
      {cycle ? (
        <>
          <Button className="w-full" variant={dark ? 'outline-light' : 'secondary'} disabled>Ciclo em andamento</Button>
          <p className={`text-[12.5px] leading-snug ${dark ? 'text-cream/80' : 'text-stone'}`}>
            Você tem {hm(cycle.remaining)} do ciclo atual{cycle.expires_at ? `, válidas até ${dmy(cycle.expires_at)}` : ''}. Os créditos não acumulam: a renovação abre quando o ciclo terminar.
          </p>
        </>
      ) : (
        <Button className="w-full" variant={dark ? 'light' : 'primary'} disabled={!online} loading={busy} onClick={() => onContract(selected.id)}>
          {online ? `Contratar · ${fmtMoney(selected.price_cents)}` : 'Fale com a recepção'}
        </Button>
      )}
      <p className={`text-[12px] leading-snug ${dark ? 'text-cream/65' : 'text-stone-light'}`}>4 horas pré-pagas, válidas por 30 dias. Pague com cartão ou Pix e gerencie tudo em Minhas reservas.</p>
    </div>
  );
}