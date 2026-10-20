import type { ReactNode } from 'react';
import { CalendarX2, Gift, Package } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fmtDateFull, fmtDuration } from '../../lib/format';
import type { LotSource, PackageLot } from '../../types';
import { Badge } from '../ui/Feedback';

export const SOURCE_LABEL: Record<LotSource, string> = {
  package: 'Pacote comprado',
  cancellation: 'Reserva cancelada',
  manual: 'Ajuste da recepção',
};

const SOURCE_ICON: Record<LotSource, ReactNode> = {
  package: <Package size={16} />,
  cancellation: <CalendarX2 size={16} />,
  manual: <Gift size={16} />,
};

const SOURCE_TONE: Record<LotSource, 'sage' | 'clay' | 'amber'> = { package: 'sage', cancellation: 'clay', manual: 'amber' };

/** "Reserva HZ-ABC · Sala Brisa · 12/11/2026 14:00" — o que explica de onde veio o lote. */
export function lotDetail(l: PackageLot) {
  if (l.source === 'cancellation') {
    const b = l.origin_booking;
    return b ? `Reserva ${b.code} · ${b.room} · ${fmtDateFull(b.date)} ${b.start_time}` : l.note;
  }
  if (l.source === 'manual') return l.note;
  return `Comprado em ${fmtDateFull(l.created_at.slice(0, 10))}`;
}

export function SourceBadge({ source }: { source: LotSource }) {
  return <Badge tone={SOURCE_TONE[source]}>{SOURCE_ICON[source]}{SOURCE_LABEL[source]}</Badge>;
}

/** Quantos dias faltam para vencer (null = sem validade). */
const daysLeft = (expires: string | null, today: string) =>
  expires ? Math.round((new Date(`${expires}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000) : null;

export function ExpiryText({ expires, today }: { expires: string | null; today: string }) {
  const d = daysLeft(expires, today);
  if (d == null) return <span className="text-stone-light">sem validade</span>;
  return (
    <span className={cn(d <= 7 ? 'font-semibold text-rose' : d <= 30 ? 'text-amber' : 'text-stone-light')}>
      vale até {fmtDateFull(expires!)}{d <= 30 ? ` (${d <= 0 ? 'último dia' : d === 1 ? 'falta 1 dia' : `faltam ${d} dias`})` : ''}
    </span>
  );
}

/** Lista de lotes: origem, detalhe, o que resta e a validade. `action` desenha um botão por lote (administração). */
export function BankLots({ lots, today, action, className }: { lots: PackageLot[]; today: string; action?: (lot: PackageLot) => ReactNode; className?: string }) {
  return (
    <ul className={cn('flex flex-col divide-y divide-ink/8', className)}>
      {lots.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1 basis-[220px]">
            <div className="flex flex-wrap items-center gap-2"><SourceBadge source={l.source} /><span className="text-[13.5px] font-semibold text-ink">{l.name}</span></div>
            <p className="mt-1 text-[12.5px] leading-snug text-stone">{lotDetail(l)}</p>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-semibold text-ink">{fmtDuration(l.remaining)}{l.remaining !== l.minutes_total && <span className="font-normal text-stone-light"> de {fmtDuration(l.minutes_total)}</span>}</p>
            <p className="text-[12px]"><ExpiryText expires={l.expires_at} today={today} /></p>
          </div>
          {action && <div className="shrink-0">{action(l)}</div>}
        </li>
      ))}
    </ul>
  );
}
