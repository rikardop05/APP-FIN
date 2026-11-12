import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '@/lib/db';
import { assertCategoryFitsKinds } from './category-kind';
import { canEditTransactionKind, type EditableTransactionKind } from './transactions-editable-kinds';
import { COUNTED_STATUSES } from './counted-statuses';
import { listReviewGroups } from './review-groups';
import { reconcileManualPosting } from './manual-reconcile';
import type {
  CategoryNature,
  TransactionKind,
  TransactionStatus,
} from '@/lib/db';
import { billingPeriodFor } from '@/lib/finance/billing';
import { monthlyKpis } from '@/lib/finance/kpis';
import { toCompetence, type Competence } from '@/lib/date';
import { listStatementSituations, settlementByCompetence, type CompetenceSettlement } from './card-settlement';
import type { PaymentKind } from './statement-settlement';
import {
  accounts,
  categories,
  creditCards,
  installmentPlans,
  members,
  transactions,
} from '@/lib/db/schema';
import { cents, type Cents } from '@/lib/money';

export type TransactionFilters = {
  /** Mês da lista (`YYYY-MM`): a COMPETÊNCIA, o eixo do app (em cartão, a da fatura). Ausente = todos os meses. */
  competence?: string;
  /** Filtro rápido: só receitas (`income`) ou só despesas (`expense`), pelo `kind`. */
  direction?: 'income' | 'expense';
  /** Filtro rápido: só lançamento de cartão ou só de conta. */
  origin?: 'card' | 'account';
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  creditCardId?: string;
  memberId?: string;
  search?: string;
  uncategorized?: boolean;
};

export type TransactionListItem = {
  id: string;
  occurredOn: string;
  competence: string;
  cashDate: string | null;
  description: string;
  rawDescription: string;
  amountCents: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
  categoryId: string | null;
  categoryName: string | null;
  categoryNature: CategoryNature | null;
  accountId: string | null;
  accountName: string | null;
  creditCardId: string | null;
  creditCardName: string | null;
  memberId: string | null;
  memberName: string | null;
  installmentNumber: number | null;
  /** Total de parcelas do plano ("Parcela 03/10"); null se nao e parcela. */
  installmentsCount: number | null;
  note: string | null;
  /**
   * Fatura do lancamento de cartao (pelo `statement_id`); null em conta e na parcela projetada sem
   * fatura. A tela so formata: o texto da situacao sai de `statementStatus` e `statementPayment`.
   */
  statementStatus: 'open' | 'closed' | 'paid' | null;
  statementDueDate: string | null;
  statementPayment: PaymentKind | null;
};

/** Pago e pendente das faturas de cartao por competencia (para o cabecalho de cada mes). */
export type TransactionListResult = { items: TransactionListItem[]; settlement: CompetenceSettlement[] };

export type TransactionFilterOption = { id: string; name: string };

export type CategoryFilterOption = TransactionFilterOption & {
  parentId: string | null;
  nature: CategoryNature;
};

export type TransactionFilterOptions = {
  categories: CategoryFilterOption[];
  accounts: TransactionFilterOption[];
  cards: TransactionFilterOption[];
  members: TransactionFilterOption[];
};

export type TransactionUpdate = {
  occurredOn?: string;
  description?: string;
  amountCents?: Cents;
  categoryId?: string | null;
  memberId?: string | null;
  note?: string | null;
  /** Troca de tipo (só lançamento de conta já lançado; ver `canEditTransactionKind`). */
  kind?: EditableTransactionKind;
};

export type ManualTransactionMutation = {
  occurredOn: string;
  description: string;
  amountCents: Cents;
  kind: TransactionKind;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  note: string | null;
};

export type CategorizationBatchMutation = {
  transactionIds: string[];
  categoryId: string;
  memberId: string | null;
};

export type RuleSource = {
  id: string;
  description: string;
  categoryId: string | null;
  memberId: string | null;
};

export class InvalidTransactionReferenceError extends Error {
  constructor() {
    super('Referência de lançamento inválida.');
    this.name = 'InvalidTransactionReferenceError';
  }
}

