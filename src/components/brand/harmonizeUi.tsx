import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useScrollReveal } from '../../hooks/useScrollReveal';

/** Faz o conteúdo entrar suavemente ao cruzar a viewport, uma única vez. */
export const Reveal = ({
  children,
  delay = 0,
  as: Tag = 'div',
  className,
}: {
  children: ReactNode;
  delay?: number;
  as?: 'div' | 'span';
  className?: string;
}) => {
  const { ref, visible } = useScrollReveal();

  return (
    <Tag
      ref={ref as never}
      className={cn('reveal', visible && 'reveal-in', className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
};

export const Eyebrow = ({
  children,
  center = false,
  tone = 'sage',
  className,
}: {
  children: ReactNode;
  center?: boolean;
  tone?: 'sage' | 'cream';
  className?: string;
}) => (
  <div
    className={cn(
      'mb-4 flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase',
      tone === 'cream' ? 'text-sage-light' : 'text-sage-700',
      center && 'justify-center',
      className,
    )}
  >
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-sage" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sage-700" />
    </span>
    {children}
  </div>
);

export const Heading = ({
  children,
  className,
  as: Tag = 'h2',
  tone = 'ink',
}: {
  children: ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
  tone?: 'ink' | 'cream';
}) => (
  <Tag
    className={cn(
      'font-display text-[clamp(2.1rem,4vw,3.4rem)] leading-[1.06] font-medium tracking-[-0.02em]',
      tone === 'cream' ? 'text-cream' : 'text-ink',
      className,
    )}
  >
    {children}
  </Tag>
);

export const Lead = ({
  children,
  className,
  tone = 'stone',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'stone' | 'cream';
}) => (
  <p
    className={cn(
      'max-w-[46ch] text-[16.5px] leading-[1.75] font-light',
      tone === 'cream' ? 'text-cream/70' : 'text-stone',
      className,
    )}
  >
    {children}
  </p>
);

export const BtnSage = ({
  href,
  onClick,
  children,
  className,
  type = 'link',
  tone = 'dark',
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  type?: 'link' | 'button';
  /** 'dark' = fundo verde/texto creme (padrão); 'light' = fundo creme/texto verde, para usar sobre fundos escuros. */
  tone?: 'dark' | 'light';
}) => {
  const classes = cn(
    'group inline-flex items-center justify-center gap-2.5 rounded-full px-7 py-3.5 text-[13.5px] font-semibold tracking-wide whitespace-nowrap no-underline transition-all duration-300',
    'hover:-translate-y-0.5',
    tone === 'light'
      ? 'bg-cream text-sage-900 hover:bg-cream/85 hover:shadow-[0_16px_32px_-12px_rgba(0,0,0,0.3)]'
      : 'bg-sage-700 text-cream hover:bg-sage-900 hover:shadow-[0_16px_32px_-12px_rgba(44,54,39,0.45)]',
    '[&_svg]:transition-transform [&_svg]:duration-300 group-hover:[&_svg]:translate-x-1',
    className,
  );

  if (type === 'button') {
    return (
      <button type="button" onClick={onClick} className={cn(classes, 'cursor-pointer')}>
        {children}
      </button>
    );
  }

  return (
    <a href={href} className={classes}>
      {children}
    </a>
  );
};

export const BtnGhost = ({
  href,
  onClick,
  children,
  className,
  type = 'link',
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  type?: 'link' | 'button';
}) => {
  const classes = cn(
    'inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 px-7 py-3.5 text-[13.5px] font-medium whitespace-nowrap text-ink no-underline transition-all duration-300',
    'hover:border-sage-700 hover:bg-sage-dim',
    className,
  );

  if (type === 'button') {
    return (
      <button type="button" onClick={onClick} className={cn(classes, 'cursor-pointer')}>
        {children}
      </button>
    );
  }

  return (
    <a href={href} className={classes}>
      {children}
    </a>
  );
};

export const IconTile = ({
  children,
  className,
  size = 'md',
}: {
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) => {
  const sizes = {
    sm: 'h-9 w-9 rounded-[10px] [&_svg]:h-4 [&_svg]:w-4',
    md: 'h-12 w-12 rounded-xl [&_svg]:h-5 [&_svg]:w-5',
    lg: 'h-14 w-14 rounded-2xl [&_svg]:h-6 [&_svg]:w-6',
  };

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-sage-dim text-sage-700',
        sizes[size],
        className,
      )}
    >
      {children}
    </div>
  );
};

/** Composição decorativa inspirada no dossel de círculos sobrepostos da marca. */
export const CanopyMotif = ({
  className,
  style,
  muted = false,
}: {
  className?: string;
  style?: CSSProperties;
  muted?: boolean;
}) => (
  <div className={cn('pointer-events-none absolute', className)} style={style} aria-hidden>
    <div className="relative h-full w-full">
      <span
        className={cn(
          'absolute top-0 left-[18%] h-[62%] w-[62%] animate-float-a rounded-full',
          muted ? 'bg-mist/50' : 'bg-sage/18',
        )}
      />
      <span
        className={cn(
          'absolute top-[14%] left-0 h-[55%] w-[55%] animate-float-b rounded-full [animation-delay:1.2s]',
          muted ? 'bg-mist/40' : 'bg-sage-light/25',
        )}
      />
      <span
        className={cn(
          'absolute right-0 bottom-0 h-[58%] w-[58%] animate-float-a rounded-full [animation-delay:2.4s]',
          muted ? 'bg-mist/60' : 'bg-sage-700/12',
        )}
      />
    </div>
  </div>
);
