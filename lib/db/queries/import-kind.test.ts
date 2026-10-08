import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { kindForAmount } from './import-kind';

describe('kind do lançamento importado a partir do sinal do valor', () => {
  it('negativo é despesa; positivo é receita', () => {
    expect(kindForAmount(cents(-1))).toBe('expense');
    expect(kindForAmount(cents(-123_456))).toBe('expense');
    expect(kindForAmount(cents(1))).toBe('income');
    expect(kindForAmount(cents(50_000))).toBe('income');
  });

  it('zero é RECUSADO com erro: não vira receita de R$ 0,00 inventada (defesa da decisão 8)', () => {
    expect(() => kindForAmount(cents(0))).toThrow(RangeError);
    expect(() => kindForAmount(cents(0))).toThrow(/informativ/i);
  });
});