/** Troca de tipo pedida numa linha em que o tipo não é editável (cartão, previsão, pagamento de fatura). */
export class TransactionKindNotEditableError extends Error {
  constructor() {
    super('O tipo deste lançamento não pode ser alterado.');
    this.name = 'TransactionKindNotEditableError';
  }
}

/** Troca para Despesa com valor positivo ou para Receita com valor negativo: o sinal não combina com o tipo. */
export class TransactionKindSignError extends Error {
  constructor() {
    super('O valor não combina com o tipo: despesa é saída (negativa) e receita é entrada (positiva).');
    this.name = 'TransactionKindSignError';
  }
}

export class TransactionNotFoundError extends Error {
  constructor() {
    super('Lançamento não encontrado.');
    this.name = 'TransactionNotFoundError';
  }
}

function safeCents(value: string | number): Cents {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  // Drizzle e postgres-js podem entregar bigint como string; a validação acima
  // garante o inteiro seguro exigido pelo tipo Cents.
  return numeric as Cents;
}

async function ensureCategoryAndMemberReferences(
  householdId: string,
  categoryId: string | null,
  memberId: string | null,
): Promise<void> {
  const checks: Promise<unknown>[] = [];
  if (categoryId !== null) {
    checks.push(
      db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new InvalidTransactionReferenceError();
        }),
    );
  }
  if (memberId !== null) {
    checks.push(
      db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.householdId, householdId)))
        .limit(1)
        .then(([row]) => {
          if (!row) throw new InvalidTransactionReferenceError();
        }),
    );
  }
  await Promise.all(checks);
}

/**
 * Natureza x tipo: a categoria escolhida cabe nos lançamentos? (despesa não vai para categoria de
 * receita; receita só vai para categoria de receita.) Sem categoria (`null`), não há o que conferir.
 * Roda DEPOIS de `ensureCategoryAndMemberReferences`, que já garante que a categoria é da casa.
 */
async function ensureCategoryFitsKinds(
  householdId: string,
  categoryId: string | null,
  kinds: readonly TransactionKind[],
): Promise<void> {
  if (categoryId === null) return;
  const [category] = await db
    .select({ nature: categories.nature })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (!category) throw new InvalidTransactionReferenceError();
  assertCategoryFitsKinds(category.nature, kinds);
}

async function ensureAccountOrCardReference(
  householdId: string,
  accountId: string | null,
  creditCardId: string | null,
): Promise<void> {
  if ((accountId === null) === (creditCardId === null)) {
    throw new InvalidTransactionReferenceError();
  }

  if (accountId !== null) {
    const [row] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.householdId, householdId),
          eq(accounts.active, true),
        ),
      )
      .limit(1);
    if (!row) throw new InvalidTransactionReferenceError();
    return;
  }

  if (creditCardId === null) throw new InvalidTransactionReferenceError();

  const [row] = await db
    .select({ id: creditCards.id })
    .from(creditCards)
    .where(
      and(
        eq(creditCards.id, creditCardId),
        eq(creditCards.householdId, householdId),
        eq(creditCards.active, true),
      ),
    )
    .limit(1);
  if (!row) throw new InvalidTransactionReferenceError();
}

async function transactionDateFields(
  householdId: string,
  occurredOn: string,
  creditCardId: string | null,
): Promise<{ competence: string; cashDate: string }> {
  if (creditCardId !== null) {
    const [card] = await db
      .select({ closingDay: creditCards.closingDay, dueDay: creditCards.dueDay })
      .from(creditCards)
      .where(
        and(
          eq(creditCards.id, creditCardId),
          eq(creditCards.householdId, householdId),
        ),
      )
      .limit(1);
    if (!card) throw new InvalidTransactionReferenceError();
    const period = billingPeriodFor(occurredOn, card);
    return { competence: period.competence, cashDate: period.dueDate };
  }
  return { competence: toCompetence(occurredOn), cashDate: occurredOn };
}

