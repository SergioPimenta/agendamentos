import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { requireAdmin, requireModule, verifyToken } from '../middleware/auth.js';
import { apiConfigured, conexaBaseUrl, isSyncing, retryEvent, retryPlaceErrors, syncFromApi, testConnection, webhookConfigured } from '../services/conexa.js';
import { HttpError, asyncHandler, parse } from '../utils/http.js';

const router = express.Router();
router.use(verifyToken, requireAdmin, requireModule(['settings']));

const presentEvent = (e) => ({
  id: Number(e.id), source: e.source, kind: e.kind, booking_ref: e.booking_ref, status: e.status, message: e.message,
  created_at: e.created_at, retryable: e.status === 'error' && Boolean(Number(e.has_payload)),
});

/** Situação da integração: o que falta configurar, as salas para relacionar e o que chegou. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const places = await db.query('SELECT place_id, name, room_id FROM conexa_places ORDER BY name');
    const rooms = await db.query('SELECT id, name FROM rooms ORDER BY sort_order, name');
    const events = await db.query(
      `SELECT id, source, kind, booking_ref, status, message, created_at, CASE WHEN payload IS NULL THEN 0 ELSE 1 END AS has_payload
         FROM conexa_events ORDER BY id DESC LIMIT 100`,
    );
    const last = await db.get("SELECT status, message, created_at FROM conexa_events WHERE kind = 'sincronizacao' ORDER BY id DESC LIMIT 1");
    const pending = await db.get("SELECT COUNT(*) AS n FROM conexa_events WHERE status = 'error' AND payload IS NOT NULL");
    const synced = await db.get('SELECT COUNT(*) AS n FROM bookings WHERE legacy_id IS NOT NULL');
    res.json({
      webhook: {
        configured: webhookConfigured(),
        url: webhookConfigured() ? `${config.appUrl}/api/webhooks/conexa/${config.conexa.webhookToken}` : null,
      },
      api: { configured: apiConfigured(), base_url: apiConfigured() ? conexaBaseUrl() : null },
      syncing: isSyncing(),
      last_sync: last ?? null,
      pending_errors: Number(pending.n),
      bookings_from_conexa: Number(synced.n),
      places: places.map((p) => ({ place_id: p.place_id, name: p.name, room_id: p.room_id == null ? null : Number(p.room_id) })),
      rooms: rooms.map((r) => ({ id: Number(r.id), name: r.name })),
      events: events.map(presentEvent),
    });
  }),
);

/** Relaciona um local da Conexa a uma sala daqui e reprocessa os avisos que estavam parados por isso. */
router.put(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ room_id: z.coerce.number().int().positive().nullable() }), req.body);
    const place = await db.get('SELECT place_id FROM conexa_places WHERE place_id = ?', [req.params.placeId]);
    if (!place) throw new HttpError(404, 'Local não encontrado.');
    if (d.room_id != null && !(await db.get('SELECT id FROM rooms WHERE id = ?', [d.room_id]))) throw new HttpError(400, 'Sala inexistente.');
    await db.run('UPDATE conexa_places SET room_id = ? WHERE place_id = ?', [d.room_id, req.params.placeId]);
    res.json({ ok: true, reprocessed: d.room_id == null ? 0 : await retryPlaceErrors() });
  }),
);

router.post(
  '/events/:id/retry',
  asyncHandler(async (req, res) => {
    const r = await retryEvent(Number(req.params.id));
    if (!r) throw new HttpError(404, 'Registro sem dados para reprocessar.');
    res.json(r);
  }),
);

router.post(
  '/test',
  asyncHandler(async (_req, res) => {
    if (!apiConfigured()) throw new HttpError(422, 'Defina CONEXA_URL e CONEXA_TOKEN no servidor.');
    try {
      res.json(await testConnection());
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : 'Não foi possível falar com a Conexa.');
    }
  }),
);

/** Lê as reservas da Conexa pela API. Roda em segundo plano (pode levar minutos por causa do limite de chamadas). */
router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    if (!apiConfigured()) throw new HttpError(422, 'Defina CONEXA_URL e CONEXA_TOKEN no servidor.');
    if (isSyncing()) throw new HttpError(409, 'Já existe uma sincronização em andamento.');
    const d = parse(
      z.object({
        days_back: z.coerce.number().int().min(0).max(365).optional().default(30),
        days_ahead: z.coerce.number().int().min(0).max(730).optional().default(365),
      }),
      req.body ?? {},
    );
    syncFromApi({ daysBack: d.days_back, daysAhead: d.days_ahead, maxPages: 400 }).catch(() => {});
    res.status(202).json({ started: true });
  }),
);

export default router;
