import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import type { TransactionKind } from '@/lib/db';
import { incomes, recurringExpenses, transactions } from '@/lib/db/schema';
import type { IsoDate } from '@/lib/date';
import { cents, type Cents } from '@/lib/money';

import { findReconcileMatches, type ImportedPosting } from './import-reconcile';

/**
 * Lançamento MANUAL que cumpre uma previsão — decisão 16a do Ricardo (2026-10-08).
 *
 * Ao lançar à mão (`posted`), o app procura a previsão de recorrência compatível com os
 * MESMOS critérios da importação (`findReconcileMatches`: `matchPlannedToPosted`, 10 % e 5
 * dias, despesa por categoria, receita pela conta) e PERGUNTA. Só se a pessoa confirmar a
 * previsão vira `reconciled` apontando para o lançamento; recusado, grava normal. **Nunca
 * concilia sozinho**: sem `reconcilePlannedId` no pedido, nada é conciliado.
 *
 * Sem isso, quem paga a conta de luz no Pix e lança à mão vê a mesma despesa duas vezes
 * (a real e a prevista) no orçamento, no painel e no fluxo.
 */

/** O que a tela mostra na pergunta "isto cumpre … ?". */
export type PlannedSuggestion = {
  plannedId: string;
  /** Descrição da regra (despesa fixa ou receita). */
  description: string;
  occurredOn: IsoDate;
  /** Valor previsto, com sinal (saída negativa). */
  amountCents: Cents;
};

/** O rascunho do lançamento manual, como a conciliação o enxerga. */
export type ManualDraft = {
  occurredOn: IsoDate;
  amountCents: Cents;
  kind: TransactionKind;
  categoryId: string | null;
  accountId: string | null;
};

/** A previsão pedida não é (mais) cumprível por este lançamento: nada foi gravado. */
export class PlannedNotReconcilableError extends Error {
  constructor() {
    super(
      'Essa previsão não pode mais ser marcada como cumprida por este lançamento (já foi cumprida, mudou ou não combina). Nada foi gravado: lance à parte ou feche e confira a previsão.',
    );
    this.name = 'PlannedNotReconcilableError';
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Tx, 'select'>;

/** Só receita e despesa cumprem previsão de recorrência. */
function toPosting(id: string, draft: ManualDraft): ImportedPosting | null {
  if (draft.kind !== 'expense' && draft.kind !== 'income') return null;
  return {
    id,
    occurredOn: draft.occurredOn,
    amountCents: draft.amountCents,
    categoryId: draft.categoryId,
    kind: draft.kind,
    accountId: draft.accountId,
  };
}

/**
 * A previsão que este rascunho cumpriria, para a tela PERGUNTAR. Só leitura. `null` quando
 * não há nenhuma compatível (ou o tipo não concilia).
 */
export async function suggestPlannedForManual(
  householdId: string,
  draft: ManualDraft,
  reader: Reader = db,
): Promise<PlannedSuggestion | null> {
  const posting = toPosting('rascunho', draft);
  if (posting === null) return null;
  const [match] = await findReconcileMatches(reader, householdId, [posting]);
  if (match === undefined) return null;
  const [row] = await reader
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      amountCents: transactions.amountCents,
      description: transactions.description,
      expenseRule: recurringExpenses.description,
      incomeRule: incomes.description,
    })
    .from(transactions)
    .leftJoin(recurringExpenses, eq(recurringExpenses.id, transactions.recurringExpenseId))
    .leftJoin(incomes, eq(incomes.id, transactions.incomeId))
    .where(and(eq(transactions.id, match.plannedId), eq(transactions.householdId, householdId)))
    .limit(1);
  if (row === undefined) return null;
  return {
    plannedId: row.id,
    description: row.expenseRule ?? row.incomeRule ?? row.description,
    occurredOn: row.occurredOn,
    amountCents: cents(row.amountCents),
  };
}

/**
 * Marca `plannedId` como cumprida por `postedId`, dentro da transação de quem grava o
 * lançamento. Revalida com os MESMOS critérios da sugestão, restritos a essa previsão: se ela
 * já foi cumprida, mudou, é de outra casa ou não combina com o lançamento, lança
 * `PlannedNotReconcilableError` e a transação inteira (inclusive o lançamento) é desfeita.
 */
export async function reconcileManualPosting(
  tx: Tx,
  householdId: string,
  postedId: string,
  draft: ManualDraft,
  plannedId: string,
): Promise<void> {
  const posting = toPosting(postedId, draft);
  if (posting === null) throw new PlannedNotReconcilableError();
  const matches = await findReconcileMatches(tx, householdId, [posting], plannedId);
  if (!matches.some((match) => match.plannedId === plannedId && match.postedId === postedId)) {
    throw new PlannedNotReconcilableError();
  }
  const updated = await tx
    .update(transactions)
    .set({ status: 'reconciled', reconciledByTransactionId: postedId })
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'planned'),
        eq(transactions.id, plannedId),
      ),
    )
    .returning({ id: transactions.id });
  if (updated.length !== 1) throw new PlannedNotReconcilableError();
}
