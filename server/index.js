import cors from 'cors';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { config } from './config.js';
import { db } from './db/index.js';
import { migrate, seed } from './db/migrate.js';
import adminRoutes from './routes/admin.js';
import appRoutes from './routes/app.js';
import authRoutes from './routes/auth.js';
import financeRoutes from './routes/finance.js';
import webhookRoutes from './routes/webhooks.js';
import { sendBirthdayEmails } from './services/birthdays.js';
import { releaseExpiredHolds } from './services/bookings.js';
import { autoCloseSessions } from './services/sessions.js';
import { asyncHandler, errorHandler } from './utils/http.js';

export async function createApp() {
  // Várias instâncias serverless podem subir juntas: só uma por vez cria/atualiza as tabelas.
  await db.withLock(async () => {
    await migrate();
    await seed();
  });

  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'https://api.pagar.me'],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProd && process.env.FORCE_HTTPS === 'true' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: config.isProd ? false : true }));
  app.use(express.json({ limit: '200kb' }));

  // Rotina de limpeza para hospedagem sem processo fixo (Vercel Cron). Local/servidor próprio usa os setInterval abaixo.
  app.get('/api/cron/sweep', asyncHandler(async (req, res) => {
    if (!config.cronSecret || req.get('authorization') !== `Bearer ${config.cronSecret}`) {
      return res.status(401).json({ message: 'Não autorizado.' });
    }
    await releaseExpiredHolds();
    await autoCloseSessions();
    await sendBirthdayEmails();
    res.json({ ok: true });
  }));
  app.use('/api/auth', authRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/admin/finance', financeRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', appRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));

  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));

  // Em produção o mesmo processo serve o front-end compilado (SPA).
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
    app.use(express.static(config.distDir, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
