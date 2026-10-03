import { describe, expect, it } from 'vitest';

import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import { basisPoints } from '@/lib/money';

const fmt = (value: number) => formatBasisPoints(basisPoints(value));

describe('formatBasisPoints', () => {
  it('positivos: duas casas, parte inteira sem zero a esquerda', () => {
    // 8000 bp = 80 % + 0 bp; 50 = 0 % + 50; 1 = 0 % + 1; 12345 = 123 % + 45.
    expect(fmt(8000)).toBe('80,00%');
    expect(fmt(50)).toBe('0,50%');
    expect(fmt(1)).toBe('0,01%');
    expect(fmt(12_345)).toBe('123,45%');
    expect(fmt(10_000)).toBe('100,00%');
  });

  it('zero sem sinal', () => {
    expect(fmt(0)).toBe('0,00%');
  });

  it('negativos entre -1 e -99 bp mantem o sinal (o bug do trunc)', () => {
    // -50 bp = -0,50 %. Antes saia '0,50%': trunc(-0,5) = -0 e String(-0) = '0'.
    expect(fmt(-50)).toBe('-0,50%');
    expect(fmt(-1)).toBe('-0,01%');
    expect(fmt(-99)).toBe('-0,99%');
  });

  it('negativos com parte inteira: espelho exato do positivo', () => {
    // -150 bp = -1,50 % (a copia de kpis-row, com floor, dava '-2,50%').
    expect(fmt(-150)).toBe('-1,50%');
    expect(fmt(-100)).toBe('-1,00%');
    expect(fmt(-12_345)).toBe('-123,45%');
  });

  it('todo negativo e o positivo com "-" na frente', () => {
    for (let value = 1; value <= 20_000; value += 1) {
      expect(fmt(-value)).toBe(`-${fmt(value)}`);
    }
  });
});
