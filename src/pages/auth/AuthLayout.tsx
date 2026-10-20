import type { ReactNode } from 'react';
import { CalendarCheck, Clock, Leaf } from 'lucide-react';
import { BrandLogo } from '../../components/brand/brand';
import { CanopyMotif } from '../../components/brand/harmonizeUi';

const perks = [
  { icon: <CalendarCheck size={18} />, text: 'Reserve em poucos cliques, a qualquer hora' },
  { icon: <Clock size={18} />, text: 'Veja a disponibilidade de todas as salas em tempo real' },
  { icon: <Leaf size={18} />, text: 'Acompanhe seu consumo e suas faturas' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-sand lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sage-900 p-14 text-cream lg:flex lg:flex-col lg:justify-between xl:p-20">
        <CanopyMotif className="-top-28 -right-24 h-[460px] w-[460px] opacity-60 [&_span]:bg-cream/10" />
        <CanopyMotif className="-bottom-32 -left-28 h-[400px] w-[400px] opacity-60 [&_span]:bg-sage/20" />

        <BrandLogo dark size="lg" className="relative z-10 self-start" />

        <div className="relative z-10 max-w-[480px]">
          <div className="mb-6 inline-flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.22em] text-sage-light uppercase before:block before:h-px before:w-7 before:bg-sage-light before:content-['']">
            Agendamento de salas
          </div>
          <h2 className="font-display text-[clamp(2.2rem,3.6vw,3.3rem)] leading-[1.06] font-medium tracking-[-0.02em]">
            Um espaço para <em className="font-normal not-italic text-sage-light">harmonizar</em> seu atendimento.
          </h2>
          <ul className="mt-10 flex flex-col gap-4">
            {perks.map((p) => (
              <li key={p.text} className="flex items-center gap-3.5 text-[14.5px] text-cream/75">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cream/10 text-sage-light">{p.icon}</span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[12px] text-cream/45">R. Visc. do Rio Branco, 1358 · Batel, Curitiba — PR</p>
      </aside>

      <main className="relative flex items-center justify-center overflow-hidden px-5 py-12 sm:px-10">
        <CanopyMotif muted className="-top-32 -right-28 h-[380px] w-[380px] opacity-60 lg:hidden" />
        <div className="animate-fade-up relative z-10 w-full max-w-[440px]">
          <BrandLogo size="lg" className="mb-6 lg:hidden" />
          <h1 className="font-display text-[clamp(1.9rem,3vw,2.5rem)] leading-[1.08] font-medium tracking-[-0.02em] text-ink">{title}</h1>
          <p className="mt-2.5 mb-8 text-[14.5px] leading-relaxed text-stone">{subtitle}</p>
          {children}
          {footer && <div className="mt-8 text-center text-[13.5px] text-stone">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
