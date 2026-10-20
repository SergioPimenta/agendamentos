import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtDuration, todayStr } from '../../lib/format';
import type { ClientPackages } from '../../types';
import { BankLots } from './BankLots';

/**
 * Banco de horas do cliente: total disponível e, abaixo, de onde vem cada saldo.
 * `limit` mostra só os primeiros lotes (com um "ver todos"); `linkTo` leva à página completa.
 */
export function BankCard({
  balance, limit, linkTo, id, className,
}: { balance: ClientPackages['balance']; limit?: number; linkTo?: string; id?: string; className?: string }) {
  const lots = limit ? balance.lots.slice(0, limit) : balance.lots;
  const hidden = balance.lots.length - lots.length;

  return (
    <section className={cn('rounded-[24px] border border-sage-700/25 bg-cream p-6 sm:p-8', className)} aria-labelledby={id}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage-dim text-sage-700"><Hourglass size={22} /></span>
        <div className="min-w-0 flex-1 basis-[220px]">
          <h2 id={id} className="font-display text-[22px] leading-tight font-medium text-ink">Seu banco de horas</h2>
          <p className="mt-0.5 text-[13.5px] text-stone">Horas guardadas para usar em qualquer sala. São descontadas sozinhas nas suas reservas.</p>
        </div>
        <div className="text-right">
          <p className="font-display text-[30px] leading-none font-medium text-ink">{fmtDuration(balance.minutes_available)}</p>
          <p className="mt-1 text-[11.5px] tracking-[0.1em] text-stone uppercase">disponíveis</p>
        </div>
      </div>

      {lots.length > 0 ? (
        <div className="mt-5 border-t border-ink/8 pt-5">
          <p className="mb-3 text-[11.5px] font-semibold tracking-[0.12em] text-stone uppercase">De onde vem o seu saldo</p>
          <BankLots lots={lots} today={todayStr()} />
          {(hidden > 0 || linkTo) && (
            <p className="mt-4 text-[13px]">
              {hidden > 0 && <span className="mr-2 text-stone">+ {hidden} lote{hidden === 1 ? '' : 's'}</span>}
              {linkTo && <Link to={linkTo} className="font-semibold text-sage-700 no-underline hover:underline">{hidden > 0 ? 'Ver todos →' : 'Ver detalhes e pacotes →'}</Link>}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[13.5px] leading-relaxed text-stone">
          Seu banco está vazio. As horas de uma reserva paga que você cancelar e os pacotes que comprar aparecem aqui.
          {linkTo && <> <Link to={linkTo} className="font-semibold text-sage-700">Conheça os pacotes</Link>.</>}
        </p>
      )}
    </section>
  );
}
