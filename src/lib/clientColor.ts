/**
 * Cor de cada cliente na agenda. A mesma pessoa tem sempre a mesma cor, em qualquer dia ou visão.
 *
 * São 12 matizes bem espaçados (30° entre cada um). Os ids são embaralhados (passo 5) para que clientes
 * cadastrados em sequência não fiquem com cores vizinhas. A partir do 13º cliente a cor se repete numa
 * "camada" mais escura, então nunca são duas pessoas com exatamente o mesmo tom.
 */
export type BookingTone = 'confirmed' | 'pending' | 'done' | 'noshow';

const SLOTS = 12;

export function clientHue(userId: number) {
  const slot = ((userId % SLOTS) * 5) % SLOTS;
  return slot * 30 + 10;
}

/** 0 = camada normal, 1 = camada mais escura (clientes 13 a 24, 37 a 48…). */
const ring = (userId: number) => Math.floor(userId / SLOTS) % 2;

export interface EventColors {
  background: string;
  border: string;
  accent: string;
  text: string;
  dashed?: boolean;
}

export function eventColors(userId: number, tone: BookingTone): EventColors {
  const h = clientHue(userId);
  const dark = ring(userId) === 1;
  const L = (n: number) => (dark ? n - 7 : n); // clareza mais baixa na segunda camada
  switch (tone) {
    case 'done': // já passou: mesma cor, mais suave
      return { background: `hsl(${h} 40% ${L(90)}%)`, border: `hsl(${h} 32% ${L(74)}%)`, accent: `hsl(${h} 42% ${L(54)}%)`, text: `hsl(${h} 35% 24%)` };
    case 'pending': // aguardando aprovação: tracejado
      return { background: `hsl(${h} 45% ${L(96)}%)`, border: `hsl(${h} 58% 46%)`, accent: `hsl(${h} 58% 46%)`, text: `hsl(${h} 55% 17%)`, dashed: true };
    case 'noshow': // faltou: apagado
      return { background: `hsl(${h} 12% ${L(91)}%)`, border: `hsl(${h} 12% 74%)`, accent: `hsl(${h} 12% 58%)`, text: `hsl(${h} 10% 36%)` };
    default: // confirmada / em andamento / futura
      return { background: `hsl(${h} 58% ${L(82)}%)`, border: `hsl(${h} 48% ${L(58)}%)`, accent: `hsl(${h} 60% ${L(38)}%)`, text: `hsl(${h} 65% 14%)` };
  }
}

/** Cor "cheia" para pontinhos e legendas. */
export const clientSwatch = (userId: number) => `hsl(${clientHue(userId)} 58% ${ring(userId) ? 36 : 45}%)`;
