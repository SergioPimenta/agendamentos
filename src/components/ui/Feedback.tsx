import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { DisplayStatus, PaymentStatus, SessionState } from '../../types';
import { Button } from './Button';
import { Modal } from './Modal';

/* ---------- Spinner / Skeleton / Empty ---------- */

export const Spinner = ({ className }: { className?: string }) => (
  <span className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-sage-700 border-t-transparent', className)} role="status" aria-label="Carregando" />
);

export const PageLoader = () => (
  <div className="flex min-h-[40vh] items-center justify-center">
    <Spinner className="h-7 w-7" />
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-shimmer rounded-xl bg-[linear-gradient(90deg,rgba(38,42,34,0.05)_25%,rgba(38,42,34,0.1)_50%,rgba(38,42,34,0.05)_75%)] bg-[length:200%_100%]', className)} />
);

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-dim text-sage-700 [&_svg]:h-6 [&_svg]:w-6">{icon}</div>}
      <h3 className="font-display text-[19px] font-medium text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-[38ch] text-[13.5px] leading-relaxed text-stone">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose/20 bg-rose-dim px-5 py-4 text-[13.5px] text-rose" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/* ---------- Badges ---------- */

type Tone = 'sage' | 'clay' | 'amber' | 'rose' | 'mist' | 'ink';
const tones: Record<Tone, string> = {
  sage: 'bg-sage-dim text-sage-700',
  clay: 'bg-clay-dim text-clay',
  amber: 'bg-amber-dim text-amber',
  rose: 'bg-rose-dim text-rose',
  mist: 'bg-mist-light text-stone',
  ink: 'bg-ink text-cream',
};

export const Badge = ({ tone = 'sage', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap', tones[tone], className)}>
    {children}
  </span>
);

const statusMap: Record<DisplayStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmada', tone: 'sage' },
  pending: { label: 'Aguardando aprovação', tone: 'amber' },
  completed: { label: 'Concluída', tone: 'mist' },
  cancelled: { label: 'Cancelada', tone: 'rose' },
  no_show: { label: 'Não compareceu', tone: 'clay' },
};

export const StatusBadge = ({ status, awaitingPayment }: { status: DisplayStatus; awaitingPayment?: boolean }) =>
  awaitingPayment && status === 'pending' ? (
    <Badge tone="amber">Aguardando pagamento</Badge>
  ) : (
    <Badge tone={statusMap[status].tone}>{statusMap[status].label}</Badge>
  );

const sessionMap: Record<SessionState, { label: string; tone: Tone } | null> = {
  upcoming: null,
  awaiting_checkin: { label: 'Aguardando check-in', tone: 'amber' },
  in_use: { label: 'Em uso', tone: 'clay' },
  overtime: { label: 'Excedendo o horário', tone: 'rose' },
  done: { label: 'Uso encerrado', tone: 'mist' },
  no_checkin: { label: 'Sem check-in', tone: 'clay' },
};

/** Situação do uso da sala (check-in / check-out). Não mostra nada quando ainda não começou. */
export const SessionBadge = ({ state }: { state: SessionState | null }) => {
  const s = state ? sessionMap[state] : null;
  return s ? <Badge tone={s.tone}>{s.label}</Badge> : null;
};

const payMap: Record<PaymentStatus, { label: string; tone: Tone }> = {
  none: { label: 'Sem cobrança', tone: 'mist' },
  pending: { label: 'A pagar', tone: 'amber' },
  paid: { label: 'Pago', tone: 'sage' },
};

export const PaymentBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={payMap[status].tone}>{payMap[status].label}</Badge>
);

/* ---------- Toast ---------- */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string }
interface ToastApi { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

const ToastContext = createContext<ToastApi>({ success() {}, error() {}, info() {} });
export const useToast = () => useContext(ToastContext);

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const iconColor = { success: 'text-sage-700', error: 'text-rose', info: 'text-stone' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3800);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[300] flex flex-col items-center gap-2.5 sm:left-auto sm:items-end" aria-live="polite">
        {items.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className="animate-pop pointer-events-auto flex max-w-[420px] items-start gap-3 rounded-2xl border border-ink/10 bg-cream px-4 py-3.5 shadow-[0_20px_40px_-16px_rgba(44,54,39,0.4)]">
              <Icon size={19} className={cn('mt-px shrink-0', iconColor[t.kind])} />
              <p className="text-[13.5px] leading-snug text-ink">{t.message}</p>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Confirm ---------- */

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2.5">
            {state?.tone === 'danger' && <AlertTriangle size={20} className="text-rose" />}
            {state?.title}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>{state?.cancelLabel ?? 'Voltar'}</Button>
            <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="text-[14px] leading-relaxed text-stone">{state?.description}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
