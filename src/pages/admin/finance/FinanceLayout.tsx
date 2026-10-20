import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '../../../components/ui/Misc';
import { cn } from '../../../lib/cn';

const tabs = [
  { to: '/admin/financeiro', label: 'Visão geral', end: true },
  { to: '/admin/financeiro/receber', label: 'Contas a receber' },
  { to: '/admin/financeiro/pagar', label: 'Contas a pagar' },
  { to: '/admin/financeiro/fluxo', label: 'Fluxo de caixa' },
  { to: '/admin/financeiro/online', label: 'Pagamentos online' },
];

export default function FinanceLayout() {
  return (
    <>
      <PageHeader eyebrow="Gestão" title="Financeiro" description="Quanto entrou, quanto saiu, o que falta receber e o que falta pagar." />
      <nav aria-label="Seções do financeiro" className="mb-6 -mx-1 overflow-x-auto px-1 pb-1">
        <ul className="inline-flex rounded-full border border-ink/10 bg-cream p-1">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'block rounded-full px-4 py-2 text-[13px] font-semibold whitespace-nowrap no-underline transition-colors duration-300',
                    isActive ? 'bg-sage-700 text-cream' : 'text-stone hover:text-ink',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
