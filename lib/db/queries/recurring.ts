/**
 * CRUD de despesas fixas e receitas recorrentes — T-204.
 *
 * O motor de cálculo (CONTRACTS §8) está em `lib/finance/recurrence.ts`, do
 * Esquadro. Esta camada é o gate de banco: garante que toda escrita respeita
 * as fronteiras (categoria-folha da despesa, memberId da família no caso da
 * receita, etc.) e devolve os dados para a tela em formato consumível.
 *
 * Regra de ouro: nada aqui faz conta de calendário. As ocorrências previstas
 * são calculadas por `expandRecurrence` (lib/finance) e GRAVADAS como linhas
 * `planned` de `transactions` na mesma transação da regra
 * (`recurring-planned-write.ts`); a tela lê o que existe.
 *
 * Fronteira de household (CONVENTIONS §7): toda `where` carrega
 * `eq(..., householdId)`. Validação de `memberId`, `categoryId`, `accountId`
 * e `creditCardId` é feita antes do insert/update — se não pertencer à
 * família, exceção tipada em vez de 404 genérico.
 */

import { and, asc, eq } from 'drizzle-orm';

import { db, type Frequency, type IncomeKind } from '@/lib/db';
import {
  accounts,
  categories,
  creditCards,
  incomes,
  members,
  recurringExpenses,
} from '@/lib/db/schema';
import {
  RecurringReferenceError,
  type IncomeInput,
  type IncomePatch,
  type RecurringExpenseInput,
  type RecurringExpensePatch,
  assertExpenseDestination,
  assertIncomeShape,
  assertRecurrenceShape,
} from '@/lib/db/queries/recurring-shape';
import {
  assertNoPlannedRows,
  planNewExpense,
  planNewIncome,
} from '@/lib/db/queries/recurring-planned-write';
import { cents, type Cents } from '@/lib/money';

// ---------------------------------------------------------------------------
// Erro tipado — re-exportado para a borda da rota usar
// `error.name === 'RecurringReferenceError'`. A definição vive em
// `recurring-shape.ts` (módulo SEM import de `@/lib/db`, para teste de regra
// pura sem precisar de banco).
// ---------------------------------------------------------------------------

export { RecurringReferenceError };

// ---------------------------------------------------------------------------
// Tipos públicos — formato da tela, não da tabela.
// ---------------------------------------------------------------------------

export type RecurringExpenseListItem = {
  id: string;
  description: string;
  expectedCents: Cents;
  categoryId: string;
  categoryName: string;
  dueDay: number;
  frequency: Frequency;
  accountId: string | null;
  accountName: string | null;
  creditCardId: string | null;
  creditCardName: string | null;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: number | null;
  active: boolean;
};

export type IncomeListItem = {
  id: string;
  description: string;
  kind: IncomeKind;
  expectedCents: Cents;
  memberId: string;
  memberName: string;
  accountId: string;
  accountName: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Helpers internos — borda do schema, repetidos nos dois CRUDs.
// ---------------------------------------------------------------------------

/** Lança se a despesa aponta para uma categoria que não é folha da família. */
async function assertLeafCategory(
  householdId: string,
  categoryId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (row === undefined) {
    throw new RecurringReferenceError('Categoria não encontrada.');
  }
  if (row.parentId === null) {
    throw new RecurringReferenceError('Categoria deve ser uma subcategoria (folha).');
  }
}

async function assertMemberBelongs(
  householdId: string,
  memberId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.householdId, householdId)))
    .limit(1);
  if (row === undefined) {
    throw new RecurringReferenceError('Responsável não encontrado.');
  }
}

async function assertAccountBelongs(
  householdId: string,
  accountId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.active, true)))
    .limit(1);
  if (row === undefined) {
    throw new RecurringReferenceError('Conta não encontrada ou inativa.');
  }
}

async function assertCardBelongs(
  householdId: string,
  cardId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: creditCards.id })
    .from(creditCards)
    .where(and(eq(creditCards.id, cardId), eq(creditCards.householdId, householdId), eq(creditCards.active, true)))
    .limit(1);
  if (row === undefined) {
    throw new RecurringReferenceError('Cartão não encontrado ou inativo.');
  }
}

// ---------------------------------------------------------------------------
// Despesas fixas — recurring_expenses
// ---------------------------------------------------------------------------

