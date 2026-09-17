import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { AccountKind, CardBrand } from '@/lib/db';
import { accounts, creditCards, members, statements, transactions } from '@/lib/db/schema';
import type { Cents } from '@/lib/money';

export type AccountMutation = {
  name: string;
  bank: string | null;
  kind: AccountKind;
  openingBalanceCents: Cents;
  openingDate: string;
};

export type CardMutation = {
  name: string;
  bank: string | null;
  brand: CardBrand;
  holderMemberId: string | null;
  paymentAccountId: string | null;
  creditLimitCents: Cents | null;
  closingDay: number;
  dueDay: number;
};

export type AccountListItem = {
  id: string;
  name: string;
  bank: string | null;
  kind: AccountKind;
  openingBalanceCents: Cents;
  openingDate: string;
  active: boolean;
};

export type StatementListItem = {
  id: string;
  period: string;
  closingDate: string;
  dueDate: string;
  reportedTotalCents: Cents | null;
  computedTotalCents: Cents;
  differenceCents: Cents | null;
  status: 'open' | 'closed' | 'paid';
  source: 'import' | 'manual' | 'generated';
};

export type CardListItem = {
  id: string;
  name: string;
  bank: string | null;
  brand: CardBrand;
  holderMemberId: string | null;
  paymentAccountId: string | null;
  creditLimitCents: Cents | null;
  closingDay: number;
  dueDay: number;
  active: boolean;
  statements: StatementListItem[];
};

export type MemberListItem = { id: string; name: string };

export class InvalidCardReferenceError extends Error {
  constructor() {
    super('Referência de cartão inválida.');
    this.name = 'InvalidCardReferenceError';
  }
}

async function ensureCardReferencesBelongToHousehold(
  householdId: string,
  input: CardMutation,
): Promise<void> {
  if (input.holderMemberId !== null) {
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, input.holderMemberId), eq(members.householdId, householdId)))
      .limit(1);
    if (!member) throw new InvalidCardReferenceError();
  }
  if (input.paymentAccountId !== null) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, input.paymentAccountId),
          eq(accounts.householdId, householdId),
          eq(accounts.active, true),
        ),
      )
      .limit(1);
    if (!account) throw new InvalidCardReferenceError();
  }
}

function safeCents(value: string | number | null): Cents {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  // Drizzle e postgres-js entregam agregados bigint como number ou string; a
  // validação acima garante o inteiro seguro exigido pelo tipo Cents.
  return numeric as Cents;
}

export async function listAccounts(householdId: string): Promise<AccountListItem[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      bank: accounts.bank,
      kind: accounts.kind,
      openingBalanceCents: accounts.openingBalanceCents,
      openingDate: accounts.openingDate,
      active: accounts.active,
    })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
    .orderBy(asc(accounts.name));

  return rows.map((row) => ({
    ...row,
    openingBalanceCents: safeCents(row.openingBalanceCents),
  }));
}

export async function listMembers(householdId: string): Promise<MemberListItem[]> {
  return db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(eq(members.householdId, householdId))
    .orderBy(asc(members.name));
}

export async function listCards(householdId: string): Promise<CardListItem[]> {
  const [cardRows, statementRows] = await Promise.all([
    db
      .select({
        id: creditCards.id,
        name: creditCards.name,
        bank: creditCards.bank,
        brand: creditCards.brand,
        holderMemberId: creditCards.holderMemberId,
        paymentAccountId: creditCards.paymentAccountId,
        creditLimitCents: creditCards.creditLimitCents,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        active: creditCards.active,
      })
      .from(creditCards)
      .where(and(eq(creditCards.householdId, householdId), eq(creditCards.active, true)))
      .orderBy(asc(creditCards.name)),
    db
      .select({
        creditCardId: statements.creditCardId,
        id: statements.id,
        period: statements.period,
        closingDate: statements.closingDate,
        dueDate: statements.dueDate,
        reportedTotalCents: statements.reportedTotalCents,
        computedTotalCents: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
        status: statements.status,
        source: statements.source,
      })
      .from(statements)
      .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
      .leftJoin(
        transactions,
        and(
          eq(transactions.statementId, statements.id),
          eq(transactions.householdId, householdId),
        ),
      )
      .where(eq(creditCards.householdId, householdId))
      .groupBy(
        statements.creditCardId,
        statements.id,
        statements.period,
        statements.closingDate,
        statements.dueDate,
        statements.reportedTotalCents,
        statements.status,
        statements.source,
      )
      .orderBy(desc(statements.period)),
  ]);

  const statementsByCard = new Map<string, StatementListItem[]>();
  for (const row of statementRows) {
    const computedTotalCents = safeCents(row.computedTotalCents);
    const reportedTotalCents = row.reportedTotalCents === null ? null : safeCents(row.reportedTotalCents);
    const differenceCents =
      reportedTotalCents === null ? null : safeCents(computedTotalCents - reportedTotalCents);
    const list = statementsByCard.get(row.creditCardId) ?? [];
    list.push({
      id: row.id,
      period: row.period,
      closingDate: row.closingDate,
      dueDate: row.dueDate,
      reportedTotalCents,
      computedTotalCents,
      differenceCents,
      status: row.status,
      source: row.source,
    });
    statementsByCard.set(row.creditCardId, list);
  }

  return cardRows.map((row) => ({
    ...row,
    creditLimitCents: row.creditLimitCents === null ? null : safeCents(row.creditLimitCents),
    statements: statementsByCard.get(row.id) ?? [],
  }));
}

export async function createAccount(householdId: string, input: AccountMutation): Promise<void> {
  await db.insert(accounts).values({ householdId, ...input });
}

export async function updateAccount(
  householdId: string,
  id: string,
  input: AccountMutation,
): Promise<void> {
  await db
    .update(accounts)
    .set(input)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
}

export async function deactivateAccount(householdId: string, id: string): Promise<void> {
  await db
    .update(accounts)
    .set({ active: false })
    .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
}

export async function createCard(householdId: string, input: CardMutation): Promise<void> {
  await ensureCardReferencesBelongToHousehold(householdId, input);
  await db.insert(creditCards).values({ householdId, ...input });
}

export async function updateCard(
  householdId: string,
  id: string,
  input: CardMutation,
): Promise<void> {
  await ensureCardReferencesBelongToHousehold(householdId, input);
  await db
    .update(creditCards)
    .set(input)
    .where(and(eq(creditCards.id, id), eq(creditCards.householdId, householdId)));
}

export async function deactivateCard(householdId: string, id: string): Promise<void> {
  await db
    .update(creditCards)
    .set({ active: false })
    .where(and(eq(creditCards.id, id), eq(creditCards.householdId, householdId)));
}
