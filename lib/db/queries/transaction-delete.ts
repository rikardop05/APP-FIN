/**
 * Exclusão de lançamento — "todos os lançamentos precisam ter a possibilidade de
 * exclusão, o usuário que manda". Sem lista de exceções.
 *
 * ## Uma função decide, duas a usam
 *
 * `planDeletion` calcula, a partir do banco, o que a exclusão vai fazer: quais
 * linhas somem e que efeitos isso tem. `getDeleteImpact` devolve esse plano como
 * texto estruturado para a confirmação; `deleteTransaction` o EXECUTA. A tela não
 * calcula nada: uma tela que calculasse "quantas parcelas futuras" divergiria do
 * que o `DELETE` apaga de fato, e a confirmação viraria mentira.
 *
 * ## O que acontece com cada tipo de linha
 *
 * - **`planned` de recorrência**: a linha some E a ocorrência fica DISPENSADA
 *   (`skipped_occurrences`), para o `topUpPlanned` não a regenerar ao abrir o
 *   painel. Apagar e ver voltar é pior que não poder apagar. Como efeito de
 *   produto, apagar uma previsão vencida e não realizada RESOLVE a pendência do
 *   painel: antes, a única forma de limpá-la era registrar um gasto que não
 *   houve.
 * - **Parcela de plano**: `scope = 'only'` (padrão, o menos destrutivo) apaga só
 *   esta; `'with-future'` apaga também as parcelas FUTURAS `planned` do mesmo
 *   plano. Se não sobrar linha no plano, o plano some (como em `revertImport`).
 * - **Linha de fatura**: o total calculado da fatura cai e o impresso fica; a
 *   divergência que aparece é o alerta de conciliação fazendo seu trabalho.
 * - **Pagamento de fatura**: `statements.paid_transaction_id` não tem cascata e
 *   apagar o lançamento violaria a FK. É anulado na mesma transação (hoje nada o
 *   escreve, então é proteção, não fluxo).
 * - **Veio de importação**: `rows_imported` do lote cai em 1 se a linha foi contada
 *   (parcela projetada não é contada), nunca abaixo de 0.
 * - **Com `dedupe_hash`**: reimportar o mesmo arquivo a traz de volta. NÃO há
 *   tombstone (decisão de 2026-10-01): o preview já mostra cada linha com
 *   checkbox. A confirmação avisa em palavras, e SÓ quando há hash — lançamento
 *   manual não volta.
 * - **Exceção: parcela lida do arquivo com as futuras projetadas ainda lá.**
 *   Reimportar recria a parcela E projeta de novo as futuras, com os MESMOS
 *   `dedupe_hash` das que ficaram: o índice único rejeita o lote inteiro (23505
 *   em `transactions_household_id_dedupe_hash_unique`) e nada volta. Nesse caso
 *   o efeito é `reimport_will_fail`, NO LUGAR de `returns_on_reimport`: dizer
 *   "volta" seria mentira.
 * - **Parcela projetada com a lida que a gerou ainda no banco**: a reimportação
 *   pula a lida como duplicada e não projeta nada, então esta NÃO volta
 *   (`stays_deleted_on_reimport`).
 *
 * Fronteira de household (CONVENTIONS §7): toda consulta carrega `household_id`.
 */

import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  creditCards,
  importBatches,
  incomes,
  installmentPlans,
  recurringExpenses,
  statements,
  transactions,
} from '@/lib/db/schema';
import { cents, type Cents } from '@/lib/money';

import {
  lockHousehold,
  recordSkippedOccurrence,
  type DbTransaction,
  type Origin,
} from './recurring-planned-write';
import { TransactionNotFoundError } from './transactions';

export type DeleteScope = 'only' | 'with-future';

/** `scope = 'with-future'` numa linha que não é parcela de plano. */
export class InvalidDeleteScopeError extends Error {
  constructor() {
    super('Só uma parcela de plano tem "esta e as futuras".');
    this.name = 'InvalidDeleteScopeError';
  }
}

