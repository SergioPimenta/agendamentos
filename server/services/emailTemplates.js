import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { emailTemplate, escapeHtml, sendMail } from '../utils/mailer.js';
import { nowStamp } from '../utils/time.js';
import { getSettings } from './settings.js';

/**
 * Catálogo dos e-mails que o sistema dispara. Os textos aqui são o PADRÃO; a administração pode
 * sobrescrever assunto, título, texto e botão (tabela `email_templates`) e desligar o envio.
 * O que não é texto livre (tabela de detalhes da reserva, link do botão) continua vindo do código.
 *
 * Para criar um novo e-mail: adicione uma entrada aqui e dispare com `sendTemplated(key, …)`.
 */

const COMMON_VARS = [
  { name: 'empresa', label: 'Nome do espaço' },
  { name: 'endereco', label: 'Endereço do espaço' },
  { name: 'telefone', label: 'Telefone do espaço' },
  { name: 'whatsapp', label: 'WhatsApp do espaço' },
];

const PERSON_VARS = [
  { name: 'nome', label: 'Primeiro nome do cliente' },
  { name: 'nome_completo', label: 'Nome completo do cliente' },
  { name: 'email', label: 'E-mail do cliente' },
];

const BOOKING_VARS = [
  { name: 'sala', label: 'Nome da sala' },
  { name: 'data', label: 'Data da reserva' },
  { name: 'horario_inicio', label: 'Horário de início' },
  { name: 'horario_fim', label: 'Horário de término' },
  { name: 'horario', label: 'Horário (início às fim)' },
  { name: 'valor', label: 'Valor da reserva' },
  { name: 'codigo', label: 'Código da reserva' },
];

const HOST_VARS = [
  { name: 'anfitriao', label: 'Nome de quem fez a reserva' },
  { name: 'anfitriao_email', label: 'E-mail de quem fez a reserva' },
  { name: 'sala', label: 'Nome da sala' },
  { name: 'data', label: 'Data da reserva' },
  { name: 'horario_inicio', label: 'Horário de início' },
  { name: 'horario_fim', label: 'Horário de término' },
  { name: 'horario', label: 'Horário (início às fim)' },
  { name: 'titulo', label: 'Título da reserva (pode ficar vazio)' },
  { name: 'recorrencia', label: 'Frase sobre repetição semanal (vazia se for uma vez só)' },
];

const SESSION_VARS = [
  { name: 'entrada', label: 'Hora do check-in' },
  { name: 'saida', label: 'Hora do check-out' },
  { name: 'duracao', label: 'Tempo de uso (ex.: 2h05)' },
  { name: 'excedente_minutos', label: 'Minutos além do horário reservado' },
  { name: 'excedente_valor', label: 'Valor do excedente (vazio se não houver)' },
  { name: 'aviso_excedente', label: 'Frase pronta sobre o excedente (vazia se não houver)' },
];