function transactionPredicates(
  householdId: string,
  filters: TransactionFilters,
) {
  // A lista esconde a previsão `reconciled` (decisão nº 7): o lançamento real que
  // a cumpriu já a substituiu. Filtro positivo: status novo fica de fora.
  const predicates = [
    eq(transactions.householdId, householdId),
    inArray(transactions.status, COUNTED_STATUSES),
  ];
  if (filters.competence) predicates.push(eq(transactions.competence, filters.competence));
  if (filters.direction) predicates.push(eq(transactions.kind, filters.direction));
  if (filters.origin === 'card') predicates.push(isNotNull(transactions.creditCardId));
  if (filters.origin === 'account') predicates.push(isNotNull(transactions.accountId));
  if (filters.from) predicates.push(gte(transactions.occurredOn, filters.from));
  if (filters.to) predicates.push(lte(transactions.occurredOn, filters.to));
  if (filters.categoryId) predicates.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.accountId) predicates.push(eq(transactions.accountId, filters.accountId));
  if (filters.creditCardId) predicates.push(eq(transactions.creditCardId, filters.creditCardId));
  if (filters.memberId) predicates.push(eq(transactions.memberId, filters.memberId));
  if (filters.uncategorized) predicates.push(isNull(transactions.categoryId));
  if (filters.search) {
    const escapedSearch = filters.search.replace(/[\\%_]/g, (character) => `\\${character}`);
    const pattern = `%${escapedSearch}%`;
    predicates.push(
      or(
        ilike(transactions.description, pattern),
        ilike(transactions.rawDescription, pattern),
      )!,
    );
  }
  return predicates;
}

/** Receitas, Despesas e Sobra de um mês, para o resumo no topo de Lançamentos. */
export type MonthSummary = {
  competence: Competence;
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents;
};

/**
 * Resumo do mês de `/lancamentos`: os MESMOS números do Painel, pelo MESMO motor
 * (`monthlyKpis`) e pelo mesmo recorte do Painel (`getDashboardData`): todo lançamento
 * do household na competência, `posted` e `planned`. A tela não soma nada.
 *
 * É sempre o mês INTEIRO, nunca o filtro: os filtros da lista não entram aqui, e a
 * tela esconde o resumo quando há filtro ativo (um "total do filtro" seria outra
 * conta, com outro nome).
 *
 * `monthlyKpis` só olha `categoryNature` para a fatia essencial, que este resumo não
 * usa; sem categoria vai como `non_essential`, o mesmo default do Painel.
 */
export async function getMonthSummary(householdId: string, competence: Competence): Promise<MonthSummary> {
  const rows = await db
    .select({
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      status: transactions.status,
      categoryNature: sql<CategoryNature>`COALESCE(${categories.nature}, 'non_essential')`,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
    )
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.competence, competence),
        inArray(transactions.status, COUNTED_STATUSES),
      ),
    );
  const kpis = monthlyKpis({
    competence,
    transactions: rows.map((row) => ({ ...row, amountCents: safeCents(row.amountCents) })),
    // Não fazem parte deste resumo; o motor só os repassa.
    futureInstallmentsCents: cents(0),
    uncategorizedCount: 0,
  });
  return {
    competence,
    incomeCents: kpis.incomeCents,
    expenseCents: kpis.expenseCents,
    surplusCents: kpis.surplusCents,
  };
}

/**
 * Quantos lançamentos do HOUSEHOLD a revisão de sem categoria vai mostrar, em qualquer mês: o
 * número do botão "Revisar N sem categoria". Não depende do filtro da lista.
 *
 * É a SOMA dos itens dos grupos de `listReviewGroups`, a leitura da tela de destino
 * (`/lancamentos/revisar`): o recorte (sem categoria, fora `reconciled`, recorrência, renda fixa e
 * parcelamento já categorizado, só despesa e receita de valor diferente de zero) é o dela por
 * construção, então o botão nunca diz "Revisar 1" e abre vazio. O Painel conta de forma mais larga
 * e só na competência corrente; os dois podem divergir.
 */
export async function countUncategorized(householdId: string): Promise<number> {
  const groups = await listReviewGroups(householdId);
  return groups.reduce((total, group) => total + group.transactionIds.length, 0);
}

export async function listTransactions(
  householdId: string,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  return (await listTransactionsWithSettlement(householdId, filters)).items;
}

