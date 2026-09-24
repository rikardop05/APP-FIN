import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { ImportFormat, TransactionKind, TransactionStatus } from '@/lib/db';
import {
  accounts,
  categorizationRules,
  categories,
  creditCards,
  importBatches,
  installmentPlans,
  members,
  statements,
  transactions,
} from '@/lib/db/schema';
import { statementWindow, type CardCycleConfig } from '@/lib/finance/billing';
import {
  finalizeImport,
  type ConfirmedRow,
  type FinalizeResult,
  type SourceKind,
} from '@/lib/import/pipeline';
import type { Rule } from '@/lib/finance/categorization';
import type { Cents } from '@/lib/money';
import { listTransactionDedupeHashes } from './transactions';

export type ImportSourceContext = {
  sourceId: string;
  sourceKind: SourceKind;
  creditCardId: string | null;
  accountId: string | null;
  cardCycle: CardCycleConfig | null;
};

export type ImportBatchHistoryItem = {
  id: string;
  fileName: string;
  fileHash: string;
  status: 'pending' | 'committed' | 'reverted' | 'failed';
  createdAt: Date;
};

export type ImportPreparation = {
  source: ImportSourceContext;
  rules: Rule[];
  existingHashes: Set<string>;
  previousBatches: ImportBatchHistoryItem[];
};

export type CommitImportInput = {
  fileName: string;
  fileHash: string;
  bankKey: string | null;
  format: ImportFormat;
  sourceKind: SourceKind;
  sourceId: string;
  confirmedRows: ConfirmedRow[];
  reportedTotalCents: Cents | null;
  allowReimport: boolean;
};

export type CommitImportResult = FinalizeResult & {
  batchId: string;
  rowsRead: number;
  rowsImported: number;
  rowsDuplicated: number;
};

export type CommitImportTestOptions = {
  /** Test-only failpoint; routes never pass it. Production callers are rejected. */
  failAfter?: 'batch' | 'statement' | 'plans' | 'transactions';
};

export type RevertImportResult = {
  batchId: string;
  transactionsDeleted: number;
  installmentPlansDeleted: number;
};

export class ImportSourceNotFoundError extends Error {
  constructor() {
    super('A origem da importação não pertence a esta família ou está inativa.');
    this.name = 'ImportSourceNotFoundError';
  }
}

export class ImportBatchNotFoundError extends Error {
  constructor() {
    super('Lote de importação não encontrado.');
    this.name = 'ImportBatchNotFoundError';
  }
}

export class ImportAlreadyCommittedError extends Error {
  constructor() {
    super('Este arquivo já foi importado. Confirme a reimportação para continuar.');
    this.name = 'ImportAlreadyCommittedError';
  }
}

export class ImportAccountInstallmentError extends Error {
  constructor() {
    super('Parcelamentos só podem ser importados em cartão de crédito.');
    this.name = 'ImportAccountInstallmentError';
  }
}

async function sourceContext(
  householdId: string,
  sourceKind: SourceKind,
  sourceId: string,
): Promise<ImportSourceContext> {
  if (sourceKind === 'credit_card') {
    const [card] = await db
      .select({
        id: creditCards.id,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
      })
      .from(creditCards)
      .where(
        and(
          eq(creditCards.id, sourceId),
          eq(creditCards.householdId, householdId),
          eq(creditCards.active, true),
        ),
      )
      .limit(1);
    if (card === undefined) throw new ImportSourceNotFoundError();
    return {
      sourceId,
      sourceKind,
      creditCardId: card.id,
      accountId: null,
      cardCycle: { closingDay: card.closingDay, dueDay: card.dueDay },
    };
  }

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, sourceId),
        eq(accounts.householdId, householdId),
        eq(accounts.active, true),
      ),
    )
    .limit(1);
  if (account === undefined) throw new ImportSourceNotFoundError();
  return {
    sourceId,
    sourceKind,
    creditCardId: null,
    accountId: account.id,
    cardCycle: null,
  };
}

