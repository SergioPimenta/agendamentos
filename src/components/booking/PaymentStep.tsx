import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { AlertCircle, ArrowLeft, CalendarDays, Check, Clock, Copy, CreditCard, Lock, QrCode, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';
import {
  isValidCardNumber, isValidDocument, isValidPhone, maskCardNumber, maskDocument, maskExpiry, maskPhone, onlyDigits, parseExpiry,
} from '../../lib/documents';
import { fmtDateLong, fmtDuration, fmtMoney, toMin } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking, OnlinePayment, PaymentConfig } from '../../types';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Form';
import { useToast } from '../ui/Feedback';

interface Props {
  booking: Booking;
  config: PaymentConfig;
  /** O pagamento caiu e a reserva foi confirmada. */
  onConfirmed: (b: Booking) => void;
  /** Voltar ao formulário (o horário é liberado). */
  onBack: () => void;
  /** O prazo para pagar acabou. */
  onExpired: () => void;
  /** Avisa o modal para não deixar fechar enquanto o cartão está sendo processado. */
  onBusy: (busy: boolean) => void;
  /** Uma coluna só (para caber em espaços estreitos, como o painel da página da sala). */
  compact?: boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Gera o token do cartão direto no Pagar.me (com a chave pública). Os dados do cartão nunca passam pelo nosso servidor. */
async function tokenizeCard(publicKey: string, card: { number: string; holder: string; expiry: string; cvv: string }) {
  const exp = parseExpiry(card.expiry)!;
  let res: Response;
  try {
    res = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', card: { number: onlyDigits(card.number), holder_name: card.holder.trim(), exp_month: exp.month, exp_year: exp.year, cvv: card.cvv } }),
    });
  } catch {
    throw new Error('Não foi possível validar o cartão agora. Se o problema continuar, avise a recepção (o endereço do site precisa estar cadastrado no Pagar.me).');
  }
  const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok || !json?.id) throw new Error('O cartão não foi aceito. Confira o número, a validade e o código de segurança.');
  return json.id;
}

