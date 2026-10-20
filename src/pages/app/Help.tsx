import { useState } from 'react';
import { ChevronDown, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Card, PageHeader } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';

export default function Help() {
  const { settings: s } = useAuth();
  const [open, setOpen] = useState<number | null>(0);

  const faqs = [
    { q: 'Como reservo uma sala?', a: 'Em “Reservar sala”, escolha o dia no calendário e clique em um horário livre. Ajuste o término, confirme e pronto — você recebe a confirmação por e-mail.' },
    { q: 'Posso cancelar ou alterar uma reserva?', a: `Sim. Em “Minhas reservas” você pode alterar ou cancelar até ${s?.cancel_min_hours ?? 2}h antes do início. Depois disso, fale com a recepção.` },
    { q: 'Como funcionam as horas do meu plano?', a: 'Cada plano inclui uma cota mensal de horas de sala. Elas são descontadas automaticamente nas suas reservas; o que passar da cota é cobrado pelo valor da sala (com o desconto do seu plano, se houver).' },
    { q: 'Posso reservar toda semana no mesmo horário?', a: 'Pode. Ao reservar, escolha “Repetição” e defina por quantas semanas. Se alguma data estiver ocupada, você escolhe se ela é ignorada.' },
    { q: 'Quanto tempo de antecedência preciso?', a: `As reservas exigem ${s && s.min_notice_minutes >= 60 ? `${Math.round(s.min_notice_minutes / 60)}h` : `${s?.min_notice_minutes ?? 60} minutos`} de antecedência e podem ser feitas com até ${s?.max_advance_days ?? 60} dias de antecedência.` },
    { q: 'Esqueci minha senha. E agora?', a: 'Na tela de login, clique em “Esqueceu sua senha?”. Enviaremos um link para você criar uma nova.' },
  ];

  const whatsapp = s?.business_whatsapp?.replace(/\D/g, '');

  return (
    <>
      <PageHeader eyebrow="Suporte" title="Ajuda" description="Respostas rápidas e os melhores jeitos de falar com a gente." />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-3">
          {faqs.map((f, i) => (
            <div key={f.q} className="overflow-hidden rounded-[20px] border border-ink/8 bg-cream">
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left">
                <span className="font-display text-[17px] font-medium text-ink">{f.q}</span>
                <ChevronDown size={18} className={cn('shrink-0 text-stone transition-transform duration-300', open === i && 'rotate-180')} />
              </button>
              <div className={cn('grid transition-all duration-300', open === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <p className="overflow-hidden px-6 text-[14px] leading-[1.75] text-stone"><span className="block pb-5">{f.a}</span></p>
              </div>
            </div>
          ))}
        </div>

        <Card className="bg-sage-900 text-cream">
          <h2 className="font-display text-[22px] font-medium">Fale com a recepção</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-cream/70">Estamos por aqui para ajudar com reservas, planos e dúvidas.</p>
          <ul className="mt-6 flex flex-col gap-4 text-[14px]">
            {whatsapp && (
              <li><a className="flex items-center gap-3 text-cream no-underline hover:text-sage-light" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} className="text-sage-light" />WhatsApp</a></li>
            )}
            {s?.business_phone && <li><a className="flex items-center gap-3 text-cream no-underline hover:text-sage-light" href={`tel:${s.business_phone}`}><Phone size={18} className="text-sage-light" />{s.business_phone}</a></li>}
            {s?.business_email && <li><a className="flex items-center gap-3 text-cream no-underline hover:text-sage-light" href={`mailto:${s.business_email}`}><Mail size={18} className="text-sage-light" />{s.business_email}</a></li>}
            {s?.business_address && <li className="flex items-start gap-3 text-cream/80"><MapPin size={18} className="mt-0.5 shrink-0 text-sage-light" />{s.business_address}</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
