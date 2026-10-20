import cors from 'cors';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { config } from './config.js';
import { migrate, seed } from './db/migrate.js';
import adminRoutes from './routes/admin.js';
import appRoutes from './routes/app.js';
import authRoutes from './routes/auth.js';
import financeRoutes from './routes/finance.js';
import webhookRoutes from './routes/webhooks.js';
import { releaseExpiredHolds } from './services/bookings.js';
import { autoCloseSessions } from './services/sessions.js';
import { asyncHandler, errorHandler } from './utils/http.js';

export async function createApp() {
  await migrate();
  await seed();

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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const app = await createApp();
  app.listen(config.port, () => console.log(`[api] rodando em http://localhost:${config.port} (${config.dbDriver})`));

  // Encerra sozinho (sem excedente) quem esqueceu o check-out. Roda a cada 5 minutos.
  // Libera os horários cujo prazo para pagar acabou (a cada minuto).
  setInterval(() => releaseExpiredHolds().catch((e) => console.error('[reservas] falha ao liberar horários:', e.message)), 60 * 1000).unref();

  setInterval(() => autoCloseSessions().catch((e) => console.error('[sessões] falha ao encerrar:', e.message)), 5 * 60 * 1000).unref();
}
