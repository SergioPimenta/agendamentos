import { config } from '../config.js';
import { HttpError } from '../utils/http.js';

/**
 * Cliente mínimo da API v5 do Pagar.me (https://docs.pagar.me).
 *
 *  - Autenticação: HTTP Basic com a chave secreta como usuário e senha vazia.
 *  - Usamos o checkout hospedado (`payment_method: "checkout"`): o cliente paga numa página do Pagar.me
 *    (Pix, cartão ou boleto), então nenhum dado de cartão passa pelo nosso servidor.
 *  - A chave secreta fica só em variável de ambiente e nunca é enviada ao navegador nem registrada em log.
 */

const TIMEOUT_MS = 15_000;

export const pagarmeConfigured = () => Boolean(config.pagarme.secretKey);

/**
 * "test" para sk_test_*, "live" para sk_live_*. Chaves sem esse marcador (o Pagar.me nem sempre usa) viram "unknown":
 * não dá para saber só pelo texto se é de teste ou de produção, então a tela avisa para conferir no painel.
 */
export const pagarmeMode = () => {
  const k = config.pagarme.secretKey;
  if (!k) return 'none';
  if (k.startsWith('sk_test_')) return 'test';
  if (k.startsWith('sk_live_')) return 'live';
  return 'unknown';
};

async function request(method, path, body) {
  if (!pagarmeConfigured()) throw new HttpError(503, 'O Pagar.me ainda não está configurado neste servidor.');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${config.pagarme.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.pagarme.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new HttpError(502, err.name === 'AbortError' ? 'O Pagar.me demorou demais para responder.' : 'Não foi possível falar com o Pagar.me.');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }

  if (!res.ok) {
    if (res.status === 401) throw new HttpError(502, 'O Pagar.me recusou a chave de acesso. Confira a PAGARME_SECRET_KEY.');
    // Mensagens de validação do Pagar.me vêm em `message` e/ou `errors` ({ campo: [mensagens] }).
    const detail = json?.errors ? Object.values(json.errors).flat().slice(0, 3).join(' ') : json?.message;
    console.error(`[pagarme] ${method} ${path} → ${res.status}`);
    throw new HttpError(502, `O Pagar.me não aceitou a cobrança${detail ? `: ${String(detail).slice(0, 200)}` : '.'}`);
  }
  return json;
}

/**
 * Cria um pedido com checkout hospedado. Devolve { orderId, checkoutUrl }.
 *  `methods`: lista de 'pix' | 'credit_card' | 'boleto'.
 */
export async function createCheckoutOrder({ code, description, amount_cents, customer, methods, expiresMinutes, installments = 1, successUrl, metadata = {}, statementDescriptor = 'HARMONIZEOSER' }) {
  const checkout = {
    expires_in: expiresMinutes,
    accepted_payment_methods: methods,
    default_payment_method: methods[0],
    success_url: successUrl,
    customer_editable: true,
    billing_address_editable: false,
    skip_checkout_success_page: false,
  };
  if (methods.includes('credit_card')) {
    checkout.credit_card = {
      capture: true,
      statement_descriptor: statementDescriptor.slice(0, 13), // 13 = limite das contas PSP
      installments: Array.from({ length: installments }, (_, i) => ({ number: i + 1, total: amount_cents })), // sem juros
    };
  }
  if (methods.includes('pix')) checkout.pix = { expires_in: expiresMinutes * 60 };
  if (methods.includes('boleto')) {
    const due = new Date(Date.now() + 3 * 86400000);
    checkout.boleto = { due_at: `${due.toISOString().slice(0, 10)}T23:59:59Z` };
  }

  const order = await request('POST', '/orders', {
    code,
    items: [{ amount: amount_cents, description: description.slice(0, 100), quantity: 1, code }],
    customer,
    metadata,
    payments: [{ payment_method: 'checkout', amount: amount_cents, checkout }],
  });

  const checkoutUrl = order?.checkouts?.[0]?.payment_url;
  if (!order?.id || !checkoutUrl) throw new HttpError(502, 'O Pagar.me não devolveu o link de pagamento.');
  return { orderId: order.id, checkoutUrl };
}

/**
 * Pedido com pagamento direto (checkout transparente): Pix, ou cartão já tokenizado no navegador.
 * O cartão nunca passa por aqui, só o `card_token` gerado pelo Pagar.me com a chave pública.
 */
export async function createDirectOrder({ code, description, amount_cents, customer, method, cardToken, installments = 1, expiresSeconds, metadata = {}, statementDescriptor = 'HARMONIZEOSER' }) {
  const payment = method === 'pix'
    ? { payment_method: 'pix', pix: { expires_in: expiresSeconds, additional_information: [{ name: 'Reserva', value: description.slice(0, 50) }] } }
    : {
        payment_method: 'credit_card',
        credit_card: { installments, statement_descriptor: statementDescriptor.slice(0, 13), operation_type: 'auth_and_capture', card_token: cardToken },
      };
  return request('POST', '/orders', {
    code,
    items: [{ amount: amount_cents, description: description.slice(0, 100), quantity: 1, code }],
    customer,
    metadata,
    payments: [payment],
  });
}

/** Consulta o pedido direto no Pagar.me: é a fonte da verdade (não confiamos só no conteúdo do webhook). */
export const getOrder = (orderId) => request('GET', `/orders/${encodeURIComponent(orderId)}`);

/** Teste de conexão: lista 1 pedido só para validar a chave. */
export const pingPagarme = () => request('GET', '/orders?page=1&size=1');

/** Pagar.me → nossas formas de pagamento. */
export const METHOD_MAP = { pix: 'pix', boleto: 'boleto', credit_card: 'cartao', debit_card: 'cartao', voucher: 'outro', bank_transfer: 'transferencia' };
