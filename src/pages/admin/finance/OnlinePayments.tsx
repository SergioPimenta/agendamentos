import { useState } from 'react';
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useToast } from '../../../components/ui/Feedback';
import { Card, DataTable, Segmented, Td, Th } from '../../../components/ui/Misc';
import { useApi } from '../../../hooks/useApi';
import { fmtDateFull } from '../../../lib/format';
import { api } from '../../../services/api';
import type { OnlinePayment } from '../../../types';
import { Money, methodLabel } from './shared';

type Filter = 'all' | 'pending' | 'paid' | 'review' | 'expired';

const STATUS: Record<OnlinePayment['display_status'], { label: string; tone: 'amber' | 'sage' | 'rose' | 'mist' }> = {
  pending: { label: 'Aguardando', tone: 'amber' },
  paid: { label: 'Pago', tone: 'sage' },
  failed: { label: 'Recusado', tone: 'rose' },
  canceled: { label: 'Cancelado', tone: 'mist' },
  expired: { label: 'Expirado', tone: 'mist' },
};

export default function OnlinePayments() {
  const toast = useToast();
  const [status, setStatus] = useState<Filter>('all');
  const q = useApi(() => api.get<{ payments: OnlinePayment[] }>('/admin/finance/payments', { status }), [status]);
  const [busy, setBusy] = useState<number | null>(null);

  const sync = async (p: OnlinePayment) => {
    setBusy(p.id);
    try {
      const r = await api.post<{ payment: OnlinePayment }>(`/admin/finance/payments/${p.id}/sync`);
      toast[r.payment.status === 'paid' ? 'success' : 'info'](r.payment.status === 'paid' ? 'Pagamento confirmado.' : 'Ainda sem confirmação do Pagar.me.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copiado.'); } catch { toast.error('Não foi possível copiar.'); }
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter> value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todos' }, { value: 'pending', label: 'Aguardando' }, { value: 'paid', label: 'Pagos' }, { value: 'review', label: 'Para revisar' }, { value: 'expired', label: 'Expirados' }]} />
        <p className="max-w-[48ch] text-[12.5px] leading-relaxed text-stone">Cobranças geradas pelo Pagar.me. Quando o cliente paga, a baixa acontece sozinha; use "Atualizar" se uma confirmação demorar.</p>
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {q.loading && !q.data ? <Skeleton className="h-[240px] rounded-[22px]" /> : q.data && q.data.payments.length === 0 ? (
        <Card><EmptyState title="Nenhum pagamento online ainda" description="Gere um link em Contas a receber (botão “Cobrar online”) ou deixe o cliente pagar pela página de consumo dele." /></Card>
      ) : (
        <DataTable>
          <thead><tr><Th>Gerado em</Th><Th>Cliente / descrição</Th><Th className="text-right">Valor</Th><Th>Forma</Th><Th>Situação</Th><Th className="text-right">Ações</Th></tr></thead>
          <tbody>
            {q.data?.payments.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{fmtDateFull(p.created_at.slice(0, 10))}</Td>
                <Td>
                  <span className="block font-medium">{p.user_name}</span>
                  <span className="block text-[12px] text-stone">{p.description}</span>
                  {p.note && <span className="mt-1 flex items-start gap-1.5 text-[12px] text-amber"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{p.note}</span>}
                </Td>
                <Td className="text-right"><Money cents={p.amount_cents} className="font-medium" /></Td>
                <Td className="text-stone">{methodLabel(p.method)}</Td>
                <Td><Badge tone={STATUS[p.display_status].tone}>{STATUS[p.display_status].label}</Badge>{p.needs_review && <Badge tone="clay" className="mt-1 ml-1.5">Revisar</Badge>}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {p.checkout_url && <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => copy(p.checkout_url!)}>Link</Button>}
                    {p.status !== 'paid' && <Button size="sm" variant="soft" loading={busy === p.id} icon={<RefreshCw size={14} />} onClick={() => sync(p)}>Atualizar</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
