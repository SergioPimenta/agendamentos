// Ponto de entrada serverless da Vercel: toda chamada /api/* e /uploads/* cai aqui (ver vercel.json).
import { createApp } from '../server/index.js';

let appPromise;

export default async function handler(req, res) {
  appPromise ??= createApp().catch((err) => {
    appPromise = undefined; // tenta de novo na próxima requisição
    throw err;
  });
  const app = await appPromise;
  return app(req, res);
}
