import { describe, expect, it } from 'vitest';
import { formatInteger } from './format';

describe('formatInteger', () => {
  it('agrupa milhar pt-BR', () => {
    expect(formatInteger(12345)).toBe('12.345');
    expect(formatInteger(1000)).toBe('1.000');
  });

  it('não agrupa abaixo de mil', () => {
    expect(formatInteger(999)).toBe('999');
    expect(formatInteger(0)).toBe('0');
  });

  it('preserva o sinal de negativo', () => {
    expect(formatInteger(-3)).toBe('-3');
    expect(formatInteger(-12345)).toBe('-12.345');
  });

  it('lança para não-inteiro ou fora do safe integer', () => {
    expect(() => formatInteger(1.5)).toThrow(RangeError);
    expect(() => formatInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});
