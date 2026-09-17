import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from 'drizzle-orm';
import { db } from '@/lib/db';
import type {
  CategoryNature,
  MatchType,
  TransactionKind,
  TransactionStatus,
} from '@/lib/db';
import { billingPeriodFor } from '@/lib/finance/billing';
import { toCompetence } from '@/lib/date';
import {
  accounts,
  categorizationRules,
  categories,
  creditCards,
  members,
  transactions,
} from '@/lib/db/schema';
import type { Cents } from '@/lib/money';

export type TransactionFilters = {
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
  note: string | null;
};

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

export type RuleMutation = {
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  memberId: string | null;
  priority: number;
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
  const predicates = [eq(transactions.householdId, householdId)];
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

export async function listTransactions(
  householdId: string,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const rows = await db
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
      note: transactions.note,
    })
    .from(transactions)
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

  return rows.map((row) => ({
    ...row,
    amountCents: safeCents(row.amountCents),
  }));
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
    .select({ creditCardId: transactions.creditCardId })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  if (!existing) throw new TransactionNotFoundError();

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
    .select({ id: transactions.id })
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

export async function createManualTransaction(
  householdId: string,
  input: ManualTransactionMutation,
): Promise<string> {
  await Promise.all([
    ensureCategoryAndMemberReferences(householdId, input.categoryId, input.memberId),
    ensureAccountOrCardReference(householdId, input.accountId, input.creditCardId),
  ]);

  const [row] = await db
    .insert(transactions)
    .values({
      householdId,
      occurredOn: input.occurredOn,
      ...(await transactionDateFields(householdId, input.occurredOn, input.creditCardId)),
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
  return row.id;
}

export async function createCategorizationRule(
  householdId: string,
  input: RuleMutation,
): Promise<string> {
  await ensureCategoryAndMemberReferences(householdId, input.categoryId, input.memberId);
  const [row] = await db
    .insert(categorizationRules)
    .values({ householdId, ...input, active: true, hits: 0 })
    .returning({ id: categorizationRules.id });
  if (!row) throw new Error('Não foi possível criar a regra.');
  return row.id;
}