export const TEMPLATES = [
  {
    key: 'welcome',
    group: 'Conta',
    name: 'Boas-vindas',
    description: 'Enviado quando o cliente conclui o cadastro.',
    recipient: 'Cliente',
    variables: [...PERSON_VARS],
    ctaPath: '/app/reservar',
    defaults: {
      subject: 'Bem-vindo(a) ao {{empresa}}, {{nome}}!',
      title: 'Boas-vindas',
      body:
        'Olá, {{nome}}! Sua conta foi criada com sucesso. Agora você pode reservar salas, acompanhar seu consumo e gerenciar suas reservas quando quiser.\n\nQualquer dúvida, é só falar com a gente: {{telefone}}.',
      cta_label: 'Reservar uma sala',
    },
  },
  {
    key: 'password_reset',
    group: 'Conta',
    name: 'Redefinição de senha',
    description: 'Enviado quando o cliente pede para criar uma nova senha. Não pode ser desligado.',
    recipient: 'Cliente',
    locked: true,
    variables: [{ name: 'nome', label: 'Primeiro nome do cliente' }, { name: 'link', label: 'Link para criar a nova senha' }],
    ctaPath: '/redefinir-senha?token=EXEMPLO',
    defaults: {
      subject: 'Redefinir sua senha — {{empresa}}',
      title: 'Redefinir senha',
      body:
        'Olá, {{nome}}. Use o botão abaixo para criar uma nova senha. O link vale por 1 hora. Se não foi você, ignore este e-mail.',
      cta_label: 'Criar nova senha',
    },
  },
  {
    key: 'booking_confirmed',
    group: 'Reservas',
    name: 'Confirmação da reserva',
    description: 'Enviado quando uma reserva é criada já confirmada.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Reserva confirmada — {{sala}}, {{data}}',
      title: 'Reserva confirmada',
      body: 'Olá, {{nome}}! Sua sala está reservada.',
      cta_label: 'Ver minhas reservas',
    },
  },
  {
    key: 'booking_pending',
    group: 'Reservas',
    name: 'Reserva recebida (aguardando aprovação)',
    description: 'Enviado quando a reserva fica pendente, se a aprovação da recepção estiver ligada.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Reserva recebida — {{sala}}, {{data}}',
      title: 'Reserva recebida',
      body: 'Olá, {{nome}}! Recebemos seu pedido e ele será confirmado em breve.',
      cta_label: 'Ver minhas reservas',
    },
  },
  {
    key: 'booking_recurring',
    group: 'Reservas',
    name: 'Confirmação de reserva recorrente',
    description: 'Enviado no lugar da confirmação quando o cliente cria uma reserva que se repete toda semana.',
    recipient: 'Cliente',
    details: true,
    variables: [
      ...PERSON_VARS,
      ...BOOKING_VARS,
      { name: 'quantidade', label: 'Quantidade de reservas criadas' },
      { name: 'situacao', label: '"confirmadas" ou "recebidas (aguardam aprovação)"' },
    ],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Reservas recorrentes {{situacao}} — {{sala}}',
      title: 'Reservas recorrentes',
      body:
        'Olá, {{nome}}! Suas {{quantidade}} reservas recorrentes foram {{situacao}}. A primeira está nos detalhes abaixo.',
      cta_label: 'Ver minhas reservas',
    },
  },
  {
    key: 'booking_approved',
    group: 'Reservas',
    name: 'Reserva aprovada',
    description: 'Enviado quando a recepção aprova uma reserva pendente.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Reserva confirmada — {{sala}}, {{data}}',
      title: 'Reserva confirmada',
      body: 'Olá, {{nome}}! Boas notícias: sua reserva foi aprovada.',
      cta_label: 'Ver minhas reservas',
    },
  },
  {
    key: 'booking_changed',
    group: 'Reservas',
    name: 'Alteração da reserva',
    description: 'Enviado quando data, horário ou sala de uma reserva são alterados.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Reserva atualizada — {{sala}}, {{data}}',
      title: 'Reserva atualizada',
      body: 'Olá, {{nome}}! Sua reserva foi alterada. Confira os novos detalhes:',
      cta_label: 'Ver minhas reservas',
    },
  },
  {
    key: 'booking_cancelled_client',
    group: 'Reservas',
    name: 'Cancelamento pelo cliente',
    description: 'Enviado quando o próprio cliente cancela a reserva.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS, { name: 'motivo', label: 'Motivo informado (pode ficar vazio)' }],
    ctaPath: '/app/reservar',
    defaults: {
      subject: 'Reserva cancelada — {{sala}}, {{data}}',
      title: 'Reserva cancelada',
      body: 'Olá, {{nome}}. Sua reserva foi cancelada conforme solicitado.',
      cta_label: 'Fazer nova reserva',
    },
  },
  {
    key: 'booking_cancelled_admin',
    group: 'Reservas',
    name: 'Cancelamento pela administração',
    description: 'Enviado quando a recepção cancela a reserva de um cliente.',
    recipient: 'Cliente',
    details: true,
    variables: [...PERSON_VARS, ...BOOKING_VARS, { name: 'motivo', label: 'Motivo informado (pode ficar vazio)' }],
    ctaPath: '/app/reservar',
    defaults: {
      subject: 'Reserva cancelada — {{sala}}, {{data}}',
      title: 'Reserva cancelada',
      body: 'Olá, {{nome}}. Sua reserva foi cancelada pela administração. Se tiver dúvidas, fale com a gente: {{telefone}}.',
      cta_label: 'Fazer nova reserva',
    },
  },
  {
    key: 'checkin_confirmed',
    group: 'Uso da sala',
    name: 'Confirmação de check-in',
    description: 'Enviado quando o cliente faz o check-in. Desligado por padrão: o cliente já vê a confirmação na tela.',
    recipient: 'Cliente',
    defaultEnabled: false,
    variables: [...PERSON_VARS, ...BOOKING_VARS.filter((v) => !['valor'].includes(v.name)), { name: 'entrada', label: 'Hora do check-in' }],
    ctaPath: '/app/reservas',
    defaults: {
      subject: 'Check-in feito — {{sala}}',
      title: 'Check-in confirmado',
      body: 'Olá, {{nome}}! Seu check-in na {{sala}} foi registrado às {{entrada}}. Bom trabalho! Ao terminar, faça o check-out pelo sistema ou pelo QR da sala.',
      cta_label: 'Ver minha reserva',
    },
  },
  {
    key: 'checkout_confirmed',
    group: 'Uso da sala',
    name: 'Confirmação de check-out',
    description: 'Enviado quando o uso da sala é encerrado, com o tempo de uso e o excedente, se houver.',
    recipient: 'Cliente',
    variables: [...PERSON_VARS, ...BOOKING_VARS.filter((v) => !['valor'].includes(v.name)), ...SESSION_VARS],
    ctaPath: '/app/consumo',
    defaults: {
      subject: 'Uso encerrado — {{sala}}, {{data}}',
      title: 'Uso encerrado',
      body:
        'Olá, {{nome}}! Seu uso da {{sala}} foi encerrado às {{saida}} (entrada às {{entrada}}, {{duracao}} de uso).\n\n{{aviso_excedente}}\n\nObrigado por usar o espaço!',
      cta_label: 'Ver meu consumo',
    },
  },
  {
    key: 'payment_received',
    group: 'Pagamentos',
    name: 'Pagamento online confirmado',
    description: 'Enviado quando o Pagar.me confirma um pagamento feito pelo cliente (Pix, cartão ou boleto).',
    recipient: 'Cliente',
    variables: [
      ...PERSON_VARS,
      { name: 'descricao', label: 'O que foi pago (ex.: Fatura de 10/2026)' },
      { name: 'valor_pago', label: 'Valor pago' },
      { name: 'forma', label: 'Forma de pagamento (Pix, Cartão, Boleto)' },
    ],
    ctaPath: '/app/consumo',
    defaults: {
      subject: 'Pagamento confirmado — {{descricao}}',
      title: 'Pagamento confirmado',
      body: 'Olá, {{nome}}! Recebemos o seu pagamento de {{valor_pago}} ({{forma}}) referente a {{descricao}}. Obrigado!',
      cta_label: 'Ver meu consumo',
    },
  },
  {
    key: 'guest_invite',
    group: 'Convidados',
    name: 'Convite de reserva (convidado)',
    description: 'Enviado às pessoas convidadas quando a reserva é confirmada, com o evento para salvar no calendário.',
    recipient: 'Convidado',
    details: true,
    variables: [...HOST_VARS],
    defaults: {
      subject: 'Você foi convidado(a) — {{sala}}, {{data}}',
      title: 'Você foi convidado(a)',
      body: 'Olá! {{anfitriao}} convidou você para um encontro no {{empresa}}.\n\nConfira os detalhes abaixo e salve o evento no seu calendário pelo arquivo em anexo.\n\n{{recorrencia}}',
      cta_label: '',
    },
  },
  {
    key: 'guest_changed',
    group: 'Convidados',
    name: 'Alteração da reserva (convidado)',
    description: 'Enviado aos convidados quando a data, o horário ou a sala da reserva mudam.',
    recipient: 'Convidado',
    details: true,
    variables: [...HOST_VARS],
    defaults: {
      subject: 'Reserva atualizada — {{sala}}, {{data}}',
      title: 'O encontro foi atualizado',
      body: 'Olá! {{anfitriao}} alterou a reserva para a qual você foi convidado(a). Confira os novos detalhes:',
      cta_label: '',
    },
  },
  {
    key: 'guest_cancelled',
    group: 'Convidados',
    name: 'Cancelamento da reserva (convidado)',
    description: 'Enviado aos convidados quando a reserva é cancelada.',
    recipient: 'Convidado',
    details: true,
    variables: [...HOST_VARS],
    defaults: {
      subject: 'Reserva cancelada — {{sala}}, {{data}}',
      title: 'O encontro foi cancelado',
      body: 'Olá! A reserva de {{anfitriao}} para {{data}}, às {{horario_inicio}}, foi cancelada. Você não precisa comparecer.',
      cta_label: '',
    },
  },
  {
    key: 'admin_new_booking',
    group: 'Aviso à administração',
    name: 'Nova reserva (aviso interno)',
    description: 'Enviado ao e-mail de notificação do espaço sempre que um cliente faz uma reserva.',
    recipient: 'Administração',
    details: true,
    variables: [
      ...BOOKING_VARS,
      { name: 'cliente', label: 'Nome do cliente' },
      { name: 'email_cliente', label: 'E-mail do cliente' },
      { name: 'telefone_cliente', label: 'Telefone do cliente' },
    ],
    ctaPath: '/admin/reservas',
    defaults: {
      subject: 'Nova reserva: {{sala}} · {{data}} {{horario_inicio}}',
      title: 'Nova reserva',
      body: '{{cliente}} reservou uma sala.',
      cta_label: '',
    },
  },
];

