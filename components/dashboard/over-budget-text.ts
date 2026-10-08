import { formatBRL, type Cents } from '@/lib/money';

/**
 * Textos dos orçamentos estourados no painel. "Estourado" é o vermelho de `budgetStatus`, que
 * mede o TOTAL ESPERADO do mês, realizado + previsto (decisão 10b do Ricardo, 2026-10-07):
 * a lista inclui a categoria que ainda vai estourar. Fora do .tsx porque o vitest não
 * transforma JSX.
 */

export const OVER_BUDGET_TITLE = 'Orçamentos estourados ou a caminho';

export const OVER_BUDGET_INTRO =
  'Categorias em vermelho na tela de Orçamento: o realizado mais o previsto a realizar do mês passa do orçado.';

/**
 * `'R$ 1.100,00 esperados no mês (realizado + previsto) de R$ 1.000,00 orçados'`. "Esperado", e
 * não "previsto": na tela de orçamento, "previsto" é só a parcela ainda não lançada.
 */
export function overBudgetLine(expectedCents: Cents, plannedCents: Cents): string {
  return `${formatBRL(expectedCents, { sign: 'never' })} esperados no mês (realizado + previsto) de ${formatBRL(plannedCents, { sign: 'never' })} orçados`;
}