export async function listRecurringExpenses(
  householdId: string,
): Promise<RecurringExpenseListItem[]> {
  const rows = await db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      expectedCents: recurringExpenses.expectedCents,
      categoryId: recurringExpenses.categoryId,
      categoryName: categories.name,
      dueDay: recurringExpenses.dueDay,
      frequency: recurringExpenses.frequency,
      accountId: recurringExpenses.accountId,
      accountName: accounts.name,
      creditCardId: recurringExpenses.creditCardId,
      creditCardName: creditCards.name,
      startsOn: recurringExpenses.startsOn,
      endsOn: recurringExpenses.endsOn,
      annualAdjustmentBp: recurringExpenses.annualAdjustmentBp,
      active: recurringExpenses.active,
    })
    .from(recurringExpenses)
    .leftJoin(categories, eq(categories.id, recurringExpenses.categoryId))
    .leftJoin(accounts, eq(accounts.id, recurringExpenses.accountId))
    .leftJoin(creditCards, eq(creditCards.id, recurringExpenses.creditCardId))
    .where(eq(recurringExpenses.householdId, householdId))
    .orderBy(asc(recurringExpenses.description));

  return rows
    .filter((row): row is typeof row & { categoryName: string } => row.categoryName !== null)
    .map((row) => ({
      id: row.id,
      description: row.description,
      expectedCents: cents(row.expectedCents),
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      dueDay: row.dueDay,
      frequency: row.frequency,
      accountId: row.accountId,
      accountName: row.accountName,
      creditCardId: row.creditCardId,
      creditCardName: row.creditCardName,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      annualAdjustmentBp: row.annualAdjustmentBp,
      active: row.active,
    }));
}

export async function getRecurringExpense(
  householdId: string,
  id: string,
): Promise<RecurringExpenseListItem | null> {
  const items = await listRecurringExpenses(householdId);
  return items.find((item) => item.id === id) ?? null;
}

/**
 * Cria a despesa fixa E grava a previsão (`planned`) dos próximos
 * `projection_months`, na MESMA transação: ou entram a regra e as linhas, ou
 * nada. Uma falha na geração desfaz a regra — nada de despesa criada sem
 * previsão com 201 voltando.
 *
 * `today` é parâmetro (esta camada não lê o relógio).
 */
export async function createRecurringExpense(
  householdId: string,
  input: RecurringExpenseInput,
  today: string,
): Promise<string> {
  assertRecurrenceShape(input.frequency, input.startsOn, input.endsOn);
  assertExpenseDestination(input.accountId, input.creditCardId);
  await assertLeafCategory(householdId, input.categoryId);
  if (input.accountId !== null) await assertAccountBelongs(householdId, input.accountId);
  if (input.creditCardId !== null) await assertCardBelongs(householdId, input.creditCardId);
  const description = input.description.trim();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recurringExpenses)
      .values({
        householdId,
        description,
        expectedCents: input.expectedCents,
        categoryId: input.categoryId,
        dueDay: input.dueDay,
        frequency: input.frequency,
        accountId: input.accountId,
        creditCardId: input.creditCardId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        annualAdjustmentBp: input.annualAdjustmentBp,
        active: true,
      })
      .returning({ id: recurringExpenses.id });
    if (row === undefined) throw new Error('Não foi possível criar a despesa fixa.');
    await planNewExpense(
      tx,
      householdId,
      {
        id: row.id,
        description,
        expectedCents: input.expectedCents,
        categoryId: input.categoryId,
        dueDay: input.dueDay,
        frequency: input.frequency,
        accountId: input.accountId,
        creditCardId: input.creditCardId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        annualAdjustmentBp: input.annualAdjustmentBp,
      },
      today,
    );
    return row.id;
  });
}

export async function updateRecurringExpense(
  householdId: string,
  id: string,
  patch: RecurringExpensePatch,
): Promise<void> {
  // Ownership: precisa existir E ser da família.
  const current = await getRecurringExpense(householdId, id);
  if (current === null) {
    throw new RecurringReferenceError('Despesa fixa não encontrada.');
  }
  assertRecurrenceShape(patch.frequency, patch.startsOn, patch.endsOn);
  assertExpenseDestination(patch.accountId, patch.creditCardId);
  await assertLeafCategory(householdId, patch.categoryId);
  if (patch.accountId !== null) await assertAccountBelongs(householdId, patch.accountId);
  if (patch.creditCardId !== null) await assertCardBelongs(householdId, patch.creditCardId);
  // A previsão gravada não é regenerada por este caminho: recusa em vez de
  // deixar linhas com o valor antigo (ver `assertNoPlannedRows`).
  await assertNoPlannedRows(householdId, { expenseId: id });
  await db
    .update(recurringExpenses)
    .set({
      description: patch.description.trim(),
      expectedCents: patch.expectedCents,
      categoryId: patch.categoryId,
      dueDay: patch.dueDay,
      frequency: patch.frequency,
      accountId: patch.accountId,
      creditCardId: patch.creditCardId,
      startsOn: patch.startsOn,
      endsOn: patch.endsOn,
      annualAdjustmentBp: patch.annualAdjustmentBp,
    })
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.householdId, householdId)));
}

