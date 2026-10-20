import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ScrollToTop } from './components/ScrollToTop';
import { AppShell } from './components/layout/AppShell';
import { PageLoader } from './components/ui/Feedback';
import { Button, LinkButton } from './components/ui/Button';
import { useAuth } from './contexts/AuthContext';
import type { ModuleKey } from './types';
import { PublicShell } from './components/layout/PublicShell';
import PublicHome from './pages/public/PublicHome';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import { ForgotPassword, ResetPassword } from './pages/auth/PasswordRecovery';
import ClientHome from './pages/app/ClientHome';
import Reserve from './pages/app/Reserve';
import MyBookings from './pages/app/MyBookings';
import RoomsCatalog from './pages/app/RoomsCatalog';
import Usage from './pages/app/Usage';
import Profile from './pages/app/Profile';
import Help from './pages/app/Help';
import RoomPage from './pages/app/RoomPage';
import RoomSession from './pages/app/RoomSession';

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminAgenda = lazy(() => import('./pages/admin/Agenda'));
const AdminBookings = lazy(() => import('./pages/admin/Bookings'));
const AdminClients = lazy(() => import('./pages/admin/Clients'));
const ClientsLayout = lazy(() => import('./pages/admin/ClientsLayout'));
const AdminProfiles = lazy(() => import('./pages/admin/Profiles'));
const AdminRooms = lazy(() => import('./pages/admin/Rooms'));
const AdminPlans = lazy(() => import('./pages/admin/Plans'));
const AdminBlocks = lazy(() => import('./pages/admin/Blocks'));
const AdminReports = lazy(() => import('./pages/admin/Reports'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminEmailTemplates = lazy(() => import('./pages/admin/EmailTemplates'));
const AdminQrCodes = lazy(() => import('./pages/admin/QrCodes'));
const FinanceLayout = lazy(() => import('./pages/admin/finance/FinanceLayout'));
const FinanceOverview = lazy(() => import('./pages/admin/finance/Overview'));
const FinanceReceivables = lazy(() => import('./pages/admin/finance/Receivables'));
const FinancePayables = lazy(() => import('./pages/admin/finance/Payables'));
const FinanceCashFlow = lazy(() => import('./pages/admin/finance/CashFlow'));
const FinanceOnline = lazy(() => import('./pages/admin/finance/OnlinePayments'));

function RequireAuth({ role }: { role?: 'admin' }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (role && user.role !== role) return <Navigate to="/app" replace />;
  return <Outlet />;
}

/** Primeira tela do painel que cada área libera, na ordem do menu. */
const ADMIN_HOME: [ModuleKey, string][] = [
  ['dashboard', '/admin'], ['agenda', '/admin/agenda'], ['bookings', '/admin/reservas'], ['clients', '/admin/clientes'],
  ['rooms', '/admin/salas'], ['plans', '/admin/planos'], ['blocks', '/admin/bloqueios'], ['finance', '/admin/financeiro'],
  ['reports', '/admin/relatorios'], ['qrcodes', '/admin/qr-codes'], ['email_templates', '/admin/modelos-de-email'],
  ['settings', '/admin/configuracoes'], ['profiles', '/admin/clientes/perfis'],
];

/** Barra quem não tem acesso à área e leva para a primeira tela que o perfil libera. */
function RequireModule({ module }: { module: ModuleKey }) {
  const { can } = useAuth();
  if (can(module)) return <Outlet />;
  const home = ADMIN_HOME.find(([m]) => can(m));
  return <Navigate to={home ? home[1] : '/app'} replace />;
}

/**
 * Páginas públicas (salas e horários, sem login). Quem já está logado é levado para o mesmo conteúdo dentro
 * da área do cliente, mantendo a escolha feita (data e horário vão na URL).
 */
function PublicOnly() {
  const { user } = useAuth();
  const location = useLocation();
  if (user) {
    const target = location.pathname === '/' ? (user.role === 'admin' ? '/admin' : '/app') : `/app${location.pathname}`;
    return <Navigate to={`${target}${location.search}`} replace />;
  }
  return <PublicShell />;
}

const NotFound = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-sand px-6 text-center">
    <p className="font-display text-[72px] leading-none font-medium text-sage-700">404</p>
    <h1 className="font-display text-[26px] font-medium text-ink">Essa página não existe</h1>
    <LinkButton to="/">Voltar ao início</LinkButton>
  </div>
);

export default function App() {
  const { offline, retry, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (offline) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-sand px-6 text-center">
        <h1 className="font-display text-[26px] font-medium text-ink">Sem conexão com o servidor</h1>
        <p className="max-w-[40ch] text-[14px] text-stone">Não conseguimos falar com o sistema agora. Sua sessão continua salva — tente novamente em instantes.</p>
        <Button onClick={retry}>Tentar novamente</Button>
      </div>
    );
  }
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/" element={<PublicHome />} />
            <Route path="/salas" element={<Navigate to="/" replace />} />
            <Route path="/salas/:slug" element={<RoomPage />} />
            <Route path="/reservar" element={<Reserve />} />
          </Route>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Signup />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />

          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppShell variant="client" />}>
              <Route index element={<ClientHome />} />
              <Route path="reservar" element={<Reserve />} />
              <Route path="reservas" element={<MyBookings />} />
              <Route path="salas" element={<RoomsCatalog />} />
              <Route path="salas/:slug" element={<RoomPage />} />
              <Route path="sessao/:slug" element={<RoomSession />} />
              <Route path="consumo" element={<Usage />} />
              <Route path="perfil" element={<Profile />} />
              <Route path="ajuda" element={<Help />} />
            </Route>
          </Route>

          <Route element={<RequireAuth role="admin" />}>
            <Route path="/admin" element={<AppShell variant="admin" />}>
              <Route element={<RequireModule module="dashboard" />}><Route index element={<AdminDashboard />} /></Route>
              <Route element={<RequireModule module="agenda" />}><Route path="agenda" element={<AdminAgenda />} /></Route>
              <Route element={<RequireModule module="bookings" />}><Route path="reservas" element={<AdminBookings />} /></Route>
              <Route path="clientes" element={<ClientsLayout />}>
                <Route element={<RequireModule module="clients" />}><Route index element={<AdminClients />} /></Route>
                <Route element={<RequireModule module="profiles" />}><Route path="perfis" element={<AdminProfiles />} /></Route>
              </Route>
              <Route element={<RequireModule module="rooms" />}><Route path="salas" element={<AdminRooms />} /></Route>
              <Route element={<RequireModule module="plans" />}><Route path="planos" element={<AdminPlans />} /></Route>
              <Route element={<RequireModule module="blocks" />}><Route path="bloqueios" element={<AdminBlocks />} /></Route>
              <Route element={<RequireModule module="finance" />}>
                <Route path="financeiro" element={<FinanceLayout />}>
                  <Route index element={<FinanceOverview />} />
                  <Route path="receber" element={<FinanceReceivables />} />
                  <Route path="pagar" element={<FinancePayables />} />
                  <Route path="fluxo" element={<FinanceCashFlow />} />
                  <Route path="online" element={<FinanceOnline />} />
                </Route>
              </Route>
              <Route element={<RequireModule module="reports" />}><Route path="relatorios" element={<AdminReports />} /></Route>
              <Route element={<RequireModule module="qrcodes" />}><Route path="qr-codes" element={<AdminQrCodes />} /></Route>
              <Route element={<RequireModule module="email_templates" />}><Route path="modelos-de-email" element={<AdminEmailTemplates />} /></Route>
              <Route element={<RequireModule module="settings" />}><Route path="configuracoes" element={<AdminSettings />} /></Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
