import type { Cents } from '@/lib/money';

import type { GoalView } from './schemas';

/**
 * O que a tela diz sobre prazo e aporte de uma meta. Lógica de decisão fora do .tsx
 * (o vitest não transforma JSX): a tela só escolhe o texto de cada `kind`.
 *
 * Regra do aceite do T-305: meta sem data MOSTRA A AUSÊNCIA do aporte mensal ("no-deadline"),
 * nunca um zero.
 */
export type DeadlineSummary =
  | { kind: 'no-target' }
  | { kind: 'zero-target' }
  | { kind: 'done' }
  | { kind: 'no-deadline' }
  | { kind: 'monthly'; requiredMonthlyCents: Cents; months: number }
  | { kind: 'due-now'; remainingCents: Cents }
  | { kind: 'overdue'; remainingCents: Cents };

export function deadlineSummary(goal: Pick<GoalView, 'progress' | 'targetCents'>): DeadlineSummary {
  const progress = goal.progress;
  if (progress === null) {
    // Alvo 0 (reserva com histórico mas sem despesa essencial) é diferente de alvo
    // inexistente (sem histórico): a mensagem muda.
    return goal.targetCents === 0 ? { kind: 'zero-target' } : { kind: 'no-target' };
  }
  if (progress.remainingCents === 0) return { kind: 'done' };
  if (progress.requiredMonthlyCents === null || progress.monthsRemaining === null) {
    return { kind: 'no-deadline' };
  }
  if (progress.monthsRemaining === 0) {
    return progress.onTrack === false
      ? { kind: 'overdue', remainingCents: progress.remainingCents }
      : { kind: 'due-now', remainingCents: progress.remainingCents };
  }
  return {
    kind: 'monthly',
    requiredMonthlyCents: progress.requiredMonthlyCents,
    months: progress.monthsRemaining,
  };
}
