import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { creditCards, statements, transactions } from '@/lib/db/schema';
import type { Cents } from '@/lib/money';
import { COUNTED_STATUSES } from './counted-statuses';
import { settleStatement, type PaymentKind } from './statement-settlement';

/** Situacao de uma fatura para as telas de lancamentos: status, vencimento e pago/pendente. */
export type StatementSituation = {
  statementId: string;
  creditCardId: string;
  period: string;
  dueDate: string;
  status: 'open' | 'closed' | 'paid';
  kind: PaymentKind;
  paidCents: Cents;
  pendingCents: Cents;
  remainingCents: Cents | null;
};

/**
 * Todas as faturas da casa (inclusive de cartao desativado, porque o lancamento continua na lista)
 * com a situacao calculada por `settleStatement`, a mesma da tela de Cartoes. Total da fatura = soma
 * dos lancamentos contados com o `statement_id`, como em `listCards`.
 */
export async function listStatementSituations(householdId: string): Promise<StatementSituation[]> {
  const rows = await db
    .select({
      id: statements.id,
      creditCardId: statements.creditCardId,
      period: statements.period,
      dueDate: statements.dueDate,
      status: statements.status,
      paidAmountCents: statements.paidAmountCents,
      computedTotalCents: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(statements)
    .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
    .leftJoin(
      transactions,
      and(
        eq(transactions.statementId, statements.id),
        eq(transactions.householdId, householdId),
        inArray(transactions.status, COUNTED_STATUSES),
      ),
    )
    .where(eq(creditCards.householdId, householdId))
    .groupBy(statements.id, statements.creditCardId, statements.period, statements.dueDate, statements.status, statements.paidAmountCents);

  return rows.map((row) => {
    const settlement = settleStatement({
      status: row.status,
      computedTotalCents: Number(row.computedTotalCents),
      paidAmountCents: row.status === 'paid' && row.paidAmountCents !== null ? Number(row.paidAmountCents) : null,
    });
    return {
      statementId: row.id,
      creditCardId: row.creditCardId,
      period: row.period,
      dueDate: row.dueDate,
      status: row.status,
      kind: settlement.kind,
      paidCents: settlement.paidCents,
      pendingCents: settlement.pendingCents,
      remainingCents: settlement.remainingCents,
    };
  });
}

export { settlementByCompetence, type CompetenceSettlement } from './statement-settlement';