export type DeleteEffect =
  | { kind: 'plan_hole'; planDescription: string; remaining: number }
  | { kind: 'plan_removed'; planDescription: string }
  | {
      kind: 'statement_total';
      cardName: string;
      competence: string;
      beforeCents: Cents;
      afterCents: Cents;
      /** Total impresso na fatura; `null` se foi lançada à mão. Não muda. */
      reportedCents: Cents | null;
    }
  | { kind: 'statement_unpaid'; cardName: string; competence: string }
  | { kind: 'import_batch'; fileName: string; before: number; after: number }
  | { kind: 'returns_on_reimport' }
  /** Reimportar o arquivo falha enquanto `blockingInstallments` parcelas projetadas existirem. */
  | { kind: 'reimport_will_fail'; planDescription: string; blockingInstallments: number }
  /** Parcela projetada: a reimportação pula a lida que a gerou e não a projeta de novo. */
  | { kind: 'stays_deleted_on_reimport' }
  | { kind: 'occurrence_skipped'; ruleDescription: string; competence: string };

export interface DeleteImpact {
  target: {
    id: string;
    description: string;
    amountCents: Cents;
    occurredOn: string;
    status: 'posted' | 'planned';
  };
  /** "1 lançamento e 7 parcelas futuras": o que de fato some. */
  deleted: { transactions: number; futureInstallments: number };
  effects: DeleteEffect[];
}

type Reader = Pick<typeof db, 'select'>;

interface DeletionPlan {
  impact: DeleteImpact;
  ids: string[];
  /** Dispensa a gravar (só `planned` de recorrência). */
  skip: { origin: Origin; competence: string } | null;
  planId: string | null;
  /** Lote cujo `rows_imported` cai em 1 (só se a linha foi contada). */
  decrementBatchId: string | null;
}