async function listImportRules(householdId: string): Promise<Rule[]> {
  const rows = await db
    .select({
      id: categorizationRules.id,
      pattern: categorizationRules.pattern,
      matchType: categorizationRules.matchType,
      categoryId: categorizationRules.categoryId,
      memberId: categorizationRules.memberId,
      priority: categorizationRules.priority,
      active: categorizationRules.active,
    })
    .from(categorizationRules)
    .where(eq(categorizationRules.householdId, householdId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
  return rows;
}

async function listPreviousBatches(
  householdId: string,
  fileHash: string,
): Promise<ImportBatchHistoryItem[]> {
  return db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      fileHash: importBatches.fileHash,
      status: importBatches.status,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(and(eq(importBatches.householdId, householdId), eq(importBatches.fileHash, fileHash)))
    .orderBy(desc(importBatches.createdAt));
}

export async function prepareImport(
  householdId: string,
  sourceKind: SourceKind,
  sourceId: string,
  fileHash: string,
): Promise<ImportPreparation> {
  const [source, rules, existingHashes, previousBatches] = await Promise.all([
    sourceContext(householdId, sourceKind, sourceId),
    listImportRules(householdId),
    listTransactionDedupeHashes(householdId),
    listPreviousBatches(householdId, fileHash),
  ]);
  return { source, rules, existingHashes, previousBatches };
}

async function ensureReferences(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  householdId: string,
  rows: readonly ConfirmedRow[],
): Promise<void> {
  const categoryIds = [...new Set(rows.flatMap((row) => (row.categoryId === null ? [] : [row.categoryId])))];
  const memberIds = [...new Set(rows.flatMap((row) => (row.memberId === null ? [] : [row.memberId])))];

  if (categoryIds.length > 0) {
    const found = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), inArray(categories.id, categoryIds)));
    if (found.length !== categoryIds.length) throw new ImportSourceNotFoundError();
  }
  if (memberIds.length > 0) {
    const found = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.householdId, householdId), inArray(members.id, memberIds)));
    if (found.length !== memberIds.length) throw new ImportSourceNotFoundError();
  }
}

async function findOrCreateStatement(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  householdId: string,
  source: ImportSourceContext,
  result: FinalizeResult,
): Promise<string | null> {
  if (source.creditCardId === null || source.cardCycle === null) return null;
  const sourceTransaction = result.transactions.find((row) => row.rawDescription !== '') ?? result.transactions[0];
  if (sourceTransaction === undefined) return null;
  const window = statementWindow(sourceTransaction.competence, source.cardCycle);
  const [existing] = await tx
    .select({ id: statements.id })
    .from(statements)
    .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
    .where(
      and(
        eq(statements.creditCardId, source.creditCardId),
        eq(statements.period, sourceTransaction.competence),
        eq(creditCards.householdId, householdId),
      ),
    )
    .limit(1);
  if (existing !== undefined) return existing.id;

  const [created] = await tx
    .insert(statements)
    .values({
      creditCardId: source.creditCardId,
      period: sourceTransaction.competence,
      closingDate: window.closingDate,
      dueDate: window.dueDate,
      reportedTotalCents: result.totals.reportedCents,
      status: 'open',
      source: 'import',
    })
    .returning({ id: statements.id });
  if (created === undefined) throw new Error('Não foi possível criar a fatura da importação.');
  return created.id;
}

