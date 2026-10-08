import { describe, expect, it } from 'vitest';

import { barScale, barScaleStyle } from './bar-scale';

describe('barras animadas por transform (scaleX/scaleY), não por width/height', () => {
  it('converte percentual de 0 a 100 em escala de 0 a 1', () => {
    expect(barScale(0)).toBe(0);
    expect(barScale(40)).toBe(0.4);
    expect(barScale(100)).toBe(1);
  });

  it('limita: acima de 100% fica 1 (a barra não vaza), negativo e inválido ficam 0', () => {
    expect(barScale(180)).toBe(1);
    expect(barScale(-5)).toBe(0);
    expect(barScale(Number.NaN)).toBe(0);
    expect(barScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('estilo horizontal usa scaleX e o vertical scaleY', () => {
    expect(barScaleStyle(25, 'x')).toEqual({ transform: 'scaleX(0.25)' });
    expect(barScaleStyle(25, 'y')).toEqual({ transform: 'scaleY(0.25)' });
    expect(barScaleStyle(250, 'x')).toEqual({ transform: 'scaleX(1)' });
  });
});