export async function deactivateRecurringExpense(
  householdId: string,
  id: string,
): Promise<void> {
  // Soft delete — `active = false`. Mantém histórico e vínculos com
  // ocorrências já projetadas (CONTRACTS §8 não exige cascata). Com previsão
  // gravada, recusa: as linhas `planned` ficariam contando uma despesa que a
  // família parou de esperar (ver `assertNoPlannedRows`).
  await assertNoPlannedRows(householdId, { expenseId: id });
  const result = await db
    .update(recurringExpenses)
    .set({ active: false })
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.householdId, householdId)))
    .returning({ id: recurringExpenses.id });
  if (result.length === 0) {
    throw new RecurringReferenceError('Despesa fixa não encontrada.');
  }
}

// ---------------------------------------------------------------------------
// Receitas — incomes
// ---------------------------------------------------------------------------

export async function listIncomes(householdId: string): Promise<IncomeListItem[]> {
  const rows = await db
    .select({
      id: incomes.id,
      description: incomes.description,
      kind: incomes.kind,
      expectedCents: incomes.expectedCents,
      memberId: incomes.memberId,
      memberName: members.name,
      accountId: incomes.accountId,
      accountName: accounts.name,
      receiveDay: incomes.receiveDay,
      frequency: incomes.frequency,
      oneOffCompetence: incomes.oneOffCompetence,
      startsOn: incomes.startsOn,
      endsOn: incomes.endsOn,
      active: incomes.active,
    })
    .from(incomes)
    .leftJoin(members, eq(members.id, incomes.memberId))
    .leftJoin(accounts, eq(accounts.id, incomes.accountId))
    .where(eq(incomes.householdId, householdId))
    .orderBy(asc(incomes.description));

  return rows
    .filter(
      (row): row is typeof row & { memberName: string; accountName: string } =>
        row.memberName !== null && row.accountName !== null,
    )
    .map((row) => ({
      id: row.id,
      description: row.description,
      kind: row.kind,
      expectedCents: cents(row.expectedCents),
      memberId: row.memberId,
      memberName: row.memberName,
      accountId: row.accountId,
      accountName: row.accountName,
      receiveDay: row.receiveDay,
      frequency: row.frequency,
      oneOffCompetence: row.oneOffCompetence,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      active: row.active,
    }));
}

export async function getIncome(
  householdId: string,
  id: string,
): Promise<IncomeListItem | null> {
  const items = await listIncomes(householdId);
  return items.find((item) => item.id === id) ?? null;
}

/**
 * Cria a receita E grava a previsão (`planned`), na MESMA transação — mesma
 * regra de `createRecurringExpense`. `today` é parâmetro.
 */
export async function createIncome(
  householdId: string,
  input: IncomeInput,
  today: string,
): Promise<string> {
  assertIncomeShape(input);
  await assertMemberBelongs(householdId, input.memberId);
  await assertAccountBelongs(householdId, input.accountId);
  const description = input.description.trim();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incomes)
      .values({
        householdId,
        description,
        kind: input.kind,
        expectedCents: input.expectedCents,
        memberId: input.memberId,
        accountId: input.accountId,
        receiveDay: input.receiveDay,
        frequency: input.frequency,
        oneOffCompetence: input.oneOffCompetence,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        active: true,
      })
      .returning({ id: incomes.id });
    if (row === undefined) throw new Error('Não foi possível criar a receita.');
    await planNewIncome(
      tx,
      householdId,
      {
        id: row.id,
        description,
        expectedCents: input.expectedCents,
        memberId: input.memberId,
        accountId: input.accountId,
        receiveDay: input.receiveDay,
        frequency: input.frequency,
        oneOffCompetence: input.oneOffCompetence,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      },
      today,
    );
    return row.id;
  });
}

export async function updateIncome(
  householdId: string,
  id: string,
  patch: IncomePatch,
): Promise<void> {
  const current = await getIncome(householdId, id);
  if (current === null) {
    throw new RecurringReferenceError('Receita não encontrada.');
  }
  assertIncomeShape(patch);
  await assertMemberBelongs(householdId, patch.memberId);
  await assertAccountBelongs(householdId, patch.accountId);
  // Previsão gravada não é regenerada aqui: recusa (ver `assertNoPlannedRows`).
  await assertNoPlannedRows(householdId, { incomeId: id });
  await db
    .update(incomes)
    .set({
      description: patch.description.trim(),
      kind: patch.kind,
      expectedCents: patch.expectedCents,
      memberId: patch.memberId,
      accountId: patch.accountId,
      receiveDay: patch.receiveDay,
      frequency: patch.frequency,
      oneOffCompetence: patch.oneOffCompetence,
      startsOn: patch.startsOn,
      endsOn: patch.endsOn,
    })
    .where(and(eq(incomes.id, id), eq(incomes.householdId, householdId)));
}

export async function deactivateIncome(
  householdId: string,
  id: string,
): Promise<void> {
  await assertNoPlannedRows(householdId, { incomeId: id });
  const result = await db
    .update(incomes)
    .set({ active: false })
    .where(and(eq(incomes.id, id), eq(incomes.householdId, householdId)))
    .returning({ id: incomes.id });
  if (result.length === 0) {
    throw new RecurringReferenceError('Receita não encontrada.');
  }
}
