import { useState } from 'react';
import { CheckCircle2, Copy, PlugZap, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, useToast } from '../../components/ui/Feedback';
import { Input, Switch } from '../../components/ui/Form';
import { Card, CardHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { api } from '../../services/api';
import type { AdminSettings, GatewayStatus } from '../../types';

const METHODS = [
  { id: 'pix', label: 'Pix' },
  { id: 'credit_card', label: 'Cartão de crédito' },
  { id: 'boleto', label: 'Boleto' },
];

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className="flex items-center gap-2.5 text-[13.5px] text-ink">
    {ok ? <CheckCircle2 size={18} className="shrink-0 text-sage-700" /> : <XCircle size={18} className="shrink-0 text-rose" />}
    {children}
  </li>
);

/** Configuração dos pagamentos online. As chaves ficam no servidor (.env); aqui só se liga e ajusta. */
export function PagarmeSettingsCard({ s, setS, onSave, saving }: { s: AdminSettings; setS: (s: AdminSettings) => void; onSave: () => void; saving: boolean }) {
  const toast = useToast();
  const gw = useApi(() => api.get<GatewayStatus>('/admin/finance/gateway'), []);
  const [testing, setTesting] = useState(false);
  const g = gw.data;
  const methods = (s.pagarme_methods || '').split(',').filter(Boolean);

  const toggleMethod = (id: string) => {
    const next = methods.includes(id) ? methods.filter((m) => m !== id) : [...methods, id];
    setS({ ...s, pagarme_methods: METHODS.map((m) => m.id).filter((m) => next.includes(m)).join(',') });
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; mode: string }>('/admin/finance/gateway/test');
      toast.success(`Conexão com o Pagar.me funcionando (${r.mode === 'test' ? 'modo de teste' : 'produção'}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível conectar.');
    } finally {
      setTesting(false);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copiado.'); } catch { toast.error('Não foi possível copiar.'); }
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Pagamentos online (Pagar.me)"
        subtitle="O cliente paga a fatura com Pix, cartão ou boleto e a baixa acontece sozinha no Financeiro."
        action={g && <Badge tone={g.mode === 'live' ? 'sage' : g.mode === 'none' ? 'mist' : 'amber'}>{g.mode === 'live' ? 'Produção' : g.mode === 'test' ? 'Modo de teste' : g.mode === 'none' ? 'Sem chave' : 'Teste ou produção? Confira'}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <ul className="flex flex-col gap-2.5 rounded-2xl bg-sand/60 p-4">
            <Check ok={!!g?.secret_key_configured}>Chave secreta no servidor <span className="text-stone">(PAGARME_SECRET_KEY)</span></Check>
            <Check ok={!!g?.public_key_configured}>Chave pública no servidor <span className="text-stone">(PAGARME_PUBLIC_KEY, para o cartão no popup de reserva)</span></Check>
            <Check ok={!!g?.webhook_token_configured}>Segredo do webhook no servidor <span className="text-stone">(PAGARME_WEBHOOK_TOKEN)</span></Check>
          </ul>
          {g && (!g.secret_key_configured || !g.webhook_token_configured) && (
            <p className="rounded-xl bg-amber-dim px-4 py-3 text-[12.5px] leading-relaxed text-amber">
              Defina essas variáveis no arquivo <code>server/.env</code> (a chave fica no painel do Pagar.me, em Configurações → Chaves) e reinicie o servidor. Elas não são digitadas aqui para que nunca fiquem expostas.
            </p>
          )}

          {g?.mode === 'unknown' && (
            <p className="rounded-xl bg-amber-dim px-4 py-3 text-[12.5px] leading-relaxed text-amber">
              Não dá para saber, pelo texto da chave, se ela é de <strong>teste</strong> ou de <strong>produção</strong>. Confirme no painel do Pagar.me antes de cobrar clientes de verdade. Uma chave de produção gera cobranças reais.
            </p>
          )}

          <Switch
            checked={s.pagarme_enabled}
            onChange={(v) => setS({ ...s, pagarme_enabled: v })}
            disabled={!g?.secret_key_configured}
            label="Aceitar pagamento online"
            description="Mostra o botão “Pagar” para o cliente e o “Cobrar online” para a administração."
          />

          <div className="flex flex-col gap-4 rounded-2xl border border-ink/8 p-4">
            <Switch
              checked={s.pay_on_booking}
              onChange={(v) => setS({ ...s, pay_on_booking: v })}
              disabled={!g?.secret_key_configured}
              label="Cobrar no ato da reserva"
              description="O cliente paga com Pix ou cartão no próprio popup de reserva e a reserva só é confirmada depois do pagamento. Quem tem horas incluídas no plano não paga. Reservas recorrentes seguem na fatura mensal."
            />
            {s.pay_on_booking && (
              <Input label="Tempo para pagar (min)" type="number" min={5} max={60} value={s.booking_hold_minutes} onChange={(e) => setS({ ...s, booking_hold_minutes: Number(e.target.value) })} hint="O horário fica guardado por esse tempo. Se o pagamento não acontecer, ele é liberado sozinho." />
            )}
            {s.pay_on_booking && !g?.public_key_configured && (
              <p className="rounded-xl bg-amber-dim px-4 py-3 text-[12.5px] leading-relaxed text-amber">Sem a chave pública (PAGARME_PUBLIC_KEY) só o Pix aparece no popup; o cartão fica indisponível.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[12px] font-semibold tracking-wide text-ink">Formas de pagamento aceitas</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {METHODS.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-sage-700" checked={methods.includes(m.id)} onChange={() => toggleMethod(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
            {methods.length === 0 && <p className="mt-2 text-[12px] text-rose">Escolha ao menos uma forma de pagamento.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Validade do link (min)" type="number" min={30} max={10080} value={s.pagarme_expires_minutes} onChange={(e) => setS({ ...s, pagarme_expires_minutes: Number(e.target.value) })} hint="1440 = 24 horas." />
            <Input label="Parcelas no cartão (até)" type="number" min={1} max={12} value={s.pagarme_max_installments} onChange={(e) => setS({ ...s, pagarme_max_installments: Number(e.target.value) })} hint="Sem juros para o cliente." />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button loading={saving} disabled={methods.length === 0} onClick={onSave}>Salvar pagamentos online</Button>
            <Button variant="secondary" icon={<PlugZap size={16} />} loading={testing} disabled={!g?.secret_key_configured} onClick={test}>Testar conexão</Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-ink/8 p-5">
          <p className="text-[13.5px] font-semibold text-ink">Webhook (confirmação automática)</p>
          <p className="text-[12.5px] leading-relaxed text-stone">
            No painel do Pagar.me, na área de Webhooks, cadastre o endereço abaixo e marque os eventos de pedido e cobrança
            (<code>order.paid</code>, <code>order.payment_failed</code>, <code>order.canceled</code>, <code>charge.paid</code>, <code>charge.refunded</code>).
            Sem isso o pagamento ainda é confirmado quando o cliente volta ao sistema, ou pelo botão “Atualizar” em Financeiro → Pagamentos online.
          </p>
          {g?.webhook_url ? (
            <div className="flex gap-2">
              <input readOnly value={g.webhook_url} onFocus={(e) => e.currentTarget.select()} aria-label="Endereço do webhook" className="min-w-0 flex-1 rounded-xl border border-ink/12 bg-sand/50 px-3.5 py-2.5 text-[12.5px] text-ink outline-none" />
              <Button size="sm" variant="soft" icon={<Copy size={14} />} onClick={() => copy(g.webhook_url!)}>Copiar</Button>
            </div>
          ) : (
            <p className="rounded-xl bg-sand/60 px-4 py-3 text-[12.5px] text-stone">Defina <code>PAGARME_WEBHOOK_TOKEN</code> no servidor para gerar o endereço.</p>
          )}
          <p className="text-[12px] leading-relaxed text-stone-light">
            O endereço precisa ser público (em produção, o domínio do sistema com HTTPS). O sistema nunca confia só no conteúdo recebido: antes de dar baixa, confirma o pagamento direto no Pagar.me.
          </p>
        </div>
      </div>
    </Card>
  );
}
