import crypto from 'crypto';
import express from 'express';
import { config } from '../config.js';
import { handleWebhookEvent } from '../services/onlinePayments.js';
import { HttpError, asyncHandler, rateLimit } from '../utils/http.js';

const router = express.Router();

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Webhook do Pagar.me. A URL leva um segredo (PAGARME_WEBHOOK_TOKEN) e o conteúdo do evento nunca é
 * confiado: o serviço consulta o pedido na API do Pagar.me antes de dar baixa.
 * Responde 200 para tudo que foi entendido (inclusive eventos que ignoramos) e 5xx quando vale o Pagar.me reenviar.
 */
router.post(
  '/pagarme/:token',
  rateLimit({ windowMs: 60 * 1000, max: 300, key: (req) => req.ip }),
  asyncHandler(async (req, res) => {
    const expected = config.pagarme.webhookToken;
    if (!expected || !safeEqual(req.params.token, expected)) throw new HttpError(404, 'Não encontrado.');
    res.json({ ok: true, ...(await handleWebhookEvent(req.body)) });
  }),
);

export default router;
