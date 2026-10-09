import { z } from 'zod';

import { cents, type Cents } from '@/lib/money';

/**
 * Lançamentos SEM categoria que ficam fora do orçamento. O orçamento é por subcategoria, então uma
 * despesa sem categoria não entra em nenhuma barra, e o total do mês parecia menor do que o gasto real
 * (critique de 2026-10-09: "0,00% esconde R$ 766,09 sem categoria"). A tela lê `GET /api/transactions`
 * com `uncategorized=true` e resume AQUI só as despesas da competência mostrada.
 */
export const uncategorizedResponseSchema = z.object({
  transactions: z.array(
    z.object({
      competence: z.string(),
      kind: z.string(),
      amountCents: z.number().int(),
    }),
  ),
});

export type UncategorizedSummary = { count: number; totalCents: Cents };

/**
 * Despesas (`kind = expense`) sem categoria da competência: quantas e quanto. O valor é a saída LÍQUIDA
 * (estorno abate, como no orçamento), com piso em zero, mostrada em magnitude.
 */
export function summarizeUncategorized(
  rows: readonly { competence: string; kind: string; amountCents: number }[],
  period: string,
): UncategorizedSummary {
  let count = 0;
  let net = 0;
  for (const row of rows) {
    if (row.competence !== period || row.kind !== 'expense') continue;
    count += 1;
    net += row.amountCents;
  }
  return { count, totalCents: cents(Math.max(0, -net)) };
}

/** "6 lançamentos sem categoria" / "1 lançamento sem categoria". */
export function uncategorizedTitle(count: number): string {
  return `${String(count)} ${count === 1 ? 'lançamento sem categoria' : 'lançamentos sem categoria'}`;
}

/** Fim da frase da faixa: concorda com o número ("não entra" / "não entram"). */
export function uncategorizedVerb(count: number): string {
  return count === 1 ? 'não entra no orçamento' : 'não entram no orçamento';
}
