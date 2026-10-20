import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

/** Logo oficial (mesma imagem do site). Em fundos escuros vai sobre um cartão creme para manter o contraste. */
export const BrandLogo = ({
  className,
  dark = false,
  to = '/',
  size = 'md',
}: {
  className?: string;
  dark?: boolean;
  to?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) => (
  <Link
    to={to}
    className={cn(
      'group inline-flex shrink-0 items-center no-underline',
      dark && 'rounded-2xl bg-cream px-3 py-2',
      className,
    )}
    aria-label="Harmonize o Ser, início"
  >
    <img
      src="/assets/harmonizeoser-logo-full.png"
      alt="Harmonize o Ser"
      className={cn(
        'w-auto transition-transform duration-500 ease-out group-hover:animate-sway',
        size === 'xs' && 'h-12',
        size === 'sm' && 'h-16',
        size === 'md' && 'h-24',
        size === 'lg' && 'h-32',
      )}
    />
  </Link>
);
