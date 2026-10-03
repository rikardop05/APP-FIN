import { basisPoints, type BasisPoints } from '@/lib/money';

/**
 * Basis points como percentual pt-BR, sempre com duas casas: 8000 bp -> `80,00%`,
 * -50 bp -> `-0,50%`, -150 bp -> `-1,50%`, 0 -> `0,00%`. Apresentação apenas:
 * a decisão (cor, "estourado") vem do motor, que usa o MESMO inteiro.
 *
 * O sinal é explícito e sai do valor inteiro, não da parte inteira: com
 * `Math.trunc(bp / 100)`, -50 bp dava parte inteira `-0`, que vira `"0"` na
 * string, e o resultado era `0,50%` — o menos sumia entre -1 e -99 bp. Zero
 * nunca recebe sinal (`-0,00%` não existe).
 *
 * É o formatador de bp do sistema; quem precisa de "X,YY%" importa daqui. Não
 * restam cópias locais. A variação de gastos (`spending-by-category.tsx`) tem
 * formato próprio, com `+`/`−` e tom de cor, e não é cópia deste.
 */
export function formatBasisPoints(value: BasisPoints): string {
  const bp = basisPoints(value);
  const sign = bp < 0 ? '-' : '';
  const absolute = Math.abs(bp);
  const fraction = absolute % 100;
  const whole = (absolute - fraction) / 100;
  return `${sign}${String(whole)},${String(fraction).padStart(2, '0')}%`;
}
