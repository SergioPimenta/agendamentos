import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Receipt, ShieldCheck } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { Badge, EmptyState, ErrorState, PaymentBadge, Skeleton, useToast } from '../../components/ui/Feedback';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader, DataTable, PageHeader, ProgressBar, Stat, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { addMonths, fmtDateShort, fmtDuration, fmtMoney, fmtMonth, todayStr } from '../../lib/format';
import { api } from '../../services/api';
import { BankCard } from '../../components/plans/BankCard';
import type { Booking, ClientPackages, OnlinePayment, Statement } from '../../types';

interface StatementRow { month: string; bookings: number; minutes: number; amount_cents: number; paid_cents: number }

export default function Usage() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [selected, setSelected] = useState<Booking | null>(null);
  const usage = useApi(() => api.get<Statement>('/me/usage', { month }), [month]);
  const history = useApi(() => api.get<{ statements: StatementRow[] }>('/me/statements'), []);
  const bank = useApi(() => api.get<ClientPackages>('/me/packages'), []);
  const u = usage.data;
  const toast = useToast();
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [paying, setPaying] = useState(false);

  // Volta do Pagar.me: confirma o pagamento direto na fonte, sem depender do webhook chegar primeiro.
  const returned = params.get('pagamento');
  useEffect(() => {
    if (!returned) return;
    setParams({}, { replace: true });
    api
      .post<{ payment: OnlinePayment }>(`/payments/${returned}/sync`)
      .then((r) => {
        if (r.payment.status === 'paid') toast.success('Pagamento confirmado. Obrigado!');
        else toast.info('Recebemos o seu retorno. Pix e boleto podem levar alguns minutos para confirmar; avisaremos por e-mail.');
        usage.reload();
        history.reload();
        bank.reload();
      })
      .catch(() => toast.info('Não conseguimos confirmar agora. Se você já pagou, a baixa acontece sozinha em instantes.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned]);

  const payOnline = async () => {
    setPaying(true);
    try {
      const r = await api.post<{ payment: OnlinePayment }>('/payments', { scope: 'month', month });
      window.location.href = r.payment.checkout_url!;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.');
      setPaying(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Consumo e faturas" description="Veja quanto do seu plano já foi usado e o que há para pagar em cada mês." />

      <div className="mb-6 flex items-center gap-2">
        <IconButton label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={18} /></IconButton>
        <span className="min-w-[160px] text-center font-display text-[20px] font-medium text-ink">{fmtMonth(month)}</span>
        <IconButton label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={18} /></IconButton>
      </div>

      {usage.error && <ErrorState message={usage.error} onRetry={usage.refetch} />}

      {bank.data && <BankCard id="banco-consumo" balance={bank.data.balance} linkTo="/app/planos" className="mb-6" />}

      {!u ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[130px] rounded-[22px]" />)}</div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Horas reservadas" value={fmtDuration(u.totals.minutes)} hint={`${u.totals.bookings} reserva${u.totals.bookings === 1 ? '' : 's'}`} />
            <Stat label="Total do mês" value={fmtMoney(u.totals.amount_cents)} hint={u.totals.paid_cents > 0 ? `${fmtMoney(u.totals.paid_cents)} já pago` : 'Horas extras além do plano'} tone="clay" />
            <Stat label="A pagar" value={fmtMoney(u.totals.pending_cents)} hint={u.totals.pending_cents > 0 ? (settings?.online_payments ? 'Pague online abaixo' : 'Acerte com a recepção') : 'Tudo em dia'} tone="amber" />
          </div>

          {settings?.online_payments && u.totals.pending_cents > 0 && (
            <Card className="mb-6 border-sage-700/25">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sage-dim text-sage-700"><ShieldCheck size={20} /></span>
                  <div>
                    <p className="font-display text-[18px] leading-tight font-medium text-ink">Pague online, com Pix, cartão ou boleto</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-stone">Ambiente seguro do Pagar.me. Assim que o pagamento é confirmado, a sua fatura é baixada automaticamente.</p>
                  </div>
                </div>
                <Button size="lg" loading={paying} onClick={payOnline} className="shrink-0">Pagar {fmtMoney(u.totals.pending_cents)}</Button>
              </div>
            </Card>
          )}

          {u.plan && (
            <Card className="mb-6">
              <CardHeader title={`Plano ${u.plan.name}`} subtitle={u.plan.room_discount_percent > 0 ? `${u.plan.room_discount_percent}% de desconto nas horas extras` : undefined} />
              {u.plan.unlimited ? (
                <p className="text-[13.5px] text-stone">Uso ilimitado das salas — nenhuma cobrança por horas.</p>
              ) : u.included_total ? (
                <>
                  <div className="mb-2 flex items-baseline justify-between text-[13px] text-stone">
                    <span><strong className="font-display text-[22px] font-medium text-ink">{fmtDuration(u.included_used)}</strong> usadas</span>
                    <span>de {fmtDuration(u.included_total)} incluídas</span>
                  </div>
                  <ProgressBar value={u.included_used} max={u.included_total} tone={(u.included_remaining ?? 0) === 0 ? 'clay' : 'sage'} />
                </>
              ) : (
                <p className="text-[13.5px] text-stone">Este plano não inclui horas; você paga pelo tempo usado.</p>
              )}
            </Card>
          )}

          <h2 className="mb-3 font-display text-[19px] font-medium text-ink">Detalhamento</h2>
          {u.bookings.length === 0 ? (
            <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<Receipt />} title="Nenhuma reserva neste mês" /></div>
          ) : (
            <DataTable>
              <thead><tr><Th>Data</Th><Th>Sala</Th><Th>Duração</Th><Th>No plano</Th><Th className="text-right">Valor</Th><Th>Situação</Th></tr></thead>
              <tbody>
                {u.bookings.map((b) => (
                  <tr key={b.id} onClick={() => setSelected(b)} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                    <Td><span className="font-medium">{fmtDateShort(b.date)}</span> <span className="text-stone-light">{b.start_time}</span></Td>
                    <Td>{b.room.name}</Td>
                    <Td>{fmtDuration(b.total_minutes)}</Td>
                    <Td>
                      {b.included_minutes ? fmtDuration(b.included_minutes) : b.package_minutes ? null : '—'}
                      {b.package_minutes > 0 && <span className="block text-[11.5px] text-sage-700">{fmtDuration(b.package_minutes)} de pacote</span>}
                    </Td>
                    <Td className="text-right font-medium">
                      {b.price_cents ? fmtMoney(b.price_cents) : '—'}
                      {b.overtime_cents > 0 && <span className="block text-[11.5px] font-medium text-rose">+ {fmtMoney(b.overtime_cents)} excedente ({b.overtime_minutes} min)</span>}
                    </Td>
                    <Td>
                      {b.price_cents ? <PaymentBadge status={b.payment_status} /> : <Badge tone="mist">Incluído</Badge>}
                      {b.overtime_cents > 0 && b.overtime_payment_status === 'pending' && <Badge tone="rose" className="mt-1 ml-1.5">Excedente a pagar</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}

      <h2 className="mt-10 mb-3 font-display text-[19px] font-medium text-ink">Faturas anteriores</h2>
      {history.data && history.data.statements.length > 0 ? (
        <DataTable>
          <thead><tr><Th>Mês</Th><Th>Reservas</Th><Th>Horas</Th><Th className="text-right">Total</Th><Th>Situação</Th></tr></thead>
          <tbody>
            {history.data.statements.map((s) => {
              const open = s.amount_cents - s.paid_cents;
              return (
                <tr key={s.month} onClick={() => setMonth(s.month)} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                  <Td className="font-medium">{fmtMonth(s.month)}</Td>
                  <Td>{s.bookings}</Td>
                  <Td>{fmtDuration(s.minutes)}</Td>
                  <Td className="text-right font-medium">{fmtMoney(s.amount_cents)}</Td>
                  <Td>{s.amount_cents === 0 ? <Badge tone="mist">Sem cobrança</Badge> : open > 0 ? <Badge tone="amber">{fmtMoney(open)} em aberto</Badge> : <Badge tone="sage">Quitada</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      ) : (
        <p className="text-[13.5px] text-stone">Suas faturas mensais aparecerão aqui.</p>
      )}

      <BookingDetail booking={selected} onClose={() => setSelected(null)} onChanged={() => { usage.reload(); history.reload(); }} />
    </>
  );
}
