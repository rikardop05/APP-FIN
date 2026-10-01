import { basisPoints, type BasisPoints } from '@/lib/money';

/**
 * Basis points como percentual pt-BR: 8000 bp -> `80,00%`. Apresentação apenas:
 * a decisão (cor, "estourado") vem do motor, que usa o MESMO inteiro.
 *
 * Existem cópias locais deste formatador em `commitment-section.tsx`,
 * `kpis-row.tsx` e `pendencias-list.tsx`; esta é a que o orçamento usa.
 */
export function formatBasisPoints(value: BasisPoints): string {
  const bp = basisPoints(value);
  const whole = Math.trunc(bp / 100);
  const fraction = Math.abs(bp % 100);
  return `${whole},${String(fraction).padStart(2, '0')}%`;
}