async function planDeletion(
  reader: Reader,
  householdId: string,
  id: string,
  scope: DeleteScope,
): Promise<DeletionPlan> {
  const [target] = await reader
    .select({
      id: transactions.id,
      description: transactions.description,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      occurredOn: transactions.occurredOn,
      competence: transactions.competence,
      status: transactions.status,
      dedupeHash: transactions.dedupeHash,
      importBatchId: transactions.importBatchId,
      statementId: transactions.statementId,
      installmentPlanId: transactions.installmentPlanId,
      installmentNumber: transactions.installmentNumber,
      recurringExpenseId: transactions.recurringExpenseId,
      incomeId: transactions.incomeId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  if (target === undefined) throw new TransactionNotFoundError();

  const inPlan = target.installmentPlanId !== null && target.installmentNumber !== null;
  if (scope === 'with-future' && !inPlan) throw new InvalidDeleteScopeError();

  const effects: DeleteEffect[] = [];
  const ids = [target.id];

  // --- parcelas -------------------------------------------------------------
  let planDescription: string | null = null;
  let blockingInstallments = 0;
  let staysDeletedOnReimport = false;
  if (inPlan && target.installmentPlanId !== null && target.installmentNumber !== null) {
    const [plan] = await reader
      .select({ description: installmentPlans.description })
      .from(installmentPlans)
      .where(
        and(eq(installmentPlans.id, target.installmentPlanId), eq(installmentPlans.householdId, householdId)),
      )
      .limit(1);
    planDescription = plan?.description ?? target.description;

    if (scope === 'with-future') {
      const future = await reader
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.installmentPlanId, target.installmentPlanId),
            eq(transactions.status, 'planned'),
            gt(transactions.installmentNumber, target.installmentNumber),
          ),
        )
        .orderBy(asc(transactions.installmentNumber));
      ids.push(...future.map((row) => row.id));
    }

    const others = await reader
      .select({
        id: transactions.id,
        installmentNumber: transactions.installmentNumber,
        rawDescription: transactions.rawDescription,
        dedupeHash: transactions.dedupeHash,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.installmentPlanId, target.installmentPlanId),
          // O que SOBRA depois: tudo do plano que não está em `ids`.
          notInArray(transactions.id, ids),
        ),
      );
    if (others.length === 0) {
      effects.push({ kind: 'plan_removed', planDescription });
    } else if (scope === 'only') {
      effects.push({ kind: 'plan_hole', planDescription, remaining: others.length });
    }

    // O que a reimportação do mesmo arquivo faz (`finalizeImport`): a parcela LIDA
    // do arquivo é pulada se o hash dela existe; se não existe, é recriada e
    // projeta de novo as de número maior, com os mesmos hashes.
    if (target.dedupeHash !== null) {
      const targetNumber = target.installmentNumber;
      const projected = (row: (typeof others)[number]) => row.rawDescription === '' && row.dedupeHash !== null;
      if (target.rawDescription !== '') {
        // Lida do arquivo: as projetadas acima dela que ficarem colidem, e o lote
        // falha inteiro no índice único.
        blockingInstallments = others.filter(
          (row) => projected(row) && row.installmentNumber !== null && row.installmentNumber > targetNumber,
        ).length;
      } else {
        // Projetada: enquanto a lida que a gerou existir, a reimportação a pula e
        // NÃO projeta nada; esta parcela não volta. Sem a lida, a reimportação a
        // recria junto com as irmãs projetadas que ficaram, e essas colidem.
        const sourceRow = others.some(
          (row) =>
            row.rawDescription !== '' &&
            row.dedupeHash !== null &&
            row.installmentNumber !== null &&
            row.installmentNumber < targetNumber,
        );
        if (sourceRow) staysDeletedOnReimport = true;
        else blockingInstallments = others.filter(projected).length;
      }
    }
  }

  // --- fatura (total calculado) --------------------------------------------
  if (target.statementId !== null) {
    const [statement] = await reader
      .select({
        period: statements.period,
        reportedTotalCents: statements.reportedTotalCents,
        cardName: creditCards.name,
      })
      .from(statements)
      .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
      .where(and(eq(statements.id, target.statementId), eq(creditCards.householdId, householdId)))
      .limit(1);
    if (statement !== undefined) {
      const [sum] = await reader
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)` })
        .from(transactions)
        .where(
          and(eq(transactions.householdId, householdId), eq(transactions.statementId, target.statementId)),
        );
      const before = cents(Number(sum?.total ?? 0));
      effects.push({
        kind: 'statement_total',
        cardName: statement.cardName,
        competence: statement.period,
        beforeCents: before,
        afterCents: cents(before - target.amountCents),
        reportedCents:
          statement.reportedTotalCents === null ? null : cents(statement.reportedTotalCents),
      });
    }
  }

  // --- este lançamento paga uma fatura -------------------------------------
  const paid = await reader
    .select({ period: statements.period, cardName: creditCards.name })
    .from(statements)
    .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
    .where(and(eq(statements.paidTransactionId, target.id), eq(creditCards.householdId, householdId)));
  for (const statement of paid) {
    effects.push({ kind: 'statement_unpaid', cardName: statement.cardName, competence: statement.period });
  }

  // --- lote de importação ---------------------------------------------------
  // `rows_imported` conta as linhas lidas do arquivo, não as parcelas projetadas
  // (`rawDescription = ''`).
  let decrementBatchId: string | null = null;
  if (target.importBatchId !== null && target.rawDescription !== '') {
    const [batch] = await reader
      .select({ fileName: importBatches.fileName, rowsImported: importBatches.rowsImported })
      .from(importBatches)
      .where(and(eq(importBatches.id, target.importBatchId), eq(importBatches.householdId, householdId)))
      .limit(1);
    if (batch !== undefined) {
      decrementBatchId = target.importBatchId;
      effects.push({
        kind: 'import_batch',
        fileName: batch.fileName,
        before: batch.rowsImported,
        after: Math.max(0, batch.rowsImported - 1),
      });
    }
  }

  // --- volta na reimportação (ou a reimportação falha) -----------------------
  if (blockingInstallments > 0) {
    effects.push({
      kind: 'reimport_will_fail',
      planDescription: planDescription ?? target.description,
      blockingInstallments,
    });
  } else if (staysDeletedOnReimport) {
    effects.push({ kind: 'stays_deleted_on_reimport' });
  } else if (target.dedupeHash !== null) {
    effects.push({ kind: 'returns_on_reimport' });
  }

  // --- previsão de recorrência: dispensa -----------------------------------
  let skip: DeletionPlan['skip'] = null;
  if (target.status === 'planned' && (target.recurringExpenseId !== null || target.incomeId !== null)) {
    const origin: Origin =
      target.recurringExpenseId !== null
        ? { expenseId: target.recurringExpenseId }
        : { incomeId: target.incomeId ?? '' };
    const rule =
      'expenseId' in origin
        ? await reader
            .select({ description: recurringExpenses.description })
            .from(recurringExpenses)
            .where(and(eq(recurringExpenses.id, origin.expenseId), eq(recurringExpenses.householdId, householdId)))
            .limit(1)
        : await reader
            .select({ description: incomes.description })
            .from(incomes)
            .where(and(eq(incomes.id, origin.incomeId), eq(incomes.householdId, householdId)))
            .limit(1);
    skip = { origin, competence: target.competence };
    effects.push({
      kind: 'occurrence_skipped',
      ruleDescription: rule[0]?.description ?? target.description,
      competence: target.competence,
    });
  }

  return {
    impact: {
      target: {
        id: target.id,
        description: target.description,
        amountCents: cents(target.amountCents),
        occurredOn: target.occurredOn,
        status: target.status,
      },
      deleted: { transactions: 1, futureInstallments: ids.length - 1 },
      effects,
    },
    ids,
    skip,
    planId: target.installmentPlanId,
    decrementBatchId,
  };
}

/** O que a exclusão vai fazer, para a confirmação. Só leitura. */
export async function getDeleteImpact(
  householdId: string,
  id: string,
  scope: DeleteScope,
): Promise<DeleteImpact> {
  return (await planDeletion(db, householdId, id, scope)).impact;
}

/**
 * Exclui o lançamento (e, com `scope = 'with-future'`, as parcelas futuras do
 * plano), numa transação. Devolve o que de fato apagou.
 *
 * Irreversível: o app não tem desfazer.
 */
export async function deleteTransaction(
  householdId: string,
  id: string,
  scope: DeleteScope,
): Promise<DeleteImpact['deleted']> {
  return db.transaction(async (tx: DbTransaction) => {
    // A trava vale para a dispensa: o `topUpPlanned` que está rodando relê sob a
    // mesma trava e enxerga a marca. Tomada sempre, o custo é um lock curto.
    await lockHousehold(tx, householdId);
    const plan = await planDeletion(tx, householdId, id, scope);

    // `paid_transaction_id` não tem cascata: sem anular, o DELETE violaria a FK.
    await tx
      .update(statements)
      .set({ paidTransactionId: null })
      .where(inArray(statements.paidTransactionId, plan.ids));

    if (plan.skip !== null) {
      await recordSkippedOccurrence(tx, householdId, plan.skip.origin, plan.skip.competence);
    }

    const removed = await tx
      .delete(transactions)
      .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, plan.ids)))
      .returning({ id: transactions.id });
    if (removed.length !== plan.ids.length) {
      // Alguém apagou no meio: desfaz tudo e não afirma um número que não é.
      throw new TransactionNotFoundError();
    }

    if (plan.decrementBatchId !== null) {
      await tx
        .update(importBatches)
        .set({ rowsImported: sql`GREATEST(${importBatches.rowsImported} - 1, 0)` })
        .where(and(eq(importBatches.id, plan.decrementBatchId), eq(importBatches.householdId, householdId)));
    }

    if (plan.planId !== null) {
      const [remaining] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), eq(transactions.installmentPlanId, plan.planId)))
        .limit(1);
      if (remaining === undefined) {
        await tx
          .delete(installmentPlans)
          .where(and(eq(installmentPlans.id, plan.planId), eq(installmentPlans.householdId, householdId)));
      }
    }

    return plan.impact.deleted;
  });
}
