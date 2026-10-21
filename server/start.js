// Ponto de entrada do servidor "de verdade" (npm start, Hostinger e qualquer hospedagem com processo fixo).
// Na Vercel o ponto de entrada é api/index.js, que usa só o createApp.
import { config } from './config.js';
import { createApp } from './index.js';
import { sendBirthdayEmails } from './services/birthdays.js';
import { releaseExpiredHolds } from './services/bookings.js';
import { autoCloseSessions } from './services/sessions.js';

const app = await createApp();
app.listen(config.port, () => console.log(`[api] rodando na porta ${config.port} (${config.dbDriver})`));

// Libera os horários cujo prazo para pagar acabou (a cada minuto).
setInterval(() => releaseExpiredHolds().catch((e) => console.error('[reservas] falha ao liberar horários:', e.message)), 60 * 1000).unref();

// Encerra sozinho (sem excedente) quem esqueceu o check-out. Roda a cada 5 minutos.
setInterval(() => autoCloseSessions().catch((e) => console.error('[sessões] falha ao encerrar:', e.message)), 5 * 60 * 1000).unref();

// E-mail de aniversário: confere a cada hora (e logo após ligar, caso o servidor tenha ficado fora do ar de manhã).
const birthdays = () => sendBirthdayEmails().catch((e) => console.error('[aniversários] falha ao enviar:', e.message));
setTimeout(birthdays, 30 * 1000).unref();
setInterval(birthdays, 60 * 60 * 1000).unref();
