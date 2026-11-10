import { formatBRL, type Cents } from '@/lib/money';

/**
 * Textos do total do mês e do estado do formulário. O total em si (soma, uso, folga e cor) vem
 * pronto do servidor (`budgetMonthTotals`, lib/finance/budget.ts): aqui só se escreve.
 */

/** `R$ 800,00 de R$ 2.000,00 orçados`: o esperado contra o orçado das categorias COM orçamento. */
export function totalLine(budgeted: { expectedCents: Cents; plannedCents: Cents }): string {
  return `${formatBRL(budgeted.expectedCents, { sign: 'never' })} de ${formatBRL(budgeted.plannedCents, { sign: 'never' })} orçados`;
}

/** `Mais R$ 300,00 previstos até o fim do mês.`; `null` sem previsão. */
export function upcomingLine(upcomingCents: Cents): string | null {
  if (upcomingCents <= 0) return null;
  return `Mais ${formatBRL(upcomingCents, { sign: 'never' })} previstos até o fim do mês.`;
}

/**
 * Gasto fora do orçamento, quando o mês TEM orçamento em outras categorias: fica fora da barra e
 * do percentual, então a tela diz quanto é. `null` quando não há.
 */
export function unbudgetedLine(unbudgeted: {
  spentCents: Cents;
  upcomingCents: Cents;
  expectedCents: Cents;
}): string | null {
  if (unbudgeted.expectedCents <= 0) return null;
  const detail =
    unbudgeted.upcomingCents > 0
      ? ` (${formatBRL(unbudgeted.spentCents, { sign: 'never' })} realizados e ${formatBRL(unbudgeted.upcomingCents, { sign: 'never' })} previstos)`
      : '';
  return `Mais ${formatBRL(unbudgeted.expectedCents, { sign: 'never' })} em categorias sem orçamento${detail}, fora desta barra.`;
}

/**
 * Despesa que nenhuma linha do orçamento mostra (sem categoria, ou em categoria que não recebe
 * orçamento): o total diz quanto é, para não parecer menor que a despesa do mês. `null` sem valor.
 */
export function outsideLine(outside: { expectedCents: Cents }): string | null {
  if (outside.expectedCents <= 0) return null;
  return `Fora desta conta: ${formatBRL(outside.expectedCents, { sign: 'never' })} em despesas sem categoria ou em categoria que não recebe orçamento.`;
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