const BY_KEY = new Map(TEMPLATES.map((t) => [t.key, t]));
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export const FIELD_LIMITS = { subject: 200, title: 160, body: 4000, cta_label: 60 };

export function getDefinition(key) {
  const def = BY_KEY.get(key);
  if (!def) throw new HttpError(404, 'Modelo de e-mail não encontrado.');
  return def;
}

const allowedVars = (def) => [...def.variables, ...COMMON_VARS];

/** Variáveis `{{x}}` usadas no texto que o modelo não conhece. */
export function unknownVariables(def, ...texts) {
  const known = new Set(allowedVars(def).map((v) => v.name));
  const bad = new Set();
  for (const text of texts) for (const m of String(text || '').matchAll(PLACEHOLDER)) if (!known.has(m[1].toLowerCase())) bad.add(m[1]);
  return [...bad];
}

/** Troca `{{variavel}}` pelo valor (variável desconhecida ou sem valor vira vazio). */
const fill = (text, vars, transform = (v) => v) =>
  String(text || '').replace(PLACEHOLDER, (_, name) => transform(String(vars[name.toLowerCase()] ?? '')));

const paragraphs = (text, vars) => escapeHtml(text).replace(PLACEHOLDER, (_, n) => escapeHtml(String(vars[n.toLowerCase()] ?? ''))).replace(/\r?\n/g, '<br>').replace(/(<br>){3,}/g, '<br><br>').replace(/^(<br>)+|(<br>)+$/g, '');

