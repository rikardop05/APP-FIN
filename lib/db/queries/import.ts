import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
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
import type { Competence } from '@/lib/date';
import {
  attributeRules,
  finalizeImport,
  type ConfirmedRow,
  type FinalizeResult,
  type SourceKind,
} from '@/lib/import/pipeline';
import type { Rule } from '@/lib/finance/categorization';
import type { Cents } from '@/lib/money';
import { reconcileImportedPostings } from './import-reconcile';
import { importedRowsCount } from './import-counts';
import { kindForAmount } from './import-kind';
import { incrementRuleHits } from './auto-categorization';
import { listTransactionDedupeHashes } from './transactions';
import { cardHoldersByLast4 } from './card-holders';
import { listExistingInstallmentPlans, type ExistingInstallmentPlan } from './import-plans';

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
  /**
   * Final -> memberId do cartao da importacao (decisao 20), para
   * `BuildImportPreviewInput.cardHolders`. Importacao em conta: mapa vazio.
   */
  cardHolders: Map<string, string>;
  /**
   * Parcelamentos ja gravados do cartao da importacao, para `existingPlans`
   * (CONTRACTS §16): a fatura seguinte reconhece o plano em vez de criar outro.
   * Importacao em conta: vazio.
   */
  existingPlans: ExistingInstallmentPlan[];
};

/**
 * Forma discriminada por `sourceKind` — a mesma técnica do
 * `commitBodySchema` em `app/api/import/schemas.ts`. O tipo carrega a regra:
 * cartão traz `statementCompetence: Competence` (sem `null`), conta traz
 * `statementCompetence: null`. O `as Competence` e a guarda de runtime
 * somem porque o TypeScript estreita sozinho.
 */
type BaseCommitImportFields = {
  fileName: string;
  fileHash: string;
  bankKey: string | null;
  format: ImportFormat;
  sourceId: string;
  confirmedRows: ConfirmedRow[];
  reportedTotalCents: Cents | null;
  allowReimport: boolean;
};

export type CommitImportInput =
  | (BaseCommitImportFields & {
      sourceKind: 'credit_card';
      /**
       * Competência DECLARADA da fatura (mesmo campo `defaultCompetence` que o
       * upload usa). Obrigatória quando a origem é cartão (validado pelo
       * `commitBodySchema`); vem da escolha do usuário na tela.
       */
      statementCompetence: Competence;
    })
  | (BaseCommitImportFields & {
      sourceKind: 'account';
      /** Em conta não há fatura; o campo não se aplica. */
      statementCompetence: null;
    });

