import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/Form';
import { Modal } from '../../../components/ui/Modal';
import { cn } from '../../../lib/cn';
import { fmtDateFull, fmtMoney, todayStr } from '../../../lib/format';
import type { FinStatus, PayMethod } from '../../../types';

export const METHOD_LABEL: Record<PayMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  outro: 'Outro',
};
export const METHODS = Object.keys(METHOD_LABEL) as PayMethod[];

export const PAYABLE_CATEGORIES = [
  'Aluguel', 'Condomínio', 'Energia', 'Água', 'Internet e telefone', 'Limpeza', 'Manutenção', 'Marketing',
  'Impostos e taxas', 'Software e assinaturas', 'Pessoal', 'Material de consumo', 'Outros',
];
export const RECEIVABLE_CATEGORIES = ['Mensalidade de plano', 'Taxa/serviço', 'Venda de produto', 'Outros'];

export const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);
export const moneyInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export const methodLabel = (m: PayMethod | null | undefined) => (m ? METHOD_LABEL[m] ?? m : '—');

const STATUS: Record<FinStatus, { label: string; tone: 'amber' | 'rose' | 'sage' }> = {
  open: { label: 'Em aberto', tone: 'amber' },
  overdue: { label: 'Vencida', tone: 'rose' },
  paid: { label: 'Paga', tone: 'sage' },
};

export const FinBadge = ({ status, paidLabel }: { status: FinStatus; paidLabel?: string }) => (
  <Badge tone={STATUS[status].tone}>{status === 'paid' && paidLabel ? paidLabel : STATUS[status].label}</Badge>
);

/** Vencimento com destaque para o que já passou. */
export const DueDate = ({ date, status }: { date: string; status: FinStatus }) => (
  <span className={cn('whitespace-nowrap', status === 'overdue' && 'font-semibold text-rose')}>{fmtDateFull(date)}</span>
);

/** Confirma um pagamento/recebimento: forma e data (padrão: hoje). */
export function PayModal({
  open, title, amount_cents, subtitle, confirmLabel, busy, onClose, onConfirm,
}: {
  open: boolean; title: string; subtitle?: string; amount_cents: number; confirmLabel: string; busy?: boolean;
  onClose: () => void; onConfirm: (v: { method: PayMethod; date: string }) => void;
}) {
  const [method, setMethod] = useState<PayMethod>('pix');
  const [date, setDate] = useState(todayStr());

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      locked={busy}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Voltar</Button>
          <Button loading={busy} onClick={() => onConfirm({ method, date })}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-2xl bg-sage-dim px-4 py-3 text-center font-display text-[26px] font-medium text-ink">{fmtMoney(amount_cents)}</p>
        <Select label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
          {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
        </Select>
        <Input label="Data do pagamento" type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} hint="É a data usada no fluxo de caixa." />
      </div>
    </Modal>
  );
}

export const Money = ({ cents, className }: { cents: number; className?: string }) => <span className={cn('whitespace-nowrap tabular-nums', className)}>{fmtMoney(cents)}</span>;
