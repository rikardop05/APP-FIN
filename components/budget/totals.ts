import { budgetStatus, type BudgetLight } from '@/lib/finance/budget';
import { cents, formatBRL, type BasisPoints, type Cents } from '@/lib/money';

export type TotalsRow = {
  plannedCents: Cents;
  spentCents: Cents;
  expectedCents: Cents;
};

export type MonthTotals = {
  /** Soma do orçado de todas as linhas do mês (orçamento zero é limite explícito). */
  plannedCents: number;
  /** Realizado + previsto de todas as linhas. */
  expectedCents: number;
  spentCents: number;
  remainingCents: number;
  /** Null quando o orçado é zero (a cor vem do motor). */
  usageBp: BasisPoints | null;
  light: BudgetLight | null; // null só sem nenhuma linha
};

/**
 * Total do mês no topo do Orçamento: a mesma conta do semáforo por categoria (realizado + previsto
 * contra o orçado; vermelho acima de 100%, amarelo a partir de `warnBp`), aplicada à soma das
 * categorias COM limite. Os números vêm das linhas já calculadas pelo motor; aqui só se soma.
 */
export function monthTotals(rows: readonly TotalsRow[], warnBp: BasisPoints): MonthTotals {
  let plannedCents = 0;
  let spentCents = 0;
  let expectedCents = 0;
  for (const row of rows) {
    plannedCents += row.plannedCents;
    spentCents += row.spentCents;
    expectedCents += row.expectedCents;
  }
  if (rows.length === 0) {
    return { plannedCents: 0, expectedCents: 0, spentCents: 0, remainingCents: 0, usageBp: null, light: null };
  }
  // O semáforo do total é do motor (uma linha agregada), nunca refeito aqui.
  const status = budgetStatus({
    budgets: [{ categoryId: 'total', plannedCents: cents(plannedCents) }],
    spent: [{ categoryId: 'total', amountCents: cents(-spentCents) }],
    upcoming: [{ categoryId: 'total', amountCents: cents(-(expectedCents - spentCents)) }],
    warnBp,
  })[0];
  if (status === undefined) throw new Error('budgetStatus nao devolveu a linha agregada');
  return {
    plannedCents,
    expectedCents,
    spentCents,
    remainingCents: status.remainingCents,
    usageBp: status.usageBp,
    light: status.light,
  };
}

/** Estado do botão Salvar: diz que nada mudou, ou quantas categorias mudaram. */
export function saveHint(changedCount: number): string {
  if (changedCount <= 0) return 'Nada mudou desde o último salvamento';
  return changedCount === 1 ? '1 categoria alterada, ainda não salva' : `${changedCount} categorias alteradas, ainda não salvas`;
}

/** Quantas categorias têm texto diferente do salvo. */
export function changedCount(fields: Record<string, string>, baseline: Record<string, string>): number {
  const ids = new Set([...Object.keys(fields), ...Object.keys(baseline)]);
  let count = 0;
  for (const id of ids) {
    if ((fields[id] ?? '') !== (baseline[id] ?? '')) count += 1;
  }
  return count;
}

export function totalLine(totals: MonthTotals): string {
  return `${formatBRL(totals.expectedCents as Cents, { sign: 'never' })} de ${formatBRL(totals.plannedCents as Cents, { sign: 'never' })} orçados`;
}
