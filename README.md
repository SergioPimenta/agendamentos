# Agendamento — harmonizeoser

Sistema de reserva de salas do coworking, separado do site institucional e com a mesma identidade visual
(verde‑sálvia, Fraunces/Manrope, o "dossel" de círculos). Substitui o fluxo que hoje roda na Conexa.

- **Front-end:** React 18 + Vite + Tailwind 4 + React Router (pasta `src/`)
- **Back-end:** Node 22.5+ / Express (pasta `server/`)
- **Banco:** SQLite (zero configuração, ótimo p/ dev e instalações simples) **ou** MySQL/MariaDB (produção). Basta preencher `DB_HOST` no `.env`.

## Rodando localmente

```bash
npm install
npm --prefix server install
cp server/.env.example server/.env     # ajuste se quiser (ADMIN_PASSWORD, SEED_DEMO=true …)

npm run dev:api      # API em http://localhost:3001
npm run dev          # Front em http://localhost:5173 (proxy para /api)
```

No primeiro start o sistema cria as tabelas, as 6 salas, os planos, o horário de funcionamento e o usuário administrador
(`ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`; em dev, sem senha definida, veja `server/db/migrate.js`).
Com `SEED_DEMO=true` também cria clientes e reservas de exemplo.

Testes da API (regras de conflito, preço/plano, cancelamento, bloqueios, concorrência):

```bash
npm test
```

## Produção

```bash
npm run build                      # gera dist/
NODE_ENV=production npm start      # um único processo serve API + front
```

Variáveis obrigatórias em produção: `JWT_SECRET` (≥ 24 caracteres), `APP_URL`, `ADMIN_PASSWORD` e, para MySQL,
`DB_HOST / DB_USER / DB_PASSWORD / DB_NAME`. Atrás de Nginx/proxy use `TRUST_PROXY=1`. Veja `server/.env.example`.
Faça backup do banco (`server/data/agendamento.db` no SQLite) e da pasta `server/uploads/` (fotos das salas).

## O que o sistema faz

**Cliente** (`/app`)
- Cadastro, login e "esqueci minha senha" (link por e-mail)
- **Reservar sala:** calendário do mês com dias lotados/livres, grade de horários por sala em tempo real, duração
  rápida, reservas recorrentes semanais, valor calculado na hora (já descontando as horas do plano)
- Minhas reservas (próximas/histórico), alterar, cancelar (respeitando o prazo), adicionar ao calendário (.ics)
- Consumo e faturas por mês, saldo de horas do plano
- Catálogo de salas, perfil, ajuda/FAQ e contato

**Administração** (`/admin`)
- Painel: reservas de hoje, pendências, receita, a receber, ocupação dos últimos/próximos dias, salas mais usadas
- **Agenda** visual (dia por sala / semana por sala): clique num horário vazio para reservar, clique numa reserva para gerenciar
- Reservas: busca e filtros, aprovar, não compareceu, reativar, marcar pagamento, exportar CSV
- Clientes (plano, contato, histórico, fatura do mês, "marcar mês como pago"), Salas (fotos, preço/h, capacidade,
  duração mín./máx., intervalo entre reservas), Planos (horas incluídas, ilimitado, desconto em horas extras)
- Bloqueios (feriados, manutenção) por sala ou geral
- Relatórios (ocupação, receita, por dia da semana, por horário, por sala, por cliente)
- Configurações: horário de funcionamento por dia, intervalo da agenda, antecedência mínima/máxima, prazo de
  cancelamento, limite de reservas futuras, aprovação manual, cadastro aberto/fechado, aviso na tela de reservas

## Pagamentos online (Pagar.me)

O cliente paga a fatura (ou uma reserva) com Pix, cartão ou boleto numa página do Pagar.me (checkout hospedado — nenhum dado de
cartão passa pelo nosso servidor). Quando o pagamento é confirmado, a baixa é automática e entra no Financeiro.

