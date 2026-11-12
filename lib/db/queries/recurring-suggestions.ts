import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import type { IsoDate } from '@/lib/date';
import { db } from '@/lib/db';
import { transactions } from '@/lib/db/schema';
import {
  recurrenceHistoryStart,
  type RecurrenceHistoryRow,
} from '@/lib/finance/recurrence-suggestions';
import type { Cents } from '@/lib/money';

/**
 * Histórico que alimenta `suggestRecurrences` (Lote 2, item 8). SÓ LÊ.
 *
 * Devolve os lançamentos `posted` de receita e despesa da janela do motor
 * (`recurrenceHistoryStart(today)` até `today`), pela data do fato. Fica de fora o que já
 * nasceu de uma receita ou despesa fixa cadastrada (`recurring_expense_id` / `income_id`):
 * sugerir de novo o que já é regra seria ruído. `planned` e `reconciled` não entram: previsão
 * não é histórico.
 *
 * Quem decide o que é candidato é o motor; esta consulta não agrupa nem compara valor.
 */
function safeCents(value: string | number): Cents {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  // Drizzle e postgres-js podem entregar bigint como string; a validação acima
  // garante o inteiro seguro exigido pelo tipo Cents.
  return numeric as Cents;
}

export async function listRecurrenceHistory(
  householdId: string,
  today: IsoDate,
): Promise<RecurrenceHistoryRow[]> {
  const rows = await db
    .select({
      occurredOn: transactions.occurredOn,
      amountCents: transactions.amountCents,
      description: transactions.description,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      creditCardId: transactions.creditCardId,
      memberId: transactions.memberId,
      installmentPlanId: transactions.installmentPlanId,
      installmentNumber: transactions.installmentNumber,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'posted'),
        inArray(transactions.kind, ['income', 'expense']),
        gte(transactions.occurredOn, recurrenceHistoryStart(today)),
        lte(transactions.occurredOn, today),
        isNull(transactions.recurringExpenseId),
        isNull(transactions.incomeId),
      ),
    );

  return rows.map(({ installmentPlanId, installmentNumber, ...row }) => ({
    ...row,
    amountCents: safeCents(row.amountCents),
    isInstallment: installmentPlanId !== null || installmentNumber !== null,
  }));
}
