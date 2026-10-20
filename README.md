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
  index.js            app Express (helmet, CORS, rotas, serve dist/)
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
