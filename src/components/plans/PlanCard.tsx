import type { ReactNode } from 'react';
import { Building2, Check, Flower2, Infinity as InfinityIcon, Leaf, Mountain, Sprout, Sun, TreePine, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtDuration, fmtMoney } from '../../lib/format';
import type { PlanIconKey, PlanShowcase } from '../../types';

export const PLAN_ICONS: { key: PlanIconKey; label: string; Icon: LucideIcon }[] = [
  { key: 'leaf', label: 'Folha', Icon: Leaf },
  { key: 'sprout', label: 'Broto', Icon: Sprout },
  { key: 'tree', label: 'Árvore', Icon: TreePine },
  { key: 'flower', label: 'Flor', Icon: Flower2 },
  { key: 'sun', label: 'Sol', Icon: Sun },
  { key: 'mountain', label: 'Montanha', Icon: Mountain },
  { key: 'building', label: 'Prédio', Icon: Building2 },
];

export function PlanIcon({ icon, size = 22 }: { icon: PlanIconKey | ''; size?: number }) {
  const Icon = PLAN_ICONS.find((i) => i.key === icon)?.Icon ?? Leaf;
  return <Icon size={size} strokeWidth={1.8} />;
}

/**
 * Plano em faixa larga (ex.: Endereço Comercial): subtítulo como "etiqueta", título grande e descrição à esquerda;
 * preço, observações (os benefícios, em parágrafos) e o botão à direita. Ocupa a linha inteira da grade.
 */
function PlanBanner({ plan, badges, footer, className }: { plan: PlanCardData; badges?: ReactNode; footer?: ReactNode; className?: string }) {
  const priceLabel = plan.price_label || (plan.price_cents > 0 ? fmtMoney(plan.price_cents) : 'Sem mensalidade');
  const priceNote = plan.price_label ? plan.price_note : plan.price_cents > 0 ? '/mês' : '';
  const last = plan.features.length - 1;

  return (
    <article className={cn('col-span-full grid gap-8 rounded-[28px] border border-ink/8 bg-cream p-7 sm:p-10 md:grid-cols-[1.45fr_1fr] md:gap-0', className)}>
      <div className="md:pr-10">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.2em] text-sage-700 uppercase">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-sage/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-sage-700" /></span>
            {plan.subtitle || plan.name}
          </p>
          {badges && <div className="flex flex-wrap justify-end gap-1.5">{badges}</div>}
        </div>
        <h2 className="mt-4 font-display text-[clamp(2rem,3.6vw,2.9rem)] leading-[1.08] font-medium tracking-[-0.01em] text-ink">{plan.headline || plan.name}</h2>
        {plan.description && <p className="mt-6 max-w-[58ch] text-[16.5px] leading-relaxed text-stone">{plan.description}</p>}
      </div>

      <div className="flex flex-col gap-4 border-ink/10 md:border-l md:pl-10">
        <p className="flex flex-wrap items-baseline gap-x-1">
          <span className="font-display text-[26px] leading-tight font-medium text-ink">{priceLabel}</span>
          {priceNote && <span className="font-display text-[20px] font-medium text-ink">{priceNote}</span>}
        </p>
        {plan.features.map((f, i) => (
          <p key={i} className={cn('text-[14px] leading-relaxed', i === 0 && last > 0 ? 'text-stone-light' : i === last && last > 1 ? 'text-sage-700' : 'text-stone')}>{f}</p>
        ))}
        {plan.tiers.length > 0 && (
          <div className="border-t border-ink/8">
            {plan.tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink/8 py-3 text-[13.5px]">
                <span className="text-stone">{t.label}</span>
                <span className="text-[12.5px] font-semibold text-ink">{t.benefit}</span>
              </div>
            ))}
            {plan.tiers_note && <p className="mt-3 text-[13px] text-stone-light">{plan.tiers_note}</p>}
          </div>
        )}
        {footer && <div className="mt-1">{footer}</div>}
      </div>
    </article>
  );
}

