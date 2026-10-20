/**
 * Perfis de acesso do painel administrativo.
 * Cada perfil define, por módulo, um nível: 'none' (sem acesso), 'view' (só consulta) ou 'edit' (consulta e altera).
 */
export const LEVELS = ['none', 'view', 'edit'];
const RANK = { none: 0, view: 1, edit: 2 };

export const MODULES = [
  { key: 'dashboard', label: 'Painel', description: 'Resumo do dia, indicadores e salas ao vivo.' },
  { key: 'agenda', label: 'Agenda', description: 'Calendário de reservas e bloqueios por sala.' },
  { key: 'bookings', label: 'Reservas', description: 'Lista de reservas, aprovação, cobrança e exportação.' },
  { key: 'clients', label: 'Clientes', description: 'Cadastro de clientes, faturas e histórico.' },
  { key: 'birthdays', label: 'Aniversariantes', description: 'Aniversariantes do mês, com base na data de nascimento dos clientes.' },
  { key: 'rooms', label: 'Salas', description: 'Cadastro das salas, preços e fotos.' },
  { key: 'plans', label: 'Planos', description: 'Planos, horas incluídas e descontos.' },
  { key: 'blocks', label: 'Bloqueios', description: 'Bloqueio de horários e salas.' },
  { key: 'finance', label: 'Financeiro', description: 'Contas a pagar e receber, fluxo de caixa e pagamentos online.' },
  { key: 'reports', label: 'Relatórios', description: 'Relatórios de ocupação e receita.' },
  { key: 'qrcodes', label: 'QR das salas', description: 'QR codes de check-in das salas.' },
  { key: 'email_templates', label: 'Modelos de e-mail', description: 'Textos dos e-mails enviados pelo sistema.' },
  { key: 'settings', label: 'Configurações', description: 'Regras de reserva, horários e pagamentos.' },
  { key: 'profiles', label: 'Perfis de usuário', description: 'Criar perfis e definir o acesso de cada usuário ao painel.' },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

const all = (level) => Object.fromEntries(MODULE_KEYS.map((k) => [k, level]));

export const fullAccess = () => all('edit');
export const noAccess = () => all('none');

/** Mantém só módulos e níveis conhecidos; o que faltar vira 'none'. */
export function normalizePermissions(input) {
  const out = noAccess();
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  for (const key of MODULE_KEYS) {
    const level = raw?.[key];
    if (LEVELS.includes(level)) out[key] = level;
  }
  return out;
}

/** Permissões efetivas de um usuário já carregado (com `role` e `profile_permissions`). */
export function permissionsFor(user) {
  if (!user || user.role !== 'admin') return noAccess();
  // Administrador sem perfil (contas antigas) mantém o acesso total.
  if (!user.profile_permissions || Number(user.profile_is_system)) return fullAccess();
  return normalizePermissions(user.profile_permissions);
}

/** Algum dos módulos citados atinge o nível pedido? */
export function hasAccess(permissions, modules, level = 'view') {
  const list = Array.isArray(modules) ? modules : [modules];
  return list.some((m) => (RANK[permissions?.[m]] ?? 0) >= RANK[level]);
}

/** Pelo menos um módulo liberado = pode entrar no painel. */
export const canEnterPanel = (permissions) => MODULE_KEYS.some((k) => (RANK[permissions?.[k]] ?? 0) > 0);

/** Perfis criados na instalação. O "Administrador" é fixo; os demais podem ser editados ou excluídos. */
export const DEFAULT_PROFILES = [
  {
    name: 'Administrador',
    description: 'Acesso total ao painel, inclusive a perfis de usuário.',
    is_system: 1,
    permissions: fullAccess(),
  },
  {
    name: 'Recepção',
    description: 'Cuida da agenda, das reservas e dos clientes no dia a dia.',
    is_system: 0,
    permissions: {
      ...noAccess(), dashboard: 'view', agenda: 'edit', bookings: 'edit', clients: 'edit', birthdays: 'view', rooms: 'view', plans: 'view', blocks: 'edit', qrcodes: 'view',
    },
  },
  {
    name: 'Financeiro',
    description: 'Acompanha cobranças, contas e relatórios.',
    is_system: 0,
    permissions: {
      ...noAccess(), dashboard: 'view', bookings: 'view', clients: 'view', plans: 'view', finance: 'edit', reports: 'view',
    },
  },
  {
    name: 'Somente consulta',
    description: 'Vê as informações, mas não altera nada.',
    is_system: 0,
    permissions: { ...all('view'), settings: 'none', profiles: 'none', email_templates: 'none' },
  },
];
