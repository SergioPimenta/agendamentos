import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Cake, CalendarCheck, CalendarDays, CalendarPlus, DoorOpen, LayoutDashboard, LifeBuoy, LogOut, Menu,
  Hourglass, Mail, Package, QrCode, Receipt, Settings, Wallet, ShieldBan, Tags, UserRound, Users, X, ClipboardList, Leaf,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';
import { BrandLogo } from '../brand/brand';
import { CanopyMotif } from '../brand/harmonizeUi';
import type { ModuleKey } from '../../types';
import { InstallAppButton } from '../pwa/InstallApp';
import { Avatar } from '../ui/Misc';

/** `module`: o item só aparece para quem tem acesso (ao menos de consulta) a uma dessas áreas. */
interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; module?: ModuleKey | ModuleKey[] }

const clientNav: NavItem[] = [
  { to: '/app', label: 'Início', icon: <Leaf size={18} />, end: true },
  { to: '/app/reservar', label: 'Reservar sala', icon: <CalendarPlus size={18} /> },
  { to: '/app/reservas', label: 'Minhas reservas', icon: <CalendarCheck size={18} /> },
  { to: '/app/salas', label: 'Salas', icon: <DoorOpen size={18} /> },
  { to: '/app/planos', label: 'Planos e pacotes', icon: <Tags size={18} /> },
  { to: '/app/consumo', label: 'Consumo e faturas', icon: <Receipt size={18} /> },
  { to: '/app/perfil', label: 'Meu perfil', icon: <UserRound size={18} /> },
  { to: '/app/ajuda', label: 'Ajuda', icon: <LifeBuoy size={18} /> },
];

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Painel', icon: <LayoutDashboard size={18} />, end: true, module: 'dashboard' },
  { to: '/admin/agenda', label: 'Agenda', icon: <CalendarDays size={18} />, module: 'agenda' },
  { to: '/admin/reservas', label: 'Reservas', icon: <ClipboardList size={18} />, module: 'bookings' },
  { to: '/admin/clientes', label: 'Clientes', icon: <Users size={18} />, module: ['clients', 'profiles'] },
  { to: '/admin/aniversariantes', label: 'Aniversariantes', icon: <Cake size={18} />, module: 'birthdays' },
  { to: '/admin/salas', label: 'Salas', icon: <DoorOpen size={18} />, module: 'rooms' },
  { to: '/admin/planos', label: 'Planos', icon: <Tags size={18} />, module: 'plans' },
  { to: '/admin/pacotes', label: 'Pacotes de horas', icon: <Package size={18} />, module: 'packages' },
  { to: '/admin/banco-de-horas', label: 'Banco de horas', icon: <Hourglass size={18} />, module: 'hour_bank' },
  { to: '/admin/bloqueios', label: 'Bloqueios', icon: <ShieldBan size={18} />, module: 'blocks' },
  { to: '/admin/financeiro', label: 'Financeiro', icon: <Wallet size={18} />, module: 'finance' },
  { to: '/admin/relatorios', label: 'Relatórios', icon: <BarChart3 size={18} />, module: 'reports' },
  { to: '/admin/qr-codes', label: 'QR das salas', icon: <QrCode size={18} />, module: 'qrcodes' },
  { to: '/admin/modelos-de-email', label: 'Modelos de e-mail', icon: <Mail size={18} />, module: 'email_templates' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: <Settings size={18} />, module: 'settings' },
];

export function AppShell({ variant }: { variant: 'client' | 'admin' }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const items = variant === 'admin'
    ? adminNav.filter((i) => !i.module || [i.module].flat().some((m) => can(m)))
    : clientNav;

  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-sage-900 text-cream">
      <CanopyMotif muted className="-bottom-24 -left-28 h-[320px] w-[320px] opacity-[0.12] [&_span]:bg-cream" />

      <div className="relative z-10 flex items-center justify-between px-6 pt-7 pb-6">
        <BrandLogo dark size="md" to={variant === 'admin' ? '/admin' : '/app'} />
        <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="rounded-full p-2 text-cream/70 hover:bg-cream/10 lg:hidden">
          <X size={20} />
        </button>
      </div>

      {variant === 'admin' && (
        <div className="relative z-10 mx-6 mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-cream/10 px-3 py-1 text-[10.5px] font-semibold tracking-[0.18em] text-sage-light uppercase">
          Administração
        </div>
      )}

      <nav className="scroll-sage-dark relative z-10 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-gutter:stable]" aria-label="Menu principal">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13.5px] font-medium no-underline transition-all duration-200',
                    isActive ? 'bg-cream/12 text-cream' : 'text-cream/65 hover:bg-cream/7 hover:text-cream',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-sage-light transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                    <span className={cn('transition-colors', isActive ? 'text-sage-light' : 'text-cream/55 group-hover:text-cream/85')}>{item.icon}</span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="relative z-10 border-t border-cream/10 p-4">
        {user?.role === 'admin' && (
          <NavLink
            to={variant === 'admin' ? '/app' : '/admin'}
            className="mb-3 block rounded-xl px-4 py-2 text-[12.5px] font-medium text-cream/60 no-underline transition-colors hover:bg-cream/7 hover:text-cream"
          >
            {variant === 'admin' ? 'Ver área do cliente' : 'Voltar à administração'}
          </NavLink>
        )}
        <InstallAppButton variant="outline-light" className="mb-3 w-full" />
        <div className="flex items-center gap-3 rounded-2xl bg-cream/8 p-3">
          <Avatar name={user?.name ?? ''} src={user?.avatar} size={38} className="bg-sage-light text-sage-900" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-cream">{user?.name}</p>
            <p className="truncate text-[11.5px] text-cream/55">{user?.plan?.name ?? (user?.role === 'admin' ? (user.profile_name ?? 'Administrador') : user?.email)}</p>
          </div>
          <button
            type="button"
            aria-label="Sair"
            title="Sair"
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="rounded-full p-2 text-cream/60 transition-colors hover:bg-cream/12 hover:text-cream"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sand">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] lg:block print:hidden">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-[150] lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-sage-900/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="animate-fade-in absolute inset-y-0 left-0 w-[288px] max-w-[85vw]">{sidebar}</aside>
        </div>
      )}

      <div className="min-w-0 overflow-x-clip lg:pl-[264px] print:pl-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink/8 bg-sand/85 px-4 py-3 backdrop-blur-xl lg:hidden print:hidden">
          <BrandLogo size="md" to={variant === 'admin' ? '/admin' : '/app'} />
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-cream">
            <Menu size={20} />
          </button>
        </header>
        <main className="page-px mx-auto max-w-[1280px] py-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
