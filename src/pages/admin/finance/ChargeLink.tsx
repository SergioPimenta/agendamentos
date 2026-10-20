import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Feedback';
import { Modal } from '../../../components/ui/Modal';
import { fmtMoney } from '../../../lib/format';
import type { OnlinePayment } from '../../../types';

/** Mostra o link de pagamento gerado, para copiar ou mandar pelo WhatsApp. */
export function ChargeLinkModal({ payment, phone, onClose }: { payment: OnlinePayment; phone?: string; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const link = payment.checkout_url ?? '';
  const digits = (phone ?? '').replace(/\D/g, '');
  const wa = digits.length >= 10 ? `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}?text=${encodeURIComponent(`Olá! Segue o link para pagar ${payment.description} (${fmtMoney(payment.amount_cents)}): ${link}`)}` : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Link de pagamento"
      subtitle={`${payment.user_name ? `${payment.user_name} · ` : ''}${payment.description}`}
      footer={
        <>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 px-5 py-2 text-[12.5px] font-semibold text-ink no-underline transition-colors hover:border-sage-700 hover:bg-sage-dim"><MessageCircle size={15} />Enviar por WhatsApp</a>}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-2xl bg-sage-dim px-4 py-3 text-center font-display text-[26px] font-medium text-ink">{fmtMoney(payment.amount_cents)}</p>
        <div className="flex gap-2">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de pagamento" className="min-w-0 flex-1 rounded-xl border border-ink/12 bg-sand/50 px-3.5 py-2.5 text-[13px] text-ink outline-none" />
          <Button size="sm" variant="soft" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</Button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-stone">
          O cliente escolhe Pix, cartão ou boleto na página do Pagar.me. Quando o pagamento é confirmado, a fatura é baixada sozinha e entra no fluxo de caixa.
          {payment.expires_at && ` O link vale até ${payment.expires_at.slice(8, 10)}/${payment.expires_at.slice(5, 7)} às ${payment.expires_at.slice(11, 16)}.`}
        </p>
      </div>
    </Modal>
  );
}
