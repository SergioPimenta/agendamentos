import { Link } from 'react-router-dom';
import { ArrowRight, CalendarSearch, DoorOpen, LogIn } from 'lucide-react';
import { RoomCard } from '../../components/booking/RoomCard';
import { CanopyMotif } from '../../components/brand/harmonizeUi';
import { LinkButton } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Card } from '../../components/ui/Misc';
import { useBookingMeta } from '../../hooks/useBookingMeta';
import { WEEKDAYS } from '../../lib/format';

const steps = [
  { icon: <CalendarSearch size={22} />, title: 'Escolha a sala e o horário', text: 'Veja a agenda de cada sala em tempo real, sem precisar de cadastro.' },
  { icon: <LogIn size={22} />, title: 'Entre para confirmar', text: 'Na hora de reservar, você entra na sua conta (ou cria uma em um minuto). O horário escolhido fica guardado.' },
  { icon: <DoorOpen size={22} />, title: 'Chegue e faça o check-in', text: 'No dia, escaneie o QR code da porta da sala. Ao sair, encerre o uso do mesmo jeito.' },
];

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function PublicHome() {
  const { meta, loading, error } = useBookingMeta();

  return (
    <>
      <section className="animate-fade-up relative mb-10 overflow-hidden rounded-[28px] bg-sage-900 p-7 text-cream sm:p-12">
        <CanopyMotif className="-top-20 -right-16 h-[380px] w-[380px] opacity-80 [&_span]:bg-cream/10" />
        <div className="relative z-10 max-w-[600px]">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-sage-light uppercase">Coworking integrativo · Batel, Curitiba</p>
          <h1 className="font-display text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.05] font-medium tracking-[-0.02em]">
            Salas para atender, criar e <em className="font-normal not-italic text-sage-light">harmonizar</em>.
          </h1>
          <p className="mt-5 max-w-[48ch] text-[15.5px] leading-relaxed text-cream/75">Conheça as salas, veja os horários livres e reserve online. Confirmação na hora, sem burocracia.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton to="/reservar" variant="light" size="lg">Ver horários livres <ArrowRight size={16} /></LinkButton>
            <a href="#salas" className="inline-flex items-center justify-center gap-2 rounded-full border border-cream/30 px-8 py-3.5 text-[14px] font-semibold text-cream no-underline transition-colors hover:border-cream/70 hover:bg-cream/10">Conhecer as salas</a>
          </div>
        </div>
      </section>

      <section id="salas" className="scroll-mt-6">
        <div className="mb-6">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-sage-700 uppercase">Espaços</p>
          <h2 className="mt-2 font-display text-[clamp(1.7rem,3vw,2.4rem)] leading-tight font-medium tracking-[-0.015em] text-ink">Nossas salas</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-stone">Cada sala foi pensada para acolher bem o seu trabalho. Toque em uma para ver fotos, valores e reservar.</p>
        </div>
        {error && <ErrorState message={error} />}
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {loading && !meta
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] rounded-[26px]" />)
            : meta?.rooms.map((room, i) => <RoomCard key={room.id} room={room} to={`/salas/${room.slug}`} index={i} />)}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="mb-6 font-display text-[clamp(1.5rem,2.6vw,2rem)] leading-tight font-medium text-ink">Como funciona</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-[22px] border border-ink/8 bg-cream p-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage-dim text-sage-700">{s.icon}</span>
              <p className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-stone-light uppercase">Passo {i + 1}</p>
              <h3 className="mt-1 font-display text-[18px] font-medium text-ink">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-stone">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {meta && (
        <section className="mt-14 grid items-start gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <h2 className="mb-4 font-display text-[19px] font-medium text-ink">Horário de funcionamento</h2>
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {WEEK_ORDER.map((d) => {
                const h = meta.hours.find((x) => x.weekday === d);
                return (
                  <li key={d} className="flex items-center justify-between gap-4 border-b border-ink/6 py-2 text-[13.5px] last:border-0">
                    <span className="text-stone">{WEEKDAYS[d]}</span>
                    <span className={h?.is_open ? 'font-medium text-ink' : 'text-stone-light'}>{h?.is_open ? `${h.open_time} às ${h.close_time}` : 'Fechado'}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card className="flex flex-col items-start gap-4">
            <h2 className="font-display text-[19px] font-medium text-ink">Pronto para reservar?</h2>
            <p className="text-[14px] leading-relaxed text-stone">Veja os horários livres de todas as salas e escolha o seu. Você só precisa entrar na sua conta para confirmar.</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton to="/reservar">Ver horários livres</LinkButton>
              <Link to="/login" className="inline-flex items-center rounded-full border border-ink/15 px-6 py-3 text-[13.5px] font-semibold text-ink no-underline transition-colors hover:border-sage-700 hover:bg-sage-dim">Já sou cliente</Link>
            </div>
          </Card>
        </section>
      )}
    </>
  );
}
