import { Badge } from '../ui/Feedback';
import type { ContractStatus } from '../../types';

/** Etiqueta da situação de um contrato. */
export const contractBadge = (s: ContractStatus) =>
  s === 'active' ? <Badge tone="sage">Vigente</Badge>
    : s === 'ending' ? <Badge tone="amber">Vence em breve</Badge>
      : s === 'ended' ? <Badge tone="mist">Encerrado</Badge>
        : <Badge tone="rose">Inativo</Badge>;
