import { Link, NavLink, Outlet } from 'react-router-dom';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';
import { BrandLogo } from '../brand/brand';
import { InstallAppButton } from '../pwa/InstallApp';
import { buttonClass } from '../ui/Button';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-full px-4 py-2 text-[13.5px] font-semibold no-underline transition-colors', isActive ? 'bg-sage-dim text-sage-700' : 'text-stone hover:text-ink');

/** Cabeçalho e rodapé das páginas públicas (sem login): salas e horários. */
export function PublicShell() {
  const { settings } = useAuth();
  const whats = settings?.business_whatsapp?.replace(/\D/g, '');

  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <header className="border-b border-ink/8 bg-sand/90 backdrop-blur">
        <div className="page-px mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
          <BrandLogo size="xs" />
          <nav aria-label="Principal" className="order-3 flex w-full items-center justify-center gap-1 sm:order-none sm:w-auto">
            <NavLink to="/" end className={linkClass}>Salas</NavLink>
            <NavLink to="/reservar" className={linkClass}>Horários</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <InstallAppButton variant="soft" />
            <Link to="/login" className={buttonClass('ghost', 'sm')}>Entrar</Link>
            {settings?.allow_signup !== false && <Link to="/cadastro" className={buttonClass('primary', 'sm')}>Criar conta</Link>}
          </div>
        </div>
      </header>

      <main className="page-px mx-auto w-full max-w-[1280px] flex-1 py-8 lg:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-ink/8 bg-sage-900 text-cream">
        <div className="page-px mx-auto grid max-w-[1280px] gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-display text-[22px] font-medium">{settings?.business_name ?? 'harmonizeoser'}</p>
            <p className="mt-2 max-w-[38ch] text-[13.5px] leading-relaxed text-cream/65">Salas para atender, criar e harmonizar. Reserve online, com confirmação na hora.</p>
          </div>
          <ul className="flex flex-col gap-3 text-[13.5px] text-cream/75">
            {settings?.business_address && <li className="flex items-start gap-2.5"><MapPin size={16} className="mt-0.5 shrink-0 text-sage-light" />{settings.business_address}</li>}
            {settings?.business_phone && <li className="flex items-center gap-2.5"><Phone size={16} className="shrink-0 text-sage-light" />{settings.business_phone}</li>}
            {settings?.business_email && <li className="flex items-center gap-2.5"><Mail size={16} className="shrink-0 text-sage-light" /><a href={`mailto:${settings.business_email}`} className="text-cream/75 no-underline hover:text-cream">{settings.business_email}</a></li>}
          </ul>
          <ul className="flex flex-col gap-3 text-[13.5px]">
            {whats && <li><a href={`https://wa.me/${whats}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 text-cream/75 no-underline hover:text-cream"><MessageCircle size={16} className="text-sage-light" />Falar no WhatsApp</a></li>}
            <li><Link to="/reservar" className="text-cream/75 no-underline hover:text-cream">Ver horários disponíveis</Link></li>
            <li><Link to="/login" className="text-cream/75 no-underline hover:text-cream">Já sou cliente · Entrar</Link></li>
            <li><InstallAppButton variant="outline-light" label="Baixar o app no celular" /></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
