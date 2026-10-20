import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config.js';
import { db } from './index.js';
import { nowStamp, addDays, nowLocal, weekdayOf, toMin } from '../utils/time.js';
import { DEFAULT_PROFILES } from '../services/access.js';

const PK = { mysql: 'INT AUTO_INCREMENT PRIMARY KEY', postgres: 'SERIAL PRIMARY KEY', sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT' };
const pk = () => PK[db.dialect];
const tail = () => (db.dialect === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '');

/** Datas e horas são guardadas como texto no horário local de Curitiba (YYYY-MM-DD / HH:MM). */
const migrations = [
  {
    id: '001_initial',
    statements: () => [
      `CREATE TABLE IF NOT EXISTS plans (
        id ${pk()},
        name VARCHAR(80) NOT NULL,
        description VARCHAR(255) NOT NULL DEFAULT '',
        included_minutes INT NOT NULL DEFAULT 0,
        unlimited INT NOT NULL DEFAULT 0,
        room_discount_percent INT NOT NULL DEFAULT 0,
        price_cents INT NOT NULL DEFAULT 0,
        active INT NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS users (
        id ${pk()},
        name VARCHAR(120) NOT NULL,
        email VARCHAR(160) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'client',
        phone VARCHAR(30) NOT NULL DEFAULT '',
        document VARCHAR(20) NOT NULL DEFAULT '',
        company VARCHAR(120) NOT NULL DEFAULT '',
        plan_id INT NULL,
        notes TEXT NULL,
        active INT NOT NULL DEFAULT 1,
        reset_token_hash VARCHAR(64) NULL,
        reset_expires VARCHAR(19) NULL,
        last_login_at VARCHAR(19) NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS rooms (
        id ${pk()},
        name VARCHAR(80) NOT NULL,
        slug VARCHAR(80) NOT NULL UNIQUE,
        tagline VARCHAR(160) NOT NULL DEFAULT '',
        description TEXT NULL,
        capacity INT NOT NULL DEFAULT 2,
        price_cents INT NOT NULL DEFAULT 0,
        image VARCHAR(255) NOT NULL DEFAULT '',
        amenities TEXT NULL,
        min_minutes INT NOT NULL DEFAULT 60,
        max_minutes INT NOT NULL DEFAULT 480,
        buffer_minutes INT NOT NULL DEFAULT 0,
        active INT NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS business_hours (
        weekday INT NOT NULL PRIMARY KEY,
        is_open INT NOT NULL DEFAULT 1,
        open_time VARCHAR(5) NOT NULL DEFAULT '08:00',
        close_time VARCHAR(5) NOT NULL DEFAULT '20:00'
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS blocks (
        id ${pk()},
        room_id INT NULL,
        start_at VARCHAR(16) NOT NULL,
        end_at VARCHAR(16) NOT NULL,
        reason VARCHAR(200) NOT NULL DEFAULT '',
        created_by INT NULL,
        created_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS bookings (
        id ${pk()},
        code VARCHAR(12) NOT NULL UNIQUE,
        room_id INT NOT NULL,
        user_id INT NOT NULL,
        date VARCHAR(10) NOT NULL,
        start_time VARCHAR(5) NOT NULL,
        end_time VARCHAR(5) NOT NULL,
        start_at VARCHAR(16) NOT NULL,
        end_at VARCHAR(16) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
        title VARCHAR(160) NOT NULL DEFAULT '',
        notes TEXT NULL,
        attendees INT NOT NULL DEFAULT 1,
        total_minutes INT NOT NULL,
        included_minutes INT NOT NULL DEFAULT 0,
        price_cents INT NOT NULL DEFAULT 0,
        payment_status VARCHAR(12) NOT NULL DEFAULT 'none',
        series_id VARCHAR(20) NULL,
        created_by INT NULL,
        cancelled_at VARCHAR(19) NULL,
        cancelled_by INT NULL,
        cancel_reason VARCHAR(255) NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(60) NOT NULL PRIMARY KEY,
        v TEXT NOT NULL
      )${tail()}`,
      `CREATE INDEX idx_bookings_room_start ON bookings (room_id, start_at)`,
      `CREATE INDEX idx_bookings_user_date ON bookings (user_id, date)`,
      `CREATE INDEX idx_bookings_date ON bookings (date)`,
      `CREATE INDEX idx_blocks_start ON blocks (start_at)`,
    ],
  },
  {
    // Só guarda o que a administração personalizou; o texto padrão vive em services/emailTemplates.js.
    id: '002_email_templates',
    statements: () => [
      `CREATE TABLE IF NOT EXISTS email_templates (
        template_key VARCHAR(60) NOT NULL PRIMARY KEY,
        subject VARCHAR(200) NOT NULL,
        title VARCHAR(160) NOT NULL,
        body TEXT NOT NULL,
        cta_label VARCHAR(60) NOT NULL DEFAULT '',
        enabled INT NOT NULL DEFAULT 1,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
    ],
  },
  {
    // Check-in / check-out da sala e cobrança de excedente (por minuto).
    id: '003_sessions',
    statements: () => [
      `ALTER TABLE bookings ADD COLUMN checked_in_at VARCHAR(19) NULL`,
      `ALTER TABLE bookings ADD COLUMN check_in_method VARCHAR(10) NULL`,
      `ALTER TABLE bookings ADD COLUMN checked_out_at VARCHAR(19) NULL`,
      `ALTER TABLE bookings ADD COLUMN check_out_method VARCHAR(10) NULL`,
      `ALTER TABLE bookings ADD COLUMN overtime_minutes INT NOT NULL DEFAULT 0`,
      `ALTER TABLE bookings ADD COLUMN overtime_cents INT NOT NULL DEFAULT 0`,
      `ALTER TABLE bookings ADD COLUMN overtime_payment_status VARCHAR(12) NOT NULL DEFAULT 'none'`,
    ],
  },
  {
    // Financeiro: data/forma de pagamento nas reservas, contas a pagar e lançamentos avulsos a receber.
    id: '004_finance',
    statements: () => [
      `ALTER TABLE bookings ADD COLUMN paid_at VARCHAR(19) NULL`,
      `ALTER TABLE bookings ADD COLUMN payment_method VARCHAR(20) NULL`,
      `ALTER TABLE bookings ADD COLUMN overtime_paid_at VARCHAR(19) NULL`,
      `ALTER TABLE bookings ADD COLUMN overtime_payment_method VARCHAR(20) NULL`,
      `UPDATE bookings SET paid_at = updated_at WHERE payment_status = 'paid' AND paid_at IS NULL`,
      `UPDATE bookings SET overtime_paid_at = updated_at WHERE overtime_payment_status = 'paid' AND overtime_paid_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS payables (
        id ${pk()},
        description VARCHAR(160) NOT NULL,
        supplier VARCHAR(120) NOT NULL DEFAULT '',
        category VARCHAR(40) NOT NULL DEFAULT 'Outros',
        amount_cents INT NOT NULL,
        due_date VARCHAR(10) NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        paid_at VARCHAR(19) NULL,
        payment_method VARCHAR(20) NULL,
        notes TEXT NULL,
        series_id VARCHAR(20) NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE TABLE IF NOT EXISTS receivables (
        id ${pk()},
        user_id INT NULL,
        description VARCHAR(160) NOT NULL,
        category VARCHAR(40) NOT NULL DEFAULT 'Outros',
        amount_cents INT NOT NULL,
        due_date VARCHAR(10) NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        paid_at VARCHAR(19) NULL,
        payment_method VARCHAR(20) NULL,
        notes TEXT NULL,
        ref VARCHAR(60) NULL UNIQUE,
        series_id VARCHAR(20) NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE INDEX idx_payables_due ON payables (due_date)`,
      `CREATE INDEX idx_receivables_due ON receivables (due_date)`,
    ],
  },
  {
    // Pagamentos online (Pagar.me): uma linha por cobrança gerada; `items` guarda o que ela quita.
    id: '005_online_payments',
    statements: () => [
      `CREATE TABLE IF NOT EXISTS online_payments (
        id ${pk()},
        user_id INT NOT NULL,
        provider VARCHAR(20) NOT NULL DEFAULT 'pagarme',
        kind VARCHAR(12) NOT NULL,
        description VARCHAR(160) NOT NULL DEFAULT '',
        items TEXT NOT NULL,
        amount_cents INT NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'pending',
        provider_order_id VARCHAR(60) NULL UNIQUE,
        provider_charge_id VARCHAR(60) NULL,
        checkout_url VARCHAR(400) NULL,
        method VARCHAR(20) NULL,
        paid_at VARCHAR(19) NULL,
        expires_at VARCHAR(19) NULL,
        needs_review INT NOT NULL DEFAULT 0,
        note VARCHAR(255) NULL,
        last_event VARCHAR(40) NULL,
        created_by INT NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `CREATE INDEX idx_online_payments_user ON online_payments (user_id)`,
      `CREATE INDEX idx_online_payments_status ON online_payments (status)`,
    ],
  },
  {
    // Pagamento no ato da reserva: o horário fica "segurado" (hold_until) enquanto o cliente paga no popup.
    id: '006_pay_on_booking',
    statements: () => [
      `ALTER TABLE bookings ADD COLUMN hold_until VARCHAR(19) NULL`,
      `ALTER TABLE online_payments ADD COLUMN pix_qr_code TEXT NULL`,
    ],
  },
  {
    // Convidados da reserva (e-mails), avisados quando a reserva é confirmada, alterada ou cancelada.
    id: '007_booking_guests',
    statements: () => [`ALTER TABLE bookings ADD COLUMN guests TEXT NULL`],
  },
  {
    // Perfis de acesso ao painel administrativo (nível por módulo) e o perfil de cada usuário.
    id: '008_access_profiles',
    statements: () => [
      `CREATE TABLE IF NOT EXISTS access_profiles (
        id ${pk()},
        name VARCHAR(60) NOT NULL UNIQUE,
        description VARCHAR(200) NOT NULL DEFAULT '',
        permissions TEXT NOT NULL,
        is_system INT NOT NULL DEFAULT 0,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
      )${tail()}`,
      `ALTER TABLE users ADD COLUMN profile_id INT NULL`,
    ],
  },
  {
    // Aniversariantes: data de nascimento (YYYY-MM-DD) e o último ano em que o e-mail de parabéns foi enviado.
    id: '009_birthdays',
    statements: () => [
      `ALTER TABLE users ADD COLUMN birth_date VARCHAR(10) NULL`,
      `ALTER TABLE users ADD COLUMN birthday_sent_year INT NULL`,
    ],
  },
  {
    // Troca de plano pelo cliente: a mensalidade gerada guarda o plano que ela ativa quando for paga.
    id: '010_plan_change',
    statements: () => [`ALTER TABLE receivables ADD COLUMN plan_id INT NULL`],
  },
  {
    // Vitrine do plano, editável pelo painel: ícone, textos, lista de benefícios e tabela de descontos.
    id: '011_plan_showcase',
    statements: () => [
      `ALTER TABLE plans ADD COLUMN subtitle VARCHAR(120) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN icon VARCHAR(20) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN price_label VARCHAR(80) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN price_note VARCHAR(120) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN featured INT NOT NULL DEFAULT 0`,
      `ALTER TABLE plans ADD COLUMN features TEXT NULL`,
      `ALTER TABLE plans ADD COLUMN tiers TEXT NULL`,
      `ALTER TABLE plans ADD COLUMN tiers_note VARCHAR(255) NOT NULL DEFAULT ''`,
    ],
  },
  {
    // Plano em faixa larga (ex.: Endereço Comercial) e contratação por WhatsApp em vez de pagamento online.
    id: '012_plan_banner',
    statements: () => [
      `ALTER TABLE plans ADD COLUMN layout VARCHAR(10) NOT NULL DEFAULT 'card'`,
      `ALTER TABLE plans ADD COLUMN headline VARCHAR(160) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN cta_label VARCHAR(80) NOT NULL DEFAULT ''`,
      `ALTER TABLE plans ADD COLUMN contact_only INT NOT NULL DEFAULT 0`,
    ],
  },
];

export async function migrate() {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(60) NOT NULL PRIMARY KEY, applied_at VARCHAR(19) NOT NULL)${tail()}`,
  );
  const done = new Set((await db.query('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.statements()) await tx.exec(stmt);
      await tx.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, nowStamp()]);
    });
    console.log(`[db] migração aplicada: ${m.id}`);
  }
}

const DEFAULT_SETTINGS = {
  business_name: 'harmonizeoser',
  business_address: 'R. Visc. do Rio Branco, 1358 — Batel, Curitiba/PR',
  business_phone: '(41) 99999-9999',
  business_whatsapp: '5541999999999',
  business_email: 'ola@harmonizeoser.com.br',
  slot_step_minutes: '30',
  min_notice_minutes: '60',
  max_advance_days: '60',
  cancel_min_hours: '2',
  max_upcoming_bookings: '20',
  max_recurrence_weeks: '12',
  require_approval: 'false',
  allow_signup: 'true',
  notice_message: '',
  pay_on_booking: 'false',
  booking_hold_minutes: '15',
  pagarme_enabled: 'false',
  pagarme_methods: 'pix,credit_card,boleto',
  pagarme_expires_minutes: '1440',
  pagarme_max_installments: '1',
  invoice_due_day: '10',
  checkin_window_minutes: '15',
  overtime_grace_minutes: '10',
  overtime_charge: 'true',
  auto_close_minutes: '180',
  usage_policy:
    'Aplicam-se orientações relacionadas ao uso do espaço, de acordo com as atividades que serão realizadas, sendo puramente legais sob a ótica comercial, jurídica, ética e moral.' +
    '\nRespeite o horário reservado, para que a próxima pessoa encontre a sala livre no horário combinado.',
};

const rooms = [
  ['Brisa', 'brisa', 'Sala de atendimento intimista', 2, 3500, 'sala-brisa.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'Luz natural', 'Café e água']],
  ['Flor', 'flor', 'Acolhedora, com atmosfera leve', 3, 4000, 'sala-flor.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'Luz natural', 'Café e água']],
  ['Cachoeira', 'cachoeira', 'Sala de atendimento para pequenos grupos', 4, 5500, 'sala-cachoeira.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'TV / tela', 'Café e água']],
  ['Terra', 'terra', 'Tons terrosos e muita calma', 3, 4500, 'sala-terra.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'Luz natural', 'Café e água']],
  ['Árvore', 'arvore', 'Ampla, ideal para oficinas e grupos', 6, 6500, 'sala-arvore.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'TV / tela', 'Quadro branco', 'Café e água']],
  ['Sol', 'sol', 'A mais iluminada da casa', 4, 6000, 'sala-sol.webp', ['Wi-Fi 500 Mbps', 'Ar-condicionado', 'Luz natural', 'Café e água']],
];

/** Plano em que todo cadastro novo começa (sem mensalidade, paga só as horas usadas). */
export const DEFAULT_PLAN_NAME = 'Modo Brisa';

// [nome, descrição, minutos incluídos por mês, ilimitado, desconto % nas horas extras, mensalidade em centavos]
const plans = [
  [DEFAULT_PLAN_NAME, 'Sublocação esporádica: pague só pelas horas que usar, sem mensalidade. Para quem valoriza a flexibilidade.', 0, 0, 0, 0],
  ['Plano Raiz', 'Combo de 4 horas pré-pagas para usar ao longo de 30 dias, com a hora a R$ 36,00. Base estável para atendimentos semanais.', 240, 0, 0, 14400],
  ['Plano Ecossistema', 'Pós-pago mensalista: use primeiro e pague depois, no dia 05 do mês seguinte. Para profissionais consolidados.', 0, 0, 0, 0],
];

/**
 * Vitrine dos planos atuais, como aparece no site. Aplicada uma vez por banco (`fillPlanShowcase`);
 * depois disso tudo é editado pelo painel (Planos).
 */
const PLAN_SHOWCASE = {
  [DEFAULT_PLAN_NAME]: {
    subtitle: 'Sublocação esporádica',
    description: 'Para quem valoriza a flexibilidade absoluta e o fluir do momento.',
    icon: 'leaf',
    price_label: 'R$ 27,00 a R$ 45,00',
    price_note: '/hora, conforme a sala',
    featured: 0,
    features: [
      'Sublocação por hora esporádica, sem mensalidades fixas',
      'Acesso livre e agendamento online prático em segundos',
      'Descontos automáticos para blocos de 4h, 6h ou 8h no mesmo dia',
    ],
    tiers: [],
    tiers_note: '',
  },
  'Plano Raiz': {
    subtitle: 'Combo de 4 horas',
    description: 'Dê sustentação e base estável para os seus atendimentos semanais.',
    icon: 'sprout',
    price_label: 'R$ 144,00',
    price_note: '/mês (a hora sai por R$ 36,00)',
    featured: 1,
    features: [
      'Lote de 4 horas pré-pagas, para usar com liberdade ao longo de 30 dias',
      'O formato ideal para quem tem ao menos um consultante fixo por semana',
      'Tarifa reduzida por hora em relação ao Modo Brisa',
      'Envio automático de convites personalizados (mapa e estacionamento) para seus atendidos',
    ],
    tiers: [],
    tiers_note: '',
  },
  'Plano Ecossistema': {
    subtitle: 'Pós-pago mensalista',
    description: 'A escolha prática para profissionais consolidados: liberdade e inteligência de caixa.',
    icon: 'tree',
    price_label: 'Usa primeiro',
    price_note: ', paga depois (dia 05)',
    featured: 0,
    features: [
      'Agende livremente e pague só no dia 05 do mês seguinte',
      'Total autonomia com senha eletrônica e reconhecimento facial na portaria 24h',
      'Depósito de garantia de R$ 400,00, 100% reembolsável ao término do contrato',
    ],
    tiers: [
      { label: 'De 10 a 29,5 horas no mês', benefit: '-R$ 2,00 de desconto por hora' },
      { label: 'De 30 a 49,5 horas no mês', benefit: '-R$ 6,00 de desconto por hora' },
      { label: 'Acima de 50 horas no mês', benefit: '-R$ 8,00 de desconto por hora' },
    ],
    tiers_note: 'Desconto progressivo por fidelidade.',
  },
};

/** Preenche a vitrine dos três planos atuais (uma vez por banco; nunca sobrescreve edições posteriores). */
async function fillPlanShowcase() {
  if (await db.get("SELECT k FROM settings WHERE k = 'plans_showcase'")) return;
  for (const [name, s] of Object.entries(PLAN_SHOWCASE)) {
    await db.run(
      `UPDATE plans SET subtitle = ?, description = ?, icon = ?, price_label = ?, price_note = ?, featured = ?, features = ?, tiers = ?, tiers_note = ? WHERE name = ?`,
      [s.subtitle, s.description, s.icon, s.price_label, s.price_note, s.featured, JSON.stringify(s.features), JSON.stringify(s.tiers), s.tiers_note, name],
    );
  }
  await db.run("INSERT INTO settings (k, v) VALUES ('plans_showcase', 'v1')");
}

/** Plano de escritório virtual, mostrado em faixa larga e contratado pelo WhatsApp. Criado uma vez por banco. */
const ADDRESS_PLAN = {
  name: 'Endereço Comercial',
  description: 'Use o endereço nobre do Edifício Hannover no seu site, cartão de visitas e Instagram, mantendo sua casa protegida. Inclui gestão profissional de correspondências para prestadores de serviços em áreas correlatas à saúde e bem-estar integrativo.',
  included_minutes: 0,
  unlimited: 0,
  room_discount_percent: 10, // "10% de desconto fixo em todas as sublocações de salas físicas"
  price_cents: 8700,
  sort_order: 3,
  subtitle: 'Escritório virtual',
  icon: 'building',
  price_label: 'R$ 87,00',
  price_note: '/mês',
  featured: 0,
  features: [
    'Contrato mínimo de 6 meses.',
    'R$ 939,60/ano (equivale a R$ 78,30/mês, 10% off à vista)',
    'Clientes do Endereço Comercial têm 10% de desconto fixo em todas as sublocações de salas físicas.',
  ],
  layout: 'banner',
  headline: 'Nosso Endereço Comercial Premium.',
  cta_label: 'Contratar Endereço Comercial',
  contact_only: 1,
};

async function addAddressPlan() {
  if (await db.get("SELECT k FROM settings WHERE k = 'plans_address'")) return;
  const p = ADDRESS_PLAN;
  if (!(await db.get('SELECT id FROM plans WHERE name = ?', [p.name]))) {
    await db.run(
      `INSERT INTO plans (name, description, included_minutes, unlimited, room_discount_percent, price_cents, sort_order,
                          subtitle, icon, price_label, price_note, featured, features, tiers, tiers_note, layout, headline, cta_label, contact_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '', ?, ?, ?, ?)`,
      [p.name, p.description, p.included_minutes, p.unlimited, p.room_discount_percent, p.price_cents, p.sort_order,
        p.subtitle, p.icon, p.price_label, p.price_note, p.featured, JSON.stringify(p.features), p.layout, p.headline, p.cta_label, p.contact_only],
    );
  }
  await db.run("INSERT INTO settings (k, v) VALUES ('plans_address', 'v1')");
}

/** Planos da primeira versão do sistema, substituídos pelo catálogo atual (ver `swapPlanCatalog`). */
const LEGACY_PLAN_NAMES = ['Avulso', 'Day Pass', 'Flex', 'Sala Privativa'];

/**
 * Troca única do catálogo de planos: cria os planos atuais, passa quem estava num plano antigo para o plano padrão
 * e apaga os antigos (com as trocas de plano deles que ainda aguardavam pagamento). Só roda uma vez por banco;
 * planos criados depois pela administração nunca são tocados.
 */
async function swapPlanCatalog() {
  if (await db.get("SELECT k FROM settings WHERE k = 'plans_catalog'")) return;

  let order = 0;
  for (const [name, description, minutes, unlimited, discount, price] of plans) {
    if (!(await db.get('SELECT id FROM plans WHERE name = ?', [name]))) {
      await db.run(
        'INSERT INTO plans (name, description, included_minutes, unlimited, room_discount_percent, price_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, description, minutes, unlimited, discount, price, order],
      );
    }
    order++;
  }

  const legacy = await db.query(`SELECT id FROM plans WHERE name IN (${LEGACY_PLAN_NAMES.map(() => '?').join(',')})`, LEGACY_PLAN_NAMES);
  if (legacy.length) {
    const ids = legacy.map((p) => Number(p.id));
    const marks = ids.map(() => '?').join(',');
    const fallback = await db.get('SELECT id FROM plans WHERE name = ?', [DEFAULT_PLAN_NAME]);
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE users SET plan_id = ? WHERE plan_id IN (${marks})`, [fallback.id, ...ids]);
      await tx.run(`DELETE FROM receivables WHERE status = 'pending' AND plan_id IN (${marks})`, ids);
      await tx.run(`DELETE FROM plans WHERE id IN (${marks})`, ids);
    });
  }
  await db.run("INSERT INTO settings (k, v) VALUES ('plans_catalog', 'v2')");
}

