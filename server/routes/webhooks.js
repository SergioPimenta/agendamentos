import crypto from 'crypto';
import express from 'express';
import { config } from '../config.js';
import { handleWebhook as handleConexaWebhook } from '../services/conexa.js';
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

/**
 * Webhook da Conexa (reserva cadastrada, editada, cancelada e recorrente). A Conexa não assina o aviso: o segredo vai na URL
 * (CONEXA_WEBHOOK_TOKEN). Responde 200 mesmo quando o aviso não pôde ser gravado (fica registrado para reprocessar), porque
 * a Conexa bloqueia o webhook depois de 5 falhas seguidas.
 */
router.post(
  '/conexa/:token',
  rateLimit({ windowMs: 60 * 1000, max: 600, key: (req) => req.ip }),
  asyncHandler(async (req, res) => {
    const expected = config.conexa.webhookToken;
    if (!expected || !safeEqual(req.params.token, expected)) throw new HttpError(404, 'Não encontrado.');
    try {
      res.json({ ok: true, ...(await handleConexaWebhook(req.body)) });
    } catch (err) {
      console.error('[conexa] falha ao tratar o webhook', err);
      res.json({ ok: false });
    }
  }),
);

export default router;
