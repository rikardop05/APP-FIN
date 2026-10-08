import { formatDateBR } from '@/lib/date';
import { formatBRL, type Cents } from '@/lib/money';

/**
 * Texto da pergunta "isto cumpre a previsão?" (decisão 16a do Ricardo, 2026-10-08). Quem
 * decide QUAL previsão é o servidor (`/api/transactions/reconcile-suggestion`); aqui só se
 * escreve a pergunta. Fora do .tsx porque o vitest não transforma JSX.
 */

export type ReconcileSuggestion = {
  plannedId: string;
  description: string;
  occurredOn: string;
  amountCents: Cents;
};

export function reconcileQuestion(suggestion: ReconcileSuggestion): string {
  return `Este lançamento cumpre a previsão “${suggestion.description}” de ${formatDateBR(suggestion.occurredOn)}, de ${formatBRL(suggestion.amountCents, { sign: 'never' })}?`;
}

export const RECONCILE_EXPLANATION =
  'Se sim, a previsão sai do orçamento, do painel e do fluxo, e o valor conta uma vez só. Se não, o lançamento é gravado à parte e a previsão continua em aberto.';