1. No painel do Pagar.me, copie a **chave secreta** (`sk_test_...` para testar, `sk_...` em produção).
2. Em `server/.env`: `PAGARME_SECRET_KEY=...` e `PAGARME_WEBHOOK_TOKEN=` (texto longo e aleatório). Reinicie o servidor.
3. Em **Configurações → Pagamentos online**: use "Testar conexão", copie o endereço do webhook e cadastre-o no painel do Pagar.me
   (eventos `order.paid`, `order.payment_failed`, `order.canceled`, `charge.paid`, `charge.refunded`). Depois ligue "Aceitar pagamento online".
4. Cliente: botão **Pagar** em Consumo e faturas. Administração: **Cobrar online** em Contas a receber (gera link para copiar/WhatsApp) e
   acompanhamento em **Financeiro → Pagamentos online**.

### Pagar a reserva na hora (Pix e cartão no popup)

Em **Configurações → Pagamentos online → "Cobrar no ato da reserva"**. Com isso ligado, ao reservar o cliente segue para uma etapa de
pagamento no próprio popup (e no painel da página da sala): o horário fica **guardado por 15 minutos** (configurável), ele paga com
**Pix** (QR code na tela) ou **cartão** e a reserva só é confirmada quando o pagamento cai. Se não pagar a tempo, ou desistir, o horário é liberado.

- Para o cartão aparecer, defina também `PAGARME_PUBLIC_KEY` (chave pública `pk_...`) em `server/.env` e cadastre o endereço do site no painel
  do Pagar.me (a tokenização do cartão é feita direto do navegador para o Pagar.me; os dados do cartão nunca passam pelo servidor).
- Não passam por esse fluxo: reservas feitas pela recepção, reservas recorrentes (seguem na fatura mensal) e reservas sem valor a cobrar
  (por exemplo, horas incluídas no plano).

Segurança: o conteúdo do webhook nunca é confiado — antes de dar baixa o sistema consulta o pedido direto na API do Pagar.me.
O endereço do webhook leva um segredo e o servidor precisa ser acessível pela internet (HTTPS) para receber as confirmações.

## Regras de negócio (resumo)

- Datas e horas são guardadas no horário de Curitiba (`America/Sao_Paulo`), sem conversão de fuso.
- Conflitos são checados **dentro de uma transação** com trava por sala — duas pessoas não conseguem reservar o mesmo horário.
- Horas do plano são consumidas por mês, na ordem das reservas; cancelar devolve as horas. O excedente é cobrado pelo
  valor/hora da sala com o desconto do plano. A cobrança em si (Pix/boleto) acontece fora do sistema: o admin registra o pagamento.
- Cliente só altera/cancela até `cancel_min_hours` antes do início; a administração pode sempre.

## Estrutura

```
server/
  index.js            app Express (createApp: helmet, CORS, rotas, serve dist/)
  start.js            sobe o servidor e as rotinas em segundo plano (npm start / Hostinger)
  config.js           variáveis de ambiente
  db/                 adaptador SQLite/MySQL, migrações e seed
  services/           disponibilidade, reservas (preço, recorrência, cancelamento), configurações
  routes/             auth, app (cliente), admin
  tests/              testes de integração (node --test)
src/
  components/ui       botões, formulários, modal, toasts, badges…
  components/booking  calendário, grade de horários, formulário de reserva, agenda (TimeGrid)
  pages/auth|app|admin
```

## Deploy na Hostinger (Node.js Web App, em um subdomínio)

Funciona em planos com *Node.js Web Apps* (Business ou Cloud). Um único processo serve a API e o front-end, no subdomínio que você escolher
(ex.: `agenda.harmonizeoser.com.br`), enquanto o site institucional continua no domínio principal.