export type CommitImportResult = FinalizeResult & {
  batchId: string;
  rowsRead: number;
  rowsImported: number;
  rowsDuplicated: number;
  /** Previsões de recorrência cumpridas por linhas deste lote (viraram `reconciled`). */
  plannedReconciled: number;
  /** Parcelas previstas de planos existentes cumpridas pela parcela real deste lote. */
  installmentsReconciled: number;
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

async function listImportRules(householdId: string, executor: Executor = db): Promise<Rule[]> {
  const rows = await executor
    .select({
      id: categorizationRules.id,
      pattern: categorizationRules.pattern,
      matchType: categorizationRules.matchType,
      categoryId: categorizationRules.categoryId,
      memberId: categorizationRules.memberId,
      priority: categorizationRules.priority,
      active: categorizationRules.active,
      // Natureza da categoria: a sugestao e o rastro pulam a regra que nao cabe
      // no sinal da linha (`matchRuleForAmount`).
      categoryNature: categories.nature,
    })
    .from(categorizationRules)
    .innerJoin(categories, eq(categories.id, categorizationRules.categoryId))
    .where(eq(categorizationRules.householdId, householdId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
  return rows;
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Qual regra deu a categoria de cada linha (F3, CONTRACTS §6.2). A regra e
 * pura e testada em `lib/import` (`attributeRules`): a mesma regra vencedora do
 * preview, que pula categoria de natureza incompativel com o sinal da linha.
 */
function ruleAttribution(
  rules: Rule[],
  rows: readonly { description: string; amountCents: Cents; categoryId: string | null }[],
): (string | null)[] {
  return attributeRules(rules, rows);
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
  const [source, rules, existingHashes, previousBatches, cardHolders, existingPlans] = await Promise.all([
    sourceContext(householdId, sourceKind, sourceId),
    listImportRules(householdId),
    listTransactionDedupeHashes(householdId),
    listPreviousBatches(householdId, fileHash),
    sourceKind === 'credit_card'
      ? cardHoldersByLast4(householdId, sourceId)
      : Promise.resolve(new Map<string, string>()),
    sourceKind === 'credit_card'
      ? listExistingInstallmentPlans(householdId, sourceId)
      : Promise.resolve([]),
  ]);
  return { source, rules, existingHashes, previousBatches, cardHolders, existingPlans };
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
  statementCompetence: Competence,
): Promise<string | null> {
  if (source.creditCardId === null || source.cardCycle === null) return null;
  // A competência da fatura é DECLARADA: vem da tela, não de uma transação
  // qualquer. Pegar de uma transação era chute (pegar a primeira que o parser
  // emitiu), e a primeira transação não é fonte legítima dessa informação —
  // uma fatura contém compras de vários meses por construção.
  const window = statementWindow(statementCompetence, source.cardCycle);
  const [existing] = await tx
    .select({ id: statements.id })
    .from(statements)
    .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
    .where(
      and(
        eq(statements.creditCardId, source.creditCardId),
        eq(statements.period, statementCompetence),
        eq(creditCards.householdId, householdId),
      ),
    )
    .limit(1);
  if (existing !== undefined) {
    // Fatura que já existe (2º lote do período, ou `allowReimport`) não pode
    // descartar o total impresso do documento: sem ele a conciliação impresso ×
    // soma nunca dispara. COALESCE: só preenche o que está NULL; um total já
    // gravado não é sobrescrito (idempotente).
    if (result.totals.reportedCents !== null) {
      await tx
        .update(statements)
        .set({
          reportedTotalCents: sql`coalesce(${statements.reportedTotalCents}, ${result.totals.reportedCents})`,
        })
        .where(eq(statements.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await tx
    .insert(statements)
    .values({
      creditCardId: source.creditCardId,
      period: statementCompetence,
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
    // A guarda de runtime que existia aqui
    // (`if (sourceKind === 'credit_card' && statementCompetence === null) throw`)
    // era redundante com o tipo: a uniao discriminada por `sourceKind` em
    // `CommitImportInput` garante em tempo de compilacao que o campo so e
    // `null` quando a origem e conta. O schema do commit valida o mesmo.
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
    // Planos ja gravados do cartao, lidos DENTRO da transacao: a fatura seguinte
    // liga a parcela real ao plano existente e concilia a prevista de mesmo
    // numero, em vez de criar outro plano e reprojetar (CONTRACTS §16).
    const existingPlans =
      source.creditCardId === null ? [] : await listExistingInstallmentPlans(householdId, source.creditCardId, tx);
    const result = finalizeImport({
      rows: input.confirmedRows,
      existingPlans,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      cardCycle: source.cardCycle,
      existingHashes,
      reportedTotalCents: input.reportedTotalCents,
      statementCompetence: input.statementCompetence,
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

    const statementId = input.sourceKind === 'account' || source.creditCardId === null
      ? null
      : await findOrCreateStatement(
          tx,
          householdId,
          source,
          result,
          // Narrowed pela uniao discriminada: sourceKind === 'credit_card' garante
          // `statementCompetence: Competence` em tempo de tipo.
          input.statementCompetence,
        );
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

    // Todo o `skipped` sai da conta (desmarcada, duplicata e informativa), nao so as duplicatas.
    const importedRows = importedRowsCount(input.confirmedRows.length, result.skipped);
    let plannedReconciled = 0;
    let installmentsReconciled = 0;
    if (result.transactions.length > 0) {
      // Ids gerados aqui (não lidos do `returning`): a conciliação não depende da
      // ordem em que o Postgres devolve as linhas.
      const ids = result.transactions.map(() => randomUUID());
      // Regras lidas DENTRO da transacao: o rastro e os hits valem para o
      // estado das regras no momento do commit, nao no da previa.
      const ruleIds = ruleAttribution(await listImportRules(householdId, tx), result.transactions);
      await tx.insert(transactions).values(
        result.transactions.map((row, index) => {
          const projected = row.rawDescription === '';
          // Zero lanca (decisao 8): linha informativa nunca chega aqui.
          const kind: TransactionKind = kindForAmount(row.amountCents);
          const status: TransactionStatus = projected ? 'planned' : 'posted';
          return {
            id: ids[index],
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
            categoryRuleId: ruleIds[index] ?? null,
            accountId: source.accountId,
            creditCardId: source.creditCardId,
            statementId: projected ? null : statementId,
            memberId: row.memberId,
            installmentPlanId:
              row.installmentPlanId ??
              (row.installmentPlanRef === null ? null : (planIds.get(row.installmentPlanRef) ?? null)),
            installmentNumber: row.installmentNumber,
            importBatchId: batch.id,
            dedupeHash: row.dedupeHash,
          };
        }),
      );

      // RF-ORC-03: a linha REAL cumpre a previsão de recorrência. Parcela (de
      // plano) e projetada não conciliam.
      const postings = result.transactions.flatMap((row, index) => {
        const id = ids[index];
        if (id === undefined || row.rawDescription === '' || row.installmentPlanRef !== null || row.installmentPlanId !== null) {
          return [];
        }
        return [
          {
            id,
            occurredOn: row.occurredOn,
            amountCents: row.amountCents,
            categoryId: row.categoryId,
            kind: kindForAmount(row.amountCents),
            accountId: source.accountId,
          },
        ];
      });
      plannedReconciled = await reconcileImportedPostings(tx, householdId, postings);

      // Parcela real de plano existente cumpre a prevista de mesmo numero
      // (decisao n. 7: a prevista vira `reconciled`, sai da contagem, e o
      // `revertImport` a reabre). `status = 'planned'` e o plano na clausula:
      // prevista que mudou no meio nao e tocada.
      for (const [index, row] of result.transactions.entries()) {
        const id = ids[index];
        if (id === undefined || row.reconcilesTransactionId === null || row.installmentPlanId === null) continue;
        const updated = await tx
          .update(transactions)
          .set({ status: 'reconciled', reconciledByTransactionId: id })
          .where(
            and(
              eq(transactions.householdId, householdId),
              eq(transactions.id, row.reconcilesTransactionId),
              eq(transactions.installmentPlanId, row.installmentPlanId),
              eq(transactions.status, 'planned'),
            ),
          )
          .returning({ id: transactions.id });
        installmentsReconciled += updated.length;
      }

      // Uso da regra = linha REAL que ela categorizou. Parcela projetada
      // (planned) leva o rastro, mas nao e uso: contaria 10 vezes uma compra so.
      const hitsByRuleId: Record<string, number> = {};
      result.transactions.forEach((row, index) => {
        const ruleId = ruleIds[index];
        if (ruleId === null || ruleId === undefined || row.rawDescription === '') return;
        hitsByRuleId[ruleId] = (hitsByRuleId[ruleId] ?? 0) + 1;
      });
      await incrementRuleHits(householdId, hitsByRuleId, tx);
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
      plannedReconciled,
      installmentsReconciled,
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

    const batchRows = await tx
      .select({
        id: transactions.id,
        installmentPlanId: transactions.installmentPlanId,
        rawDescription: transactions.rawDescription,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.importBatchId, batchId)));
    const planIds = [...new Set(batchRows.flatMap((row) => (row.installmentPlanId === null ? [] : [row.installmentPlanId])))];

    // Plano que continua vivo: tem linha de OUTRO lote (a fatura seguinte ligou a
    // parcela real dela ao plano, CONTRACTS §16.2). As parcelas PROJETADAS deste
    // lote nesse plano sao o futuro do plano, nao do lote: ficam, soltas do lote.
    // Apaga-las sumiria com o comprometido em silencio, e reimportar este lote
    // nao as traria de volta (casa com o plano e nao reprojeta).
    const livePlanIds = new Set<string>();
    if (planIds.length > 0) {
      const outside = await tx
        .select({ id: transactions.installmentPlanId })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            inArray(transactions.installmentPlanId, planIds),
            or(isNull(transactions.importBatchId), ne(transactions.importBatchId, batchId)),
          ),
        );
      for (const row of outside) if (row.id !== null) livePlanIds.add(row.id);
    }
    const keptIds = batchRows
      .filter((row) => row.rawDescription === '' && row.installmentPlanId !== null && livePlanIds.has(row.installmentPlanId))
      .map((row) => row.id);
    if (keptIds.length > 0) {
      await tx
        .update(transactions)
        .set({ importBatchId: null })
        .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, keptIds)));
    }
    const kept = new Set(keptIds);
    const batchTransactions = batchRows.filter((row) => !kept.has(row.id));
    if (batchTransactions.length > 0) {
      // Desfazer a importação reabre as previsões que ela cumpriu: o RESTRICT de
      // `reconciled_by_transaction_id` barraria o DELETE (decisão nº 7, §3.3).
      await tx
        .update(transactions)
        .set({ status: 'planned', reconciledByTransactionId: null })
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.status, 'reconciled'),
            inArray(
              transactions.reconciledByTransactionId,
              batchTransactions.map((row) => row.id),
            ),
          ),
        );
      await tx.delete(transactions).where(
        and(
          eq(transactions.householdId, householdId),
          inArray(
            transactions.id,
            batchTransactions.map((row) => row.id),
          ),
        ),
      );
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