export async function seed() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const has = await db.get('SELECT k FROM settings WHERE k = ?', [k]);
    if (!has) await db.run('INSERT INTO settings (k, v) VALUES (?, ?)', [k, v]);
  }

  const hours = await db.get('SELECT COUNT(*) AS n FROM business_hours');
  if (!Number(hours.n)) {
    for (let d = 0; d < 7; d++) {
      const open = d >= 1 && d <= 6;
      const [o, c] = d === 6 ? ['09:00', '13:00'] : ['08:00', '20:00'];
      await db.run('INSERT INTO business_hours (weekday, is_open, open_time, close_time) VALUES (?, ?, ?, ?)', [d, open ? 1 : 0, o, c]);
    }
  }

  await swapPlanCatalog();
  await fillPlanShowcase();
  await addAddressPlan();

  const roomCount = await db.get('SELECT COUNT(*) AS n FROM rooms');
  if (!Number(roomCount.n)) {
    let i = 0;
    for (const [name, slug, tagline, capacity, price, img, amenities] of rooms) {
      await db.run(
        `INSERT INTO rooms (name, slug, tagline, description, capacity, price_cents, image, amenities, min_minutes, max_minutes, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 60, 480, ?, ?)`,
        [
          `Sala ${name}`,
          slug,
          tagline,
          `Ambiente privativo no harmonizeoser, pensado para atendimentos, reuniões e encontros com calma e bem-estar. ${tagline}.`,
          capacity,
          price,
          `/assets/salas/${img}`,
          JSON.stringify(amenities),
          i++,
          nowStamp(),
        ],
      );
    }
  }

  for (const p of DEFAULT_PROFILES) {
    const has = await db.get('SELECT id FROM access_profiles WHERE name = ?', [p.name]);
    if (!has) {
      await db.run(
        'INSERT INTO access_profiles (name, description, permissions, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [p.name, p.description, JSON.stringify(p.permissions), p.is_system, nowStamp(), nowStamp()],
      );
    }
  }
  const fullProfile = await db.get('SELECT id FROM access_profiles WHERE is_system = 1 ORDER BY id LIMIT 1');
  // Quem já era administrador antes dos perfis passa a ter o perfil "Administrador" (acesso total).
  await db.run("UPDATE users SET profile_id = ? WHERE role = 'admin' AND profile_id IS NULL", [fullProfile.id]);

  const admin = await db.get('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
  if (!admin) {
    const password = config.admin.password || (config.isProd ? crypto.randomBytes(9).toString('base64url') : 'admin123');
    await db.run(
      `INSERT INTO users (name, email, password, role, profile_id, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?, ?)`,
      [config.admin.name, config.admin.email, await bcrypt.hash(password, 10), fullProfile.id, nowStamp(), nowStamp()],
    );
    if (config.isProd && !config.admin.password) {
      console.log(`[seed] Administrador criado: ${config.admin.email} / senha temporária: ${password} (troque após o primeiro acesso)`);
    } else {
      console.log(`[seed] Administrador criado: ${config.admin.email}`);
    }
  }

  if (config.seedDemo) await seedDemo();
}

