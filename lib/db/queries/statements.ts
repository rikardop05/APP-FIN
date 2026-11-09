import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { StatementStatus } from '@/lib/db/enums';
import { creditCards, statements, transactions } from '@/lib/db/schema';
import { COUNTED_STATUSES } from './counted-statuses';

/**
 * Marcar e desmarcar fatura como paga (decisao 2 do Ricardo, 2026-10-08): a
 * fatura vencida continua comprometida ate alguem marca-la como `paid`.
 *
 * `statements` nao tem `household_id`; o isolamento vem do cartao
 * (CONVENTIONS §7): a fatura so muda se o cartao dela e do household.
 */

/**
 * Status que a pessoa escolhe. `closed` fica de fora: nada no app o grava hoje,
 * e desmarcar "paga" devolve a fatura a `open`.
 */
export type SettableStatementStatus = Extract<StatementStatus, 'open' | 'paid'>;

export type StatementStatusResult = {
  id: string;
  status: StatementStatus;
  /** Valor pago quando parcial; null = integral (ou nao paga). */
  paidAmountCents: number | null;
};

/** Fatura inexistente ou de cartao de outro household. */
export class StatementNotFoundError extends Error {
  constructor() {
    super('Fatura não encontrada.');
    this.name = 'StatementNotFoundError';
  }
}

export async function setStatementStatus(
  householdId: string,
  statementId: string,
  status: SettableStatementStatus,
  /** So com `paid`: ausente ou igual ao total da fatura = pagamento integral (grava null). */
  paidAmountCents?: number,
): Promise<StatementStatusResult> {
  const householdCards = db
    .select({ id: creditCards.id })
    .from(creditCards)
    .where(eq(creditCards.householdId, householdId));

  let storedPaid: number | null = null;
  if (status === 'paid' && paidAmountCents !== undefined) {
    // Total da fatura = o mesmo da lista de Cartoes (soma dos lancamentos contados), em modulo.
    const [totalRow] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.statementId, statementId),
          eq(transactions.householdId, householdId),
          inArray(transactions.status, COUNTED_STATUSES),
        ),
      );
    const total = Math.abs(Number(totalRow?.total ?? 0));
    storedPaid = paidAmountCents === total ? null : paidAmountCents;
  }

  const [row] = await db
    .update(statements)
    .set({ status, paidAmountCents: storedPaid })
    .where(and(eq(statements.id, statementId), inArray(statements.creditCardId, householdCards)))
    .returning({ id: statements.id, status: statements.status, paidAmountCents: statements.paidAmountCents });
  if (row === undefined) throw new StatementNotFoundError();
  return row;
}
