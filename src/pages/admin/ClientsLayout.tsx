import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';

/** Clientes e, como subseção, os perfis que definem o acesso de cada usuário ao painel. */
export default function ClientsLayout() {
  const { can } = useAuth();
  const tabs = [
    { to: '/admin/clientes', label: 'Clientes', end: true, show: can('clients') },
    { to: '/admin/clientes/contratos', label: 'Contratos', end: false, show: can('clients') },
    { to: '/admin/clientes/convidados', label: 'Convidados', end: false, show: can('clients') },
    { to: '/admin/clientes/perfis', label: 'Perfis de usuário', end: false, show: can('profiles') },
  ].filter((t) => t.show);

  return (
    <>
      {tabs.length > 1 && (
        <nav aria-label="Seções de clientes" className="mb-6 -mx-1 overflow-x-auto px-1 pb-1">
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
      )}
      <Outlet />
    </>
  );
}
