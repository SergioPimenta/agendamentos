// Roda depois do `npm install` da raiz:
//  1. instala as dependências do servidor (pasta server/);
//  2. em produção, compila o front-end (dist/). Hospedagens como a Hostinger, no modo Express, não têm um passo de build
//     separado: o servidor só consegue entregar o site se a pasta dist/ nascer aqui, durante a instalação.
// Na Vercel (que tem o próprio passo de build) e em desenvolvimento local o build é pulado.
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('npm --prefix server install --no-audit --no-fund');

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.VERCEL && !process.env.SKIP_FRONTEND_BUILD) {
  console.log('[postinstall] compilando o front-end (npm run build)…');
  run('npm run build');
}