export async function listTransactionsWithSettlement(
  householdId: string,
  filters: TransactionFilters = {},
): Promise<TransactionListResult> {
  const [rows, situations] = await Promise.all([listTransactionRows(householdId, filters), listStatementSituations(householdId)]);
  const bySt = new Map(situations.map((item) => [item.statementId, item]));
  return {
    items: rows.map(({ statementId, ...row }) => {
      const situation = statementId === null ? undefined : bySt.get(statementId);
      return {
        ...row,
        amountCents: safeCents(row.amountCents),
        statementStatus: situation?.status ?? null,
        statementDueDate: situation?.dueDate ?? null,
        statementPayment: situation?.kind ?? null,
      };
    }),
    settlement: settlementByCompetence(situations),
  };
}

async function listTransactionRows(householdId: string, filters: TransactionFilters) {
  return await db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      competence: transactions.competence,
      cashDate: transactions.cashDate,
      description: transactions.description,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      status: transactions.status,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryNature: categories.nature,
      accountId: transactions.accountId,
      accountName: accounts.name,
      creditCardId: transactions.creditCardId,
      creditCardName: creditCards.name,
      memberId: transactions.memberId,
      memberName: members.name,
      installmentNumber: transactions.installmentNumber,
      installmentsCount: installmentPlans.installmentsCount,
      note: transactions.note,
      statementId: transactions.statementId,
    })
    .from(transactions)
    .leftJoin(
      installmentPlans,
      and(
        eq(installmentPlans.id, transactions.installmentPlanId),
        eq(installmentPlans.householdId, householdId),
      ),
    )
    .leftJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
      ),
    )
    .leftJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.householdId, householdId),
      ),
    )
    .leftJoin(
      creditCards,
      and(
        eq(creditCards.id, transactions.creditCardId),
        eq(creditCards.householdId, householdId),
      ),
    )
    .leftJoin(
      members,
      and(eq(members.id, transactions.memberId), eq(members.householdId, householdId)),
    )
    .where(and(...transactionPredicates(householdId, filters)))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));
}

export async function listTransactionFilterOptions(
  householdId: string,
): Promise<TransactionFilterOptions> {
  const [categoryRows, accountRows, cardRows, memberRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId, nature: categories.nature })
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(asc(categories.name)),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(asc(accounts.name)),
    db
      .select({ id: creditCards.id, name: creditCards.name })
      .from(creditCards)
      .where(and(eq(creditCards.householdId, householdId), eq(creditCards.active, true)))
      .orderBy(asc(creditCards.name)),
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.householdId, householdId))
      .orderBy(asc(members.name)),
  ]);

  return {
    categories: categoryRows,
    accounts: accountRows,
    cards: cardRows,
    members: memberRows,
  };
}

/**
 * Hashes already persisted for this household.
 *
 * Import preview and commit use the set only as input to the pure pipeline;
 * the household predicate remains here so a hash from another family can
 * never make this family's import look duplicated.
 */
export async function listTransactionDedupeHashes(
  householdId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ dedupeHash: transactions.dedupeHash })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNotNull(transactions.dedupeHash),
      ),
    );

  return new Set(
    rows.flatMap((row) => (row.dedupeHash === null ? [] : [row.dedupeHash])),
  );
}

export async function getTransactionForRule(
  householdId: string,
  id: string,
): Promise<RuleSource> {
  const [row] = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      categoryId: transactions.categoryId,
      memberId: transactions.memberId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  if (!row) throw new TransactionNotFoundError();
  return row;
}