interface PlanCardData extends PlanShowcase {
  name: string;
  description: string;
  included_minutes: number;
  unlimited: boolean;
  room_discount_percent: number;
  price_cents: number;
}

/**
 * Cartão do plano, igual ao do site: ícone, nome, subtítulo, descrição, preço em destaque,
 * lista de benefícios e (quando houver) a tabela de descontos. `badges` e `footer` ficam por conta de quem usa.
 */
export function PlanCard({ plan, badges, footer, className }: { plan: PlanCardData; badges?: ReactNode; footer?: ReactNode; className?: string }) {
  if (plan.layout === 'banner') return <PlanBanner plan={plan} badges={badges} footer={footer} className={className} />;
  const dark = plan.featured;
  const priceLabel = plan.price_label || (plan.price_cents > 0 ? fmtMoney(plan.price_cents) : 'Sem mensalidade');
  const priceNote = plan.price_label ? plan.price_note : plan.price_cents > 0 ? '/mês' : '';

  // Sem benefícios cadastrados, mostra o resumo automático das regras do plano.
  const fallback = [
    plan.unlimited ? 'Salas ilimitadas' : plan.included_minutes ? `${fmtDuration(plan.included_minutes)} de sala por mês` : 'Sem horas incluídas',
    ...(plan.room_discount_percent > 0 ? [`${plan.room_discount_percent}% off nas horas extras`] : []),
  ];
  const features = plan.features.length ? plan.features : fallback;

  return (
    <article className={cn('flex flex-col rounded-[24px] border p-7', dark ? 'border-sage-700 bg-sage-700 text-cream' : 'border-ink/8 bg-cream text-ink', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', dark ? 'bg-cream/15 text-cream' : 'bg-sage-dim text-sage-700')}>
          <PlanIcon icon={plan.icon} />
        </span>
        {badges && <div className="flex flex-wrap justify-end gap-1.5">{badges}</div>}
      </div>

      <h2 className="mt-5 font-display text-[22px] leading-tight font-medium">{plan.name}</h2>
      {plan.subtitle && <p className={cn('mt-1 text-[14px]', dark ? 'text-cream/70' : 'text-stone-light')}>{plan.subtitle}</p>}
      {plan.description && <p className={cn('mt-4 text-[14px] leading-relaxed', dark ? 'text-cream/85' : 'text-stone')}>{plan.description}</p>}

      <div className={cn('mt-5 border-t pt-5', dark ? 'border-cream/20' : 'border-ink/8')}>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-display text-[28px] leading-tight font-medium">{priceLabel}</span>
          {priceNote && <span className={cn('text-[13px]', dark ? 'text-cream/70' : 'text-stone-light')}>{priceNote}</span>}
        </p>
      </div>

      <ul className="mt-5 flex flex-col gap-3.5">
        {features.map((f, i) => (
          <li key={i} className={cn('flex items-start gap-3 text-[14px] leading-snug', dark ? 'text-cream/90' : 'text-stone')}>
            <span className={cn('mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', dark ? 'bg-cream/15 text-cream' : 'bg-sand text-stone')}>
              {plan.unlimited && !plan.features.length && i === 0 ? <InfinityIcon size={13} /> : <Check size={13} strokeWidth={2.4} />}
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {plan.tiers.length > 0 && (
        <div className={cn('mt-6 border-t', dark ? 'border-cream/20' : 'border-ink/8')}>
          {plan.tiers.map((t, i) => (
            <div key={i} className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-3.5 text-[13.5px]', dark ? 'border-cream/15' : 'border-ink/8')}>
              <span className={dark ? 'text-cream/80' : 'text-stone'}>{t.label}</span>
              <span className="text-[12.5px] font-semibold">{t.benefit}</span>
            </div>
          ))}
          {plan.tiers_note && <p className={cn('mt-3.5 text-[13px]', dark ? 'text-cream/70' : 'text-stone-light')}>{plan.tiers_note}</p>}
        </div>
      )}

      {footer && <div className="mt-auto pt-6">{footer}</div>}
    </article>
  );
}