/* ---------- persistência ---------- */

const overrideOf = (rows) => new Map(rows.map((r) => [r.template_key, r]));

const present = (def, row) => {
  const values = {
    subject: row?.subject ?? def.defaults.subject,
    title: row?.title ?? def.defaults.title,
    body: row?.body ?? def.defaults.body,
    cta_label: row?.cta_label ?? def.defaults.cta_label,
  };
  return {
    key: def.key,
    group: def.group,
    name: def.name,
    description: def.description,
    recipient: def.recipient,
    locked: Boolean(def.locked),
    has_details: Boolean(def.details),
    has_button: Boolean(def.ctaPath),
    variables: allowedVars(def),
    defaults: def.defaults,
    values,
    enabled: def.locked ? true : row ? Boolean(Number(row.enabled)) : def.defaultEnabled !== false,
    customized: Boolean(row),
    updated_at: row?.updated_at ?? null,
  };
};

export async function listEmailTemplates() {
  const rows = overrideOf(await db.query('SELECT * FROM email_templates'));
  return TEMPLATES.map((def) => present(def, rows.get(def.key)));
}

export async function getEmailTemplate(key) {
  const def = getDefinition(key);
  return present(def, await db.get('SELECT * FROM email_templates WHERE template_key = ?', [key]));
}

export async function saveEmailTemplate(key, input) {
  const def = getDefinition(key);
  const bad = unknownVariables(def, input.subject, input.title, input.body, input.cta_label);
  if (bad.length) {
    throw new HttpError(
      422,
      `Variável desconhecida: ${bad.map((b) => `{{${b}}}`).join(', ')}. Use apenas as variáveis listadas ao lado do texto.`,
    );
  }
  if (!def.ctaPath && input.cta_label) throw new HttpError(422, 'Este e-mail não tem botão.');

  const enabled = def.locked ? 1 : input.enabled ? 1 : 0;
  const stamp = nowStamp();
  const has = await db.get('SELECT template_key FROM email_templates WHERE template_key = ?', [key]);
  const params = [input.subject, input.title, input.body, input.cta_label, enabled, stamp];
  if (has) {
    await db.run('UPDATE email_templates SET subject = ?, title = ?, body = ?, cta_label = ?, enabled = ?, updated_at = ? WHERE template_key = ?', [...params, key]);
  } else {
    await db.run('INSERT INTO email_templates (subject, title, body, cta_label, enabled, updated_at, template_key) VALUES (?, ?, ?, ?, ?, ?, ?)', [...params, key]);
  }
  return getEmailTemplate(key);
}

