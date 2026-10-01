import type { Competence } from '@/lib/date';
import { addCents, cents, type Cents } from '@/lib/money';

/**
 * Ajuste do modo "e se" (RF-FLX-03), como o usuário o descreve: uma regra, não
 * um lançamento. Vive só no estado da tela — NÃO persiste (BUILD-PLAN T-207,
 * CONTRACTS §11). `amountCents` é sempre a MAGNITUDE digitada; o sentido vem de
 * `direction`, para o usuário nunca precisar digitar sinal.
 */
export type WhatIfItem = {
  id: string;
  label: string;
  /** Primeiro mês em que o ajuste vale. */
  fromCompetence: Competence;
  direction: 'in' | 'out';
  amountCents: Cents;
  /** `true` = vale em todo mês da janela a partir de `fromCompetence`. */
  repeat: boolean;
};

export type EngineAdjustment = { competence: Competence; amountCents: Cents; label: string };

/**
 * Expande as regras nos `adjustments` do motor: saída vira negativa, entrada
 * positiva, e `repeat` espalha pelos meses da janela. Meses fora da janela são
 * ignorados em silêncio por quem consome (o motor só visita a janela); aqui eles
 * nem são gerados.
 */
export function expandAdjustments(
  items: readonly WhatIfItem[],
  window: readonly Competence[],
): EngineAdjustment[] {
  const result: EngineAdjustment[] = [];
  for (const item of items) {
    const signed = item.direction === 'out' ? cents(-item.amountCents) : item.amountCents;
    const months = item.repeat
      ? window.filter((competence) => competence >= item.fromCompetence)
      : window.filter((competence) => competence === item.fromCompetence);
    for (const competence of months) {
      result.push({ competence, amountCents: signed, label: item.label });
    }
  }
  return result;
}

/** Soma dos ajustes por competência — eco do que o usuário digitou, para a coluna "Ajuste" da tabela. */
export function adjustmentTotals(
  adjustments: readonly EngineAdjustment[],
): Record<Competence, Cents> {
  const totals: Record<Competence, Cents> = {};
  for (const adjustment of adjustments) {
    totals[adjustment.competence] = addCents(
      totals[adjustment.competence] ?? cents(0),
      adjustment.amountCents,
    );
  }
  return totals;
}