export async function commitImport(
  householdId: string,
  input: CommitImportInput,
  options: CommitImportTestOptions = {},
): Promise<CommitImportResult> {
  if (options.failAfter !== undefined && process.env.NODE_ENV === 'production') {
    throw new Error('O failpoint de teste não pode ser usado em produção.');
  }
  return db.transaction(async (tx) => {
    const source = await sourceContextInTransaction(tx, householdId, input.sourceKind, input.sourceId);
    const previous = await tx
      .select({ id: importBatches.id, status: importBatches.status })
      .from(importBatches)
      .where(and(eq(importBatches.householdId, householdId), eq(importBatches.fileHash, input.fileHash)))
      .orderBy(desc(importBatches.createdAt));
    if (!input.allowReimport && previous.some((batch) => batch.status === 'committed')) {
      throw new ImportAlreadyCommittedError();
    }

    const hashRows = await tx
      .select({ dedupeHash: transactions.dedupeHash })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.dedupeHash)));
    const existingHashes = new Set(
      hashRows.flatMap((row) => (row.dedupeHash === null ? [] : [row.dedupeHash])),
    );
    const result = finalizeImport({
      rows: input.confirmedRows,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      cardCycle: source.cardCycle,
      existingHashes,
      reportedTotalCents: input.reportedTotalCents,
    });
    if (source.sourceKind === 'account' && result.installmentPlans.length > 0) {
      throw new ImportAccountInstallmentError();
    }
    await ensureReferences(tx, householdId, input.confirmedRows);

    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId,
        fileName: input.fileName,
        fileHash: input.fileHash,
        bankKey: input.bankKey,
        format: input.format,
        creditCardId: source.creditCardId,
        accountId: source.accountId,
        rowsRead: input.confirmedRows.length,
        rowsImported: 0,
        rowsDuplicated: result.skipped.filter((row) => row.reason === 'duplicate').length,
        status: 'pending',
      })
      .returning({ id: importBatches.id });
    if (batch === undefined) throw new Error('Não foi possível criar o lote de importação.');
    if (options.failAfter === 'batch') throw new Error('Falha de teste após o lote.');

    const statementId = await findOrCreateStatement(tx, householdId, source, result);
    if (statementId !== null) {
      await tx
        .update(importBatches)
        .set({ statementId })
        .where(and(eq(importBatches.id, batch.id), eq(importBatches.householdId, householdId)));
    }
    if (options.failAfter === 'statement') throw new Error('Falha de teste após a fatura.');

    const planIds = new Map<number, string>();
    for (const plan of result.installmentPlans) {
      if (source.creditCardId === null) throw new ImportAccountInstallmentError();
      const [createdPlan] = await tx
        .insert(installmentPlans)
        .values({
          householdId,
          creditCardId: source.creditCardId,
          description: plan.description,
          totalCents: plan.totalCents,
          installmentsCount: plan.installmentsCount,
          firstCompetence: plan.firstCompetence,
          categoryId: plan.categoryId,
          source: 'import',
        })
        .returning({ id: installmentPlans.id });
      if (createdPlan === undefined) throw new Error('Não foi possível criar o parcelamento.');
      planIds.set(plan.ref, createdPlan.id);
    }
    if (options.failAfter === 'plans') throw new Error('Falha de teste após os parcelamentos.');

    const importedRows = input.confirmedRows.filter((row) => row.include).length -
      result.skipped.filter((row) => row.reason === 'duplicate').length;
    if (result.transactions.length > 0) {
      await tx.insert(transactions).values(
        result.transactions.map((row) => {
          const projected = row.rawDescription === '';
          const kind: TransactionKind = row.amountCents < 0 ? 'expense' : 'income';
          const status: TransactionStatus = projected ? 'planned' : 'posted';
          return {
            householdId,
            occurredOn: row.occurredOn,
            competence: row.competence,
            cashDate: row.cashDate,
            description: row.description,
            rawDescription: row.rawDescription,
            amountCents: row.amountCents,
            kind,
            status,
            categoryId: row.categoryId,
            accountId: source.accountId,
            creditCardId: source.creditCardId,
            statementId: projected ? null : statementId,
            memberId: row.memberId,
            installmentPlanId: row.installmentPlanRef === null ? null : (planIds.get(row.installmentPlanRef) ?? null),
            installmentNumber: row.installmentNumber,
            importBatchId: batch.id,
            dedupeHash: row.dedupeHash,
          };
        }),
      );
    }
    if (options.failAfter === 'transactions') throw new Error('Falha de teste após os lançamentos.');

    await tx
      .update(importBatches)
      .set({
        rowsImported: importedRows,
        status: 'committed',
      })
      .where(and(eq(importBatches.id, batch.id), eq(importBatches.householdId, householdId)));

    return {
      ...result,
      batchId: batch.id,
      rowsRead: input.confirmedRows.length,
      rowsImported: importedRows,
      rowsDuplicated: result.skipped.filter((row) => row.reason === 'duplicate').length,
    };
  });
}

