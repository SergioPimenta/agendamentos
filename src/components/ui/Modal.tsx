import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Quando `true`, impede fechar por Esc/clique fora (ex.: durante envio). */
  locked?: boolean;
}

const sizes = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', locked }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbar}px`;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) closeRef.current();
      if (e.key === 'Tab' && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      previous?.focus?.();
    };
  }, [open, locked]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div
        className="animate-fade-in absolute inset-0 bg-sage-900/45 backdrop-blur-[3px]"
        onClick={() => !locked && onClose()}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'animate-sheet sm:animate-pop relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-cream shadow-[0_40px_80px_-20px_rgba(44,54,39,0.5)] outline-none sm:rounded-[28px]',
          sizes[size],
        )}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-4 border-b border-ink/8 px-6 pt-5 pb-4 sm:px-8 sm:pt-6">
            <div className="min-w-0">
              {title && <h2 className="font-display text-[22px] leading-tight font-medium text-ink">{title}</h2>}
              {subtitle && <p className="mt-1 text-[13px] text-stone">{subtitle}</p>}
            </div>
            <IconButton label="Fechar" onClick={onClose} disabled={locked} className="-mr-2 shrink-0">
              <X size={18} />
            </IconButton>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2.5 border-t border-ink/8 bg-sand/60 px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-8">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