export async function resetEmailTemplate(key) {
  getDefinition(key);
  await db.run('DELETE FROM email_templates WHERE template_key = ?', [key]);
  return getEmailTemplate(key);
}

/* ---------- renderização e envio ---------- */

export async function businessVars() {
  const s = await getSettings();
  return { empresa: s.business_name, endereco: s.business_address, telefone: s.business_phone, whatsapp: s.business_whatsapp };
}

/** Monta assunto, HTML e texto simples. `draft` (opcional) usa textos ainda não salvos (prévia). */
export async function renderEmail(key, { vars = {}, rows = [], ctaUrl, draft } = {}) {
  const def = getDefinition(key);
  const tpl = draft ?? (await getEmailTemplate(key)).values;
  const all = { ...(await businessVars()), ...vars };
  const s = await getSettings();

  const subject = fill(tpl.subject, all).replace(/\s+/g, ' ').trim();
  const title = fill(tpl.title, all);
  const label = def.ctaPath && tpl.cta_label ? fill(tpl.cta_label, all) : '';

  const html = emailTemplate({
    title,
    intro: paragraphs(tpl.body, all),
    rows: def.details ? rows : [],
    cta: label && ctaUrl ? { label, url: ctaUrl } : undefined,
    footer: `${escapeHtml(s.business_name)} · ${escapeHtml(s.business_address)}`,
  });
  const text = `${title}\n\n${fill(tpl.body, all)}${ctaUrl && label ? `\n\n${label}: ${ctaUrl}` : ''}`.replace(/\n{3,}/g, '\n\n');
  return { subject, html, text };
}

/** Envia um e-mail do catálogo (melhor esforço). Respeita o "desligado" da administração. */
export async function sendTemplated(key, { to, vars, rows, ctaUrl, text, attachments }) {
  if (!to) return { success: false, skipped: true };
  const def = getDefinition(key);
  const tpl = await getEmailTemplate(key);
  if (!def.locked && !tpl.enabled) return { success: false, skipped: true, disabled: true };
  const mail = await renderEmail(key, { vars, rows, ctaUrl: ctaUrl ?? `${config.appUrl}${def.ctaPath ?? ''}` });
  return sendMail({ to, subject: mail.subject, html: mail.html, text: text ?? mail.text, attachments });
}

/** Dados de exemplo para prévia e e-mail de teste. */
export function sampleData(key, viewer = {}) {
  const def = getDefinition(key);
  const first = (viewer.name || 'Maria Souza').split(' ')[0];
  const vars = {
    nome: first,
    nome_completo: viewer.name || 'Maria Souza',
    email: viewer.email || 'maria@exemplo.com.br',
    link: `${config.appUrl}/redefinir-senha?token=EXEMPLO`,
    sala: 'Sala Cachoeira',
    data: '15/11/2026',
    horario_inicio: '14:00',
    horario_fim: '16:00',
    horario: '14:00 às 16:00',
    valor: 'R$ 120,00',
    codigo: 'AB3K9Z',
    quantidade: '4',
    anfitriao: 'Maria Souza',
    anfitriao_email: 'maria@exemplo.com.br',
    titulo: 'Reunião de equipe',
    recorrencia: 'Este encontro se repete toda semana (4 vezes).',
    entrada: '14:00',
    saida: '16:12',
    duracao: '2h12',
    excedente_minutos: '12',
    excedente_valor: 'R$ 11,00',
    aviso_excedente: 'Você ficou 12 min além do horário reservado. Excedente: R$ 11,00 (cobrado por minuto).',
    situacao: 'confirmadas',
    motivo: '',
    cliente: viewer.name || 'Maria Souza',
    email_cliente: viewer.email || 'maria@exemplo.com.br',
    telefone_cliente: '(41) 99999-0000',
  };
  const rows = [['Sala', vars.sala], ['Data', vars.data], ['Horário', vars.horario], ['Valor', vars.valor], ['Código', vars.codigo]];
  return { vars, rows, ctaUrl: def.ctaPath ? `${config.appUrl}${def.ctaPath}` : undefined };
}
