import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { StatementStatus } from '@/lib/db/enums';
import { creditCards, statements } from '@/lib/db/schema';

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

export type StatementStatusResult = { id: string; status: StatementStatus };

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
): Promise<StatementStatusResult> {
  const householdCards = db
    .select({ id: creditCards.id })
    .from(creditCards)
    .where(eq(creditCards.householdId, householdId));

  const [row] = await db
    .update(statements)
    .set({ status })
    .where(and(eq(statements.id, statementId), inArray(statements.creditCardId, householdCards)))
    .returning({ id: statements.id, status: statements.status });
  if (row === undefined) throw new StatementNotFoundError();
  return row;
}
