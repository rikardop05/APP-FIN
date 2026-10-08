import type { CSSProperties } from 'react';

/**
 * Barras de progresso e de gráfico animam `transform: scaleX/scaleY`, não `width`/`height`: a
 * transição de transform roda no compositor e não recalcula o layout a cada quadro (critique do
 * design, 2026-10-08). O elemento da barra ocupa 100% do trilho e é ENCOLHIDO por `scale`, com
 * `origin-left` (horizontal) ou `origin-bottom` (vertical) para crescer a partir da base.
 */

/** Percentual (0 a 100) -> escala (0 a 1). Fora da faixa ou inválido fica preso aos extremos. */
export function barScale(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
}

/** `style` da barra: `scaleX` para barra horizontal, `scaleY` para coluna. */
export function barScaleStyle(percent: number, axis: 'x' | 'y'): CSSProperties {
  const scale = barScale(percent);
  return { transform: axis === 'x' ? `scaleX(${String(scale)})` : `scaleY(${String(scale)})` };
}

/** Classes da barra horizontal (trilho com `overflow-hidden` fora dela). */
export const BAR_X_CLASS = 'h-full w-full origin-left transition-transform motion-reduce:transition-none';
/** Classes da coluna do gráfico (cresce de baixo para cima). */
export const BAR_Y_CLASS = 'h-full w-full origin-bottom transition-transform motion-reduce:transition-none';
