import type { Competence, IsoDate } from '@/lib/date';
import { statementWindow } from '@/lib/finance/billing';
import { futureCommitment, type CommitmentInput } from '@/lib/finance/commitment';
import type { Cents } from '@/lib/money';

/**
 * Canhotos presos por cartão: os meses da janela de comprometimento em que o cartão tem fatura devedora
 * e AINDA não existe fatura gravada (se existe, a própria linha da fatura já a mostra). O vencimento vem
 * do ciclo do cartão (`statementWindow`), e o talão do canhoto é essa data. Nada de conta nova: o valor
 * de cada mês é o do `futureCommitment` do cartão, o mesmo motor do Painel.
 */
export type FutureStub = {
  competence: Competence;
  /** Vencimento previsto pelo ciclo do cartão. */
  dueDate: IsoDate;
  /** Negativo (saída), como o motor devolve. */
  totalCents: Cents;
  installmentCents: Cents;
  purchaseCents: Cents;
};

export function futureStubsForCard(input: {
  card: { id: string; name: string; closingDay: number; dueDay: number };
  transactions: CommitmentInput['transactions'];
  /** Competências das faturas JÁ gravadas deste cartão. */
  statementPeriods: readonly string[];
  fromCompetence: Competence;
  months: number;
}): FutureStub[] {
  const { card } = input;
  const result = futureCommitment({
    fromCompetence: input.fromCompetence,
    months: input.months,
    cards: [{ id: card.id, name: card.name, creditLimitCents: null }],
    transactions: input.transactions.filter((row) => row.creditCardId === card.id),
  });
  const recorded = new Set(input.statementPeriods);
  return result.byCompetence
    .filter((entry) => entry.totalCents < 0 && !recorded.has(entry.competence))
    .map((entry) => ({
      competence: entry.competence,
      dueDate: statementWindow(entry.competence, { closingDay: card.closingDay, dueDay: card.dueDay }).dueDate,
      totalCents: entry.totalCents,
      installmentCents: entry.installmentCents,
      purchaseCents: entry.purchaseCents,
    }));
}
