import { describe, expect, it } from 'vitest';

import { competenceLong, competenceMonth, competenceShort } from './labels';

describe('rótulos de competência em pt-BR', () => {
  it('curto: mes/ano, nunca 2026-07 nem 07/2026', () => {
    expect(competenceShort('2026-07')).toBe('jul/2026');
    expect(competenceShort('2027-01')).toBe('jan/2027');
  });

  it('longo: mês por extenso com "de" em minúscula', () => {
    expect(competenceLong('2026-10')).toBe('outubro de 2026');
    expect(competenceLong('2027-03')).toBe('março de 2027');
  });

  it('só o mês, abreviado (eixo estreito de gráfico): "out"', () => {
    expect(competenceMonth('2026-10')).toBe('out');
    expect(competenceMonth('2027-01')).toBe('jan');
  });

  it('competência inválida lança, não mostra lixo', () => {
    expect(() => competenceMonth('2026-13')).toThrow(RangeError);
    expect(() => competenceShort('abc')).toThrow(RangeError);
  });
});