async function sourceContextInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  householdId: string,
  sourceKind: SourceKind,
  sourceId: string,
): Promise<ImportSourceContext> {
  if (sourceKind === 'credit_card') {
    const [card] = await tx
      .select({ id: creditCards.id, closingDay: creditCards.closingDay, dueDay: creditCards.dueDay })
      .from(creditCards)
      .where(and(eq(creditCards.id, sourceId), eq(creditCards.householdId, householdId), eq(creditCards.active, true)))
      .limit(1);
    if (card === undefined) throw new ImportSourceNotFoundError();
    return { sourceId, sourceKind, creditCardId: card.id, accountId: null, cardCycle: { closingDay: card.closingDay, dueDay: card.dueDay } };
  }
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, sourceId), eq(accounts.householdId, householdId), eq(accounts.active, true)))
    .limit(1);
  if (account === undefined) throw new ImportSourceNotFoundError();
  return { sourceId, sourceKind, creditCardId: null, accountId: account.id, cardCycle: null };
}

export async function revertImport(
  householdId: string,
  batchId: string,
): Promise<RevertImportResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select({ id: importBatches.id, statementId: importBatches.statementId, status: importBatches.status })
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.householdId, householdId)))
      .limit(1);
    if (batch === undefined) throw new ImportBatchNotFoundError();

    const batchTransactions = await tx
      .select({ id: transactions.id, installmentPlanId: transactions.installmentPlanId })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.importBatchId, batchId)));
    const planIds = [...new Set(batchTransactions.flatMap((row) => (row.installmentPlanId === null ? [] : [row.installmentPlanId])))];
    if (batchTransactions.length > 0) {
      await tx.delete(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.importBatchId, batchId)));
    }
    let installmentPlansDeleted = 0;
    if (planIds.length > 0) {
      const remaining = await tx
        .select({ id: transactions.installmentPlanId })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), inArray(transactions.installmentPlanId, planIds)));
      const remainingIds = new Set(remaining.flatMap((row) => (row.id === null ? [] : [row.id])));
      const deletable = planIds.filter((id) => !remainingIds.has(id));
      if (deletable.length > 0) {
        const deleted = await tx
          .delete(installmentPlans)
          .where(and(eq(installmentPlans.householdId, householdId), inArray(installmentPlans.id, deletable)))
          .returning({ id: installmentPlans.id });
        installmentPlansDeleted = deleted.length;
      }
    }

    await tx
      .update(importBatches)
      .set({ status: 'reverted', rowsImported: 0 })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.householdId, householdId)));

    if (batch.statementId !== null) {
      const [statement] = await tx
        .select({ id: statements.id, source: statements.source })
        .from(statements)
        .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
        .where(and(eq(statements.id, batch.statementId), eq(creditCards.householdId, householdId)))
        .limit(1);
      const [otherBatch] = await tx
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.householdId, householdId),
            eq(importBatches.statementId, batch.statementId),
            ne(importBatches.id, batchId),
            ne(importBatches.status, 'reverted'),
          ),
        )
        .limit(1);
      const [remainingStatementTransaction] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(creditCards, eq(creditCards.id, transactions.creditCardId))
        .where(and(eq(transactions.statementId, batch.statementId), eq(transactions.householdId, householdId), eq(creditCards.householdId, householdId)))
        .limit(1);
      if (statement?.source === 'import' && otherBatch === undefined && remainingStatementTransaction === undefined) {
        await tx
          .update(importBatches)
          .set({ statementId: null })
          .where(
            and(
              eq(importBatches.householdId, householdId),
              eq(importBatches.statementId, batch.statementId),
              eq(importBatches.status, 'reverted'),
            ),
          );
        await tx
          .delete(statements)
          .where(
            and(
              eq(statements.id, batch.statementId),
              inArray(
                statements.creditCardId,
                tx
                  .select({ id: creditCards.id })
                  .from(creditCards)
                  .where(eq(creditCards.householdId, householdId)),
              ),
            ),
          );
      }
    }

    return {
      batchId,
      transactionsDeleted: batchTransactions.length,
      installmentPlansDeleted,
    };
  });
}