export function PaymentStep({ booking, config, onConfirmed, onBack, onExpired, onBusy, compact }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const hasCard = config.methods.includes('credit_card') && !!config.public_key;
  const hasPix = config.methods.includes('pix');
  const [tab, setTab] = useState<'pix' | 'card'>(hasPix ? 'pix' : 'card');
  const [doc, setDoc] = useState(maskDocument(user?.document ?? ''));
  const [phone, setPhone] = useState(maskPhone(user?.phone ?? ''));
  const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '' });
  const [installments, setInstallments] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<OnlinePayment | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [copied, setCopied] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [left, setLeft] = useState(config.hold_minutes * 60);

  const price = booking.price_cents;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => onBusy(busy || processing), [busy, processing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contagem regressiva do horário segurado.
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      toast.error('O tempo para pagar acabou e o horário foi liberado. Escolha o horário de novo.');
      onExpired();
    }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  // QR code do Pix desenhado aqui mesmo (sem imagem externa).
  useEffect(() => {
    if (!pix?.pix_qr_code) return;
    QRCode.toDataURL(pix.pix_qr_code, { width: 240, margin: 1 }).then(setQrImage).catch(() => setQrImage(''));
  }, [pix?.pix_qr_code]);

  // Enquanto espera o Pix (ou o processamento do cartão), pergunta ao servidor a cada 4 s.
  const polling = !!pix || processing;
  const paymentId = useRef<number | null>(null);
  paymentId.current = pix?.id ?? paymentId.current;
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(async () => {
      if (!paymentId.current) return;
      try {
        const r = await api.post<{ payment: OnlinePayment; booking: Booking | null }>(`/payments/${paymentId.current}/sync`);
        if (!alive.current) return;
        if (r.payment.status === 'paid' && r.booking) onConfirmed(r.booking);
        else if (r.payment.status === 'failed' || r.payment.status === 'canceled') {
          setProcessing(false);
          setError('O pagamento não foi aprovado. Tente outra forma de pagamento.');
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 4000);
    return () => clearInterval(t);
  }, [polling]); // eslint-disable-line react-hooks/exhaustive-deps

  const identityError = useMemo(() => {
    if (!isValidDocument(doc)) return 'Informe um CPF ou CNPJ válido.';
    if (!isValidPhone(phone)) return 'Informe um celular com DDD.';
    return '';
  }, [doc, phone]);

  const generatePix = async () => {
    setError('');
    if (identityError) return setError(identityError);
    setBusy(true);
    try {
      const r = await api.post<{ payment: OnlinePayment; booking: Booking }>('/payments/booking', { booking_id: booking.id, method: 'pix', document: doc, phone });
      setPix(r.payment);
      if (r.payment.status === 'paid') onConfirmed(r.booking);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar o Pix.');
    } finally {
      setBusy(false);
    }
  };

  const payCard = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (identityError) return setError(identityError);
    if (!isValidCardNumber(card.number)) return setError('O número do cartão parece incorreto.');
    if (card.holder.trim().length < 3) return setError('Informe o nome como está no cartão.');
    if (!parseExpiry(card.expiry)) return setError('A validade do cartão é inválida ou está vencida.');
    if (!/^\d{3,4}$/.test(card.cvv)) return setError('O código de segurança deve ter 3 ou 4 números.');
    setBusy(true);
    try {
      const token = await tokenizeCard(config.public_key!, card);
      setCard({ number: '', holder: card.holder, expiry: '', cvv: '' }); // não guarda dados do cartão na tela depois de usar
      const r = await api.post<{ payment: OnlinePayment; booking: Booking }>('/payments/booking', {
        booking_id: booking.id, method: 'credit_card', card_token: token, installments, document: doc, phone,
      });
      if (r.payment.status === 'paid') onConfirmed(r.booking);
      else { paymentId.current = r.payment.id; setProcessing(true); } // em análise: acompanha por polling
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível processar o pagamento.');
    } finally {
      setBusy(false);
    }
  };

  const copyPix = async () => {
    if (!pix?.pix_qr_code) return;
    try {
      await navigator.clipboard.writeText(pix.pix_qr_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o código e copie manualmente.');
    }
  };

  const minutes = toMin(booking.end_time) - toMin(booking.start_time);

  return (
    <div className={compact ? 'flex flex-col gap-6' : 'grid gap-7 md:grid-cols-[1fr_250px]'}>
      <div className="flex flex-col gap-5">
        <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
          <Input label="CPF ou CNPJ" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={doc} onChange={(e) => setDoc(maskDocument(e.target.value))} />
          <Input label="Celular" required type="tel" autoComplete="tel" placeholder="(41) 99999-9999" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
        </div>

        {hasPix && hasCard && (
          <div role="tablist" className="inline-flex w-fit rounded-full border border-ink/10 bg-cream p-1">
            {([['pix', 'Pix', <QrCode key="q" size={15} />], ['card', 'Cartão de crédito', <CreditCard key="c" size={15} />]] as const).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => { setTab(id); setError(''); }}
                disabled={processing}
                className={cn('inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors', tab === id ? 'bg-sage-700 text-cream' : 'text-stone hover:text-ink')}
              >
                {icon}{label}
              </button>
            ))}
          </div>
        )}

        {tab === 'pix' && hasPix && (
          pix?.pix_qr_code ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink/8 p-5 text-center">
              {qrImage && <img src={qrImage} alt="QR code do Pix" className="h-[220px] w-[220px] rounded-xl border border-ink/10 bg-white p-2" />}
              <p className="text-[13px] leading-relaxed text-stone">Abra o app do seu banco, escolha <strong className="text-ink">Pix → Ler QR code</strong> e aponte para a imagem. Ou use o código abaixo em "Pix copia e cola".</p>
              <div className="flex w-full gap-2">
                <input readOnly value={pix.pix_qr_code} aria-label="Pix copia e cola" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-ink/12 bg-sand/50 px-3 py-2 font-mono text-[11.5px] text-ink outline-none" />
                <Button size="sm" variant="soft" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copyPix}>{copied ? 'Copiado' : 'Copiar'}</Button>
              </div>
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-sage-700"><span className="h-2 w-2 animate-pulse rounded-full bg-sage-700" />Aguardando o pagamento… a reserva confirma sozinha.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-ink/8 p-5">
              <p className="text-[13.5px] leading-relaxed text-stone">Você paga na hora pelo app do seu banco, em qualquer dia e horário. A reserva é confirmada assim que o Pix for reconhecido.</p>
              <Button className="mt-4" size="lg" loading={busy} icon={<QrCode size={18} />} onClick={generatePix}>Gerar QR code Pix</Button>
            </div>
          )
        )}

        {tab === 'card' && hasCard && (
          <form onSubmit={payCard} className="flex flex-col gap-4 rounded-2xl border border-ink/8 p-5" noValidate>
            <Input label="Número do cartão" required inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" value={card.number} onChange={(e) => setCard({ ...card, number: maskCardNumber(e.target.value) })} disabled={processing} />
            <Input label="Nome impresso no cartão" required autoComplete="cc-name" value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value.replace(/[^A-Za-zÀ-ÿ ]/g, '').toUpperCase() })} disabled={processing} />
            <div className={cn('grid gap-4', !compact && 'sm:grid-cols-3')}>
              <Input label="Validade" required inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: maskExpiry(e.target.value) })} disabled={processing} />
              <Input label="Código (CVV)" required inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={card.cvv} onChange={(e) => setCard({ ...card, cvv: onlyDigits(e.target.value).slice(0, 4) })} disabled={processing} />
              {config.max_installments > 1 && (
                <Select label="Parcelas" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} disabled={processing}>
                  {Array.from({ length: config.max_installments }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x de {fmtMoney(Math.ceil(price / n))}{n > 1 ? ' sem juros' : ''}</option>)}
                </Select>
              )}
            </div>
            <Button type="submit" size="lg" loading={busy || processing} icon={<Lock size={16} />}>{processing ? 'Confirmando pagamento…' : `Pagar ${fmtMoney(price)}`}</Button>
          </form>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>
        )}

        <button type="button" onClick={onBack} disabled={busy || processing} className="inline-flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold text-stone hover:text-ink disabled:opacity-50">
          <ArrowLeft size={15} />Voltar e liberar o horário
        </button>
      </div>

      <aside className={cn('flex flex-col gap-4 self-start rounded-[20px] bg-sand p-5', compact ? 'order-first w-full' : 'md:sticky md:top-0')}>
        <h3 className="font-display text-[16px] font-medium text-ink">Sua reserva</h3>
        <dl className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-start gap-2.5 text-stone"><CalendarDays size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{booking.room.name}<br />{fmtDateLong(booking.date)}</dd></div>
          <div className="flex items-start gap-2.5 text-stone"><Clock size={16} className="mt-0.5 shrink-0 text-sage-700" /><dd className="text-ink">{booking.start_time} às {booking.end_time} · {fmtDuration(minutes)}</dd></div>
        </dl>
        <div className="border-t border-ink/10 pt-4">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-stone uppercase">Total</p>
          <p className="mt-1 font-display text-[28px] leading-none font-medium text-ink">{fmtMoney(price)}</p>
        </div>
        <p className={cn('rounded-xl px-3 py-2.5 text-[12px] leading-snug', left <= 120 ? 'bg-rose-dim text-rose' : 'bg-amber-dim text-amber')}>
          Horário guardado para você por <strong>{mmss(Math.max(0, left))}</strong>. Depois disso ele é liberado.
        </p>
        <p className="flex items-start gap-2 text-[11.5px] leading-snug text-stone-light"><ShieldCheck size={14} className="mt-px shrink-0" />Pagamento processado pelo Pagar.me. Os dados do cartão não passam pelo nosso sistema.</p>
      </aside>
    </div>
  );
}
