import type { Cents } from '@/lib/money';

/**
 * Situacao de pagamento de UMA fatura, a partir do total que a tela de Cartoes mostra (soma dos
 * lancamentos contados), do status e de `paid_amount_cents` (PR #7). E a fonte unica de "pago",
 * "pendente", "resta" e "pago a mais": a lista de Cartoes, a de Lancamentos e os resumos leem DAQUI,
 * nenhuma tela refaz a conta.
 *
 * - paga integral (valor nulo): pago = total, pendente 0;
 * - paga parcial (valor < total): pago = valor, pendente = total - valor (o `remaining`);
 * - paga a maior (valor > total): pago = total (o excedente nao conta como pago da fatura), pendente 0;
 * - nao paga: pago 0, pendente = total.
 * O total e o que a casa DEVE: despesa e negativa, entao deve = -soma. Fatura de saldo credor (soma
 * positiva, estorno maior que a compra) nao deve nada: total 0 e pendente 0, como no comprometido, que
 * tambem nao conta credito como a pagar.
 */
export type PaymentKind = 'none' | 'full' | 'partial' | 'over';

export type StatementSettlement = {
  kind: PaymentKind;
  /** Total da fatura em modulo. */
  totalCents: Cents;
  paidCents: Cents;
  pendingCents: Cents;
  /** Parcial: total - pago. null nos demais casos. */
  remainingCents: Cents | null;
  /** Pago a maior: pago - total. null nos demais casos. */
  overpaidCents: Cents | null;
};

export function settleStatement(input: {
  status: 'open' | 'closed' | 'paid';
  /** Soma com sinal dos lancamentos da fatura (despesa negativa). */
  computedTotalCents: number;
  /** `statements.paid_amount_cents`; so vale com status `paid`. */
  paidAmountCents: number | null;
}): StatementSettlement {
  const total = input.computedTotalCents < 0 ? -input.computedTotalCents : 0;
  const make = (kind: PaymentKind, paid: number, pending: number, remaining: number | null, over: number | null): StatementSettlement => ({
    kind,
    totalCents: total as Cents,
    paidCents: paid as Cents,
    pendingCents: pending as Cents,
    remainingCents: remaining as Cents | null,
    overpaidCents: over as Cents | null,
  });
  if (input.status !== 'paid') return make('none', 0, total, null, null);
  const paid = input.paidAmountCents;
  if (paid === null) return make('full', total, 0, null, null);
  if (paid < total) return make('partial', paid, total - paid, total - paid, null);
  if (paid > total) return make('over', total, 0, null, paid - total);
  return make('full', total, 0, null, null);
}

/** Pago e pendente das faturas de cartao de UMA competencia (todas as faturas dela somadas). */
export type CompetenceSettlement = { competence: string; paidCents: Cents; pendingCents: Cents };

/** Soma de `paid` e `pending` por competencia. Soma de inteiros seguros; o total do app cabe em safe integer. */
export function settlementByCompetence(situations: readonly { period: string; paidCents: Cents; pendingCents: Cents }[]): CompetenceSettlement[] {
  const byPeriod = new Map<string, { paid: number; pending: number }>();
  for (const item of situations) {
    const entry = byPeriod.get(item.period) ?? { paid: 0, pending: 0 };
    entry.paid += item.paidCents;
    entry.pending += item.pendingCents;
    byPeriod.set(item.period, entry);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([competence, { paid, pending }]) => ({ competence, paidCents: paid as Cents, pendingCents: pending as Cents }));
}