1. **Subdomínio:** hPanel → *Domínios* → *Subdomínios* → crie `agenda` (ou o nome que preferir). O SSL é emitido sozinho.
2. **Banco de dados (escolha um):**
   - **Manter o Postgres atual (Neon):** use a mesma `DATABASE_URL` da Vercel. Os dados continuam todos lá.
   - **MySQL da Hostinger:** hPanel → *Bancos de dados* → crie o banco e o usuário; use `DB_HOST` (normalmente `localhost`), `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
   - **Não use SQLite** na Hostinger: a pasta do app é recriada a cada deploy e o arquivo do banco se perderia.
3. **Criar o app:** hPanel → *Sites* → *Adicionar site* → *Node.js web app* → *Importar repositório Git* → conecte o GitHub e escolha este repositório (branch `main`).
4. **Configurações do deploy:**
   - Framework: **Other** · Node.js: **22** (ou 24)
   - Comando de build: `build`
   - Arquivo de entrada (*Entry file*): `server/start.js`
   - Deixe o diretório de saída vazio.
   - O `npm install` da raiz já instala também as dependências de `server/` (script `postinstall`).
5. **Variáveis de ambiente** (na mesma tela): `NODE_ENV=production`, `JWT_SECRET` (24+ caracteres), `APP_URL` (ex.: `https://agenda.harmonizeoser.com.br`),
   `TRUST_PROXY=1`, o banco escolhido (`DATABASE_URL` **ou** `DB_*`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CRON_SECRET`, `UPLOADS_DIR`
   (pasta fora do código para as fotos das salas, ex.: `/home/SEU_USUARIO/uploads-agendamentos`; crie-a antes), e-mail (`EMAIL_HOST=smtp.hostinger.com`,
   `EMAIL_PORT=465`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`, `NOTIFY_EMAIL`) e, para pagamentos, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`.
6. **Domínio:** ao criar o app, escolha o subdomínio criado no passo 1 como endereço do site.
7. **Rotina automática (recomendado):** hPanel → *Avançado* → *Cron Jobs*, a cada 5 minutos:
   `curl -fsS -H "Authorization: Bearer SEU_CRON_SECRET" https://agenda.harmonizeoser.com.br/api/cron/sweep`
   (libera horários não pagos, encerra sessões esquecidas, envia e-mails de aniversário e mantém o app acordado).
8. **Pagar.me:** atualize o webhook para `https://agenda.harmonizeoser.com.br/api/webhooks/pagarme/<PAGARME_WEBHOOK_TOKEN>` e cadastre o novo endereço do site para a tokenização do cartão.

Cada `git push` na `main` redeploya sozinho (variáveis e `UPLOADS_DIR` permanecem). Faça backup do banco e da pasta de uploads.

## Deploy na Vercel

O front-end vira estático e a API roda como uma função (`api/index.js`, configurada em `vercel.json`).

1. **Banco externo é obrigatório.** O SQLite grava em arquivo e a Vercel não guarda arquivos entre execuções. O sistema aceita Postgres (`DATABASE_URL`, ex.: Neon, que a Vercel cria em *Storage*) ou MySQL (`DB_HOST`, `DB_USER`...). As tabelas são criadas sozinhas no primeiro acesso.
2. Importe o repositório em vercel.com/new (ou rode `npx vercel` na pasta do projeto).
3. Em *Settings → Environment Variables* defina: `JWT_SECRET` (24+ caracteres), `APP_URL` (a URL final, ex.: `https://seu-projeto.vercel.app`), `TRUST_PROXY=1`, `DATABASE_URL` (ou `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` para MySQL), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`, `CRON_SECRET` (qualquer texto longo) e, para pagamentos, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`.
4. No Pagar.me, aponte o webhook para `https://seu-projeto.vercel.app/api/webhooks/pagarme/<PAGARME_WEBHOOK_TOKEN>`.

Limitações na Vercel:
- **Fotos enviadas pelo painel** (upload de imagem das salas) vão para uma pasta temporária e **somem**. Para uso real, falta ligar um armazenamento (Vercel Blob/S3).
- A rotina que libera horários não pagos e encerra sessões esquecidas roda por Vercel Cron em `/api/cron/sweep`. No plano Hobby só é permitido 1 execução por dia; no Pro troque o `schedule` do `vercel.json` para `*/5 * * * *`. Mesmo assim, reservas vencidas sem pagamento são liberadas sempre que alguém consulta a disponibilidade.
