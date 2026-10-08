/**
 * Conciliação na importação (RF-ORC-03, decisão nº 7): a linha REAL que acaba
 * de entrar cumpre a previsão de recorrência que ela representa.
 *
 * Roda dentro da transação do `commitImport`. A decisão de quem casa com quem é
 * de `matchPlannedToPosted` (CONTRACTS §9, puro); aqui só se lê o que é
 * candidato e se grava o resultado: a previsão passa a `reconciled` e carrega
 * `reconciled_by_transaction_id` (o CHECK exige os dois juntos, daí uma UPDATE só).
 *
 * **Chave de casamento (decisão do Orquestrador, 2026-10-02, R-1 do Corvo):**
 * despesa casa por CATEGORIA; receita casa pela CONTA onde cai, porque a
 * previsão de receita não tem categoria (`categoryId` nulo por construção, e o
 * matcher recusa categoria nula). Para receita, a chave sintética
 * `account:<id>` entra no lugar do `categoryId` nos DOIS lados, sem tocar o
 * `matchPlannedToPosted` (lib/finance). Receita sem conta não concilia.
 *
 * Lançamento MANUAL também concilia, mas só com confirmação da pessoa (decisão 16a,
 * 2026-10-08): `manual-reconcile.ts` usa `findReconcileMatches` daqui, com os mesmos
 * critérios, para SUGERIR, e grava só o par confirmado.
 */

import { and, eq, isNotNull, or, sql } from 'drizzle-orm';

import type { db } from '@/lib/db';
import { transactions } from '@/lib/db/schema';
import type { IsoDate } from '@/lib/date';
import { matchPlannedToPosted, type MatchCandidate } from '@/lib/finance/reconcile';
import { basisPoints, cents } from '@/lib/money';

/**
 * Tolerância de valor (sobre o PREVISTO) e janela de datas, em constantes.
 * DECIDIDO PELO RICARDO em 2026-10-02: 10 % (1000 bp) e 5 dias corridos
 * (inclusivo). Não há coluna por regra nem por household; se um dia houver, é
 * aqui que o valor passa a ser lido.
 */
export const RECONCILE_TOLERANCE_BP = basisPoints(1000);
export const RECONCILE_DAY_WINDOW = 5;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Tx, 'select'>;

/** Linha real recém-gravada, como a conciliação a enxerga. */
export interface ImportedPosting {
  id: string;
  occurredOn: IsoDate;
  amountCents: number;
  categoryId: string | null;
  /** `kind` gravado na linha, a mesma fonte da verdade da previsão (coluna `kind`). */
  kind: 'expense' | 'income';
  /** Conta onde a linha caiu (chave de casamento da receita). */
  accountId: string | null;
}

/** Chave que o matcher compara no lugar de `categoryId` (ver o cabeçalho). */
function matchKey(
  isIncome: boolean,
  categoryId: string | null,
  accountId: string | null,
): string | null {
  if (!isIncome) return categoryId;
  return accountId === null ? null : `account:${accountId}`;
}

/**
 * Pares (previsão, real) que `matchPlannedToPosted` casa entre as `planned` de recorrência
 * do household e `postings`. SÓ LEITURA: quem chama decide se grava. `onlyPlannedId`
 * restringe as candidatas a uma previsão (a que a pessoa confirmou, no manual).
 */
export async function findReconcileMatches(
  reader: Reader,
  householdId: string,
  postings: readonly ImportedPosting[],
  onlyPlannedId?: string,
): Promise<{ plannedId: string; postedId: string }[]> {
  const usable = postings.filter((row) => row.amountCents !== 0);
  if (usable.length === 0) return [];

  const dates = usable.map((row) => row.occurredOn).sort();
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? '';
  const planned = await reader
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      kind: transactions.kind,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'planned'),
        or(isNotNull(transactions.recurringExpenseId), isNotNull(transactions.incomeId)),
        onlyPlannedId === undefined ? undefined : eq(transactions.id, onlyPlannedId),
        sql`${transactions.occurredOn} >= ${first}::date - ${RECONCILE_DAY_WINDOW}::int`,
        sql`${transactions.occurredOn} <= ${last}::date + ${RECONCILE_DAY_WINDOW}::int`,
      ),
    );
  if (planned.length === 0) return [];

  const candidate = (row: ImportedPosting | (typeof planned)[number], isIncome: boolean): MatchCandidate => ({
    id: row.id,
    occurredOn: row.occurredOn,
    amountCents: cents(row.amountCents),
    categoryId: matchKey(isIncome, row.categoryId, row.accountId),
  });
  const { matches } = matchPlannedToPosted(
    planned.map((row) => candidate(row, row.kind === 'income')),
    usable.map((row) => candidate(row, row.kind === 'income')),
    { toleranceBp: RECONCILE_TOLERANCE_BP, dayWindow: RECONCILE_DAY_WINDOW },
  );
  return matches.map(({ plannedId, postedId }) => ({ plannedId, postedId }));
}

/**
 * Concilia as linhas reais com as previsões `planned` de recorrência do
 * household. Devolve quantas previsões viraram `reconciled`.
 */
export async function reconcileImportedPostings(
  tx: Tx,
  householdId: string,
  postings: readonly ImportedPosting[],
): Promise<number> {
  const matches = await findReconcileMatches(tx, householdId, postings);
  let reconciled = 0;
  for (const match of matches) {
    // `status = 'planned'` na cláusula: se alguém apagou ou cumpriu a previsão
    // no meio, a linha não conta e nada é sobrescrito.
    const updated = await tx
      .update(transactions)
      .set({ status: 'reconciled', reconciledByTransactionId: match.postedId })
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.status, 'planned'),
          eq(transactions.id, match.plannedId),
        ),
      )
      .returning({ id: transactions.id });
    reconciled += updated.length;
  }
  return reconciled;
}
