import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)) {
  throw new Error('JWT_SECRET precisa estar definido (mín. 24 caracteres) em produção.');
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3001,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // 'postgres' quando DATABASE_URL está definido (Neon, Supabase...), 'mysql' quando DB_HOST está definido;
  // caso contrário SQLite local (arquivo).
  databaseUrl: process.env.DATABASE_URL || '',
  dbDriver: process.env.DATABASE_URL ? 'postgres' : process.env.DB_HOST ? 'mysql' : 'sqlite',
  sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, 'data', 'agendamento.db'),
  mysql: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  admin: {
    name: process.env.ADMIN_NAME || 'Administração',
    email: (process.env.ADMIN_EMAIL || 'admin@harmonizeoser.com.br').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
  },
  seedDemo: process.env.SEED_DEMO === 'true',
  mail: {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    notify: process.env.NOTIFY_EMAIL || '',
  },
  // Pagar.me (pagamentos online). As chaves ficam só aqui, nunca no banco nem no front-end.
  pagarme: {
    secretKey: process.env.PAGARME_SECRET_KEY || '',
    // Chave pública (pk_...): segura para o navegador; só serve para tokenizar o cartão direto no Pagar.me.
    publicKey: process.env.PAGARME_PUBLIC_KEY || '',
    apiUrl: (process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5').replace(/\/$/, ''),
    webhookToken: process.env.PAGARME_WEBHOOK_TOKEN || '',
  },
  // Segredo do Vercel Cron (header Authorization: Bearer ...) para a rotina de limpeza em /api/cron/sweep.
  cronSecret: process.env.CRON_SECRET || '',
  // Na Vercel o disco do projeto é somente leitura; /tmp aceita escrita, mas some entre execuções.
  // UPLOADS_DIR aponta para uma pasta fora do código (ex.: na Hostinger, para as fotos sobreviverem a cada novo deploy).
  uploadsDir: process.env.UPLOADS_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads')),
  distDir: path.join(__dirname, '..', 'dist'),
};