async function seedDemo() {
  const exists = await db.get('SELECT id FROM users WHERE email = ?', ['cliente@exemplo.com']);
  if (exists) return;

  const raiz = await db.get("SELECT id FROM plans WHERE name = 'Plano Raiz'");
  const hash = await bcrypt.hash('cliente123', 10);
  const people = [
    ['Sergio Pimenta', 'cliente@exemplo.com', '(41) 99999-0001', 'Pimenta Psicologia', raiz.id],
    ['Marina Albuquerque', 'marina@exemplo.com', '(41) 99999-0002', 'Terapeuta integrativa', raiz.id],
    ['Caio Fontana', 'caio@exemplo.com', '(41) 99999-0003', 'Fontana Consultoria', null],
    ['Helena Duarte', 'helena@exemplo.com', '(41) 99999-0004', 'Duarte Nutrição', null],
  ];
  const ids = [];
  for (const [name, email, phone, company, plan] of people) {
    const r = await db.run(
      `INSERT INTO users (name, email, password, role, phone, company, plan_id, created_at, updated_at) VALUES (?, ?, ?, 'client', ?, ?, ?, ?, ?)`,
      [name, email, hash, phone, company, plan, nowStamp(), nowStamp()],
    );
    ids.push(r.insertId);
  }

  const roomRows = await db.query('SELECT id, price_cents FROM rooms ORDER BY sort_order');
  const today = nowLocal().date;
  // [dias à frente, sala, cliente, início, fim, título]
  const samples = [
    [0, 0, 0, '09:00', '10:00', 'Atendimento — Ana'],
    [0, 1, 1, '14:00', '16:00', 'Oficina de respiração'],
    [0, 2, 1, '10:00', '11:30', 'Sessão de terapia'],
    [0, 3, 2, '15:00', '16:00', 'Consulta nutricional'],
    [1, 3, 3, '09:30', '11:00', 'Reunião de planejamento'],
    [1, 4, 2, '13:00', '15:00', 'Grupo de estudos'],
    [2, 5, 3, '16:00', '17:00', 'Atendimento'],
    [2, 1, 0, '10:00', '12:00', 'Workshop'],
    [3, 0, 0, '11:00', '12:00', 'Atendimento — Bruno'],
  ];
  const usedByUser = new Map(); // minutos incluídos já consumidos no mês (Plano Raiz = 240 min, sem desconto)
  for (const [offset, r, u, s, e, title] of samples) {
    const date = addDays(today, offset);
    if (weekdayOf(date) === 0) continue;
    const room = roomRows[r];
    const minutes = toMin(e) - toMin(s);
    const hasPlan = u <= 1;
    const usedKey = `${u}-${date.slice(0, 7)}`;
    const included = hasPlan ? Math.min(minutes, Math.max(0, 240 - (usedByUser.get(usedKey) || 0))) : 0;
    usedByUser.set(usedKey, (usedByUser.get(usedKey) || 0) + included);
    const price = Math.round(((room.price_cents * (minutes - included)) / 60));
    await db.run(
      `INSERT INTO bookings (code, room_id, user_id, date, start_time, end_time, start_at, end_at, status, title, attendees, total_minutes, included_minutes, price_cents, payment_status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `HZ-DEMO${r}${u}${offset}`,
        room.id, ids[u], date, s, e, `${date} ${s}`, `${date} ${e}`, title, minutes,
        included, price, price ? 'pending' : 'none', ids[u], nowStamp(), nowStamp(),
      ],
    );
  }
  console.log('[seed] Dados de demonstração criados (cliente@exemplo.com).');
}