export async function updateTransaction(
  householdId: string,
  id: string,
  input: TransactionUpdate,
): Promise<void> {
  await ensureCategoryAndMemberReferences(
    householdId,
    input.categoryId ?? null,
    input.memberId ?? null,
  );
  const [existing] = await db
    .select({
      creditCardId: transactions.creditCardId,
      accountId: transactions.accountId,
      kind: transactions.kind,
      status: transactions.status,
      categoryId: transactions.categoryId,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  if (!existing) throw new TransactionNotFoundError();
  // Troca de tipo (ex.: entrada que não é renda vira Transferência e sai da Sobra, RC-03). O valor
  // e o sinal não são tocados aqui: quem move a conta é o sinal, e ele fica como estava.
  const kindChanged = input.kind !== undefined && input.kind !== existing.kind;
  if (kindChanged && !canEditTransactionKind(existing)) throw new TransactionKindNotEditableError();
  const kind = input.kind ?? existing.kind;
  // Na TROCA para Despesa ou Receita o valor que fica (o do corpo, ou o já gravado) tem de ter o
  // sinal do tipo: sem isto, um PATCH só com `kind` gravaria Despesa positiva, que o orçamento lê
  // como estorno. Só na troca: editar a descrição de um dado antigo inconsistente não pode travar.
  if (kindChanged) {
    const amount = input.amountCents ?? safeCents(existing.amountCents);
    if ((kind === 'expense' && amount > 0) || (kind === 'income' && amount < 0)) throw new TransactionKindSignError();
  }
  // Só confere quando a edição MUDA a categoria ou o tipo: editar a descrição de um lançamento
  // antigo que já estava numa categoria que não cabe não pode travar. Na troca de tipo sem
  // categoria no corpo, a categoria que FICA na linha tem de caber no tipo novo.
  if (input.categoryId !== undefined || kindChanged) {
    const categoryId = input.categoryId !== undefined ? input.categoryId : existing.categoryId;
    await ensureCategoryFitsKinds(householdId, categoryId, [kind]);
  }

  const dateFields = input.occurredOn
    ? await transactionDateFields(householdId, input.occurredOn, existing.creditCardId)
    : {};
  const result = await db
    .update(transactions)
    .set({ ...input, ...dateFields })
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .returning({ id: transactions.id });
  if (result.length === 0) throw new TransactionNotFoundError();
}

export async function categorizeTransactionsBatch(
  householdId: string,
  input: CategorizationBatchMutation,
): Promise<number> {
  await ensureCategoryAndMemberReferences(householdId, input.categoryId, input.memberId);
  const existing = await db
    .select({ id: transactions.id, kind: transactions.kind })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.id, input.transactionIds),
      ),
    );
  if (existing.length !== input.transactionIds.length) {
    throw new InvalidTransactionReferenceError();
  }
  // Um único lançamento que não cabe recusa o lote inteiro: nada é alterado.
  await ensureCategoryFitsKinds(householdId, input.categoryId, existing.map((row) => row.kind));

  const updated = await db
    .update(transactions)
    .set({ categoryId: input.categoryId, memberId: input.memberId })
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.id, input.transactionIds),
      ),
    )
    .returning({ id: transactions.id });
  return updated.length;
}

/**
 * Grava o lançamento manual. Com `reconcilePlannedId` (a pessoa CONFIRMOU que ele cumpre
 * aquela previsão, decisão 16a), a previsão vira `reconciled` na MESMA transação; se ela não
 * couber mais, nada é gravado (`PlannedNotReconcilableError`). Sem a opção, grava normal:
 * nunca concilia sozinho.
 */
export async function createManualTransaction(
  householdId: string,
  input: ManualTransactionMutation,
  options: { reconcilePlannedId?: string | null } = {},
): Promise<string> {
  await Promise.all([
    ensureCategoryAndMemberReferences(householdId, input.categoryId, input.memberId),
    ensureAccountOrCardReference(householdId, input.accountId, input.creditCardId),
  ]);
  await ensureCategoryFitsKinds(householdId, input.categoryId, [input.kind]);
  const dateFields = await transactionDateFields(householdId, input.occurredOn, input.creditCardId);
  const plannedId = options.reconcilePlannedId ?? null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        householdId,
        occurredOn: input.occurredOn,
        ...dateFields,
        description: input.description,
        rawDescription: '',
        amountCents: input.amountCents,
        kind: input.kind,
        status: 'posted',
        categoryId: input.categoryId,
        accountId: input.accountId,
        creditCardId: input.creditCardId,
        memberId: input.memberId,
        note: input.note,
      })
      .returning({ id: transactions.id });
    if (!row) throw new Error('Não foi possível criar o lançamento.');
    if (plannedId !== null) {
      await reconcileManualPosting(tx, householdId, row.id, input, plannedId);
    }
    return row.id;
  });
}
