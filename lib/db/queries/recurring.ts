/**
 * CRUD de despesas fixas e receitas recorrentes — T-204.
 *
 * O motor de cálculo (CONTRACTS §8) está em `lib/finance/recurrence.ts`, do
 * Esquadro. Esta camada é o gate de banco: garante que toda escrita respeita
 * as fronteiras (categoria-folha da despesa, memberId da família no caso da
 * receita, etc.) e devolve os dados para a tela em formato consumível.
 *
 * Regra de ouro: nada aqui faz conta de calendário. As ocorrências previstas
 * são calculadas pela tela via `expandRecurrence`, não pelo banco.
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
import { cents, type Cents } from '@/lib/money';

// ---------------------------------------------------------------------------
// Erros tipados — fronteira explícita em vez de "não encontrado" genérico.
// ---------------------------------------------------------------------------

export class RecurringReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringReferenceError';
  }
}

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

export type RecurringExpenseInput = {
  description: string;
  expectedCents: Cents;
  categoryId: string;
  dueDay: number;
  frequency: Frequency;
  accountId: string | null;
  creditCardId: string | null;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: number | null;
};

/** Patch é igual ao input — substituição por completo dos campos mutáveis. */
export type RecurringExpensePatch = RecurringExpenseInput;

export type IncomeListItem = {
  id: string;
  description: string;
  kind: IncomeKind;
  expectedCents: Cents;
  memberId: string;
  memberName: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
};

export type IncomeInput = {
  description: string;
  kind: IncomeListItem['kind'];
  expectedCents: Cents;
  memberId: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

export type IncomePatch = IncomeInput;

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

/** Garante coerência entre `frequency` e `endsOn` / `startsOn`. */
function assertRecurrenceShape(
  frequency: Frequency,
  startsOn: string,
  endsOn: string | null,
): void {
  if (endsOn !== null && endsOn < startsOn) {
    throw new RecurringReferenceError('Data final não pode ser anterior à data inicial.');
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

export async function createRecurringExpense(
  householdId: string,
  input: RecurringExpenseInput,
): Promise<string> {
  assertRecurrenceShape(input.frequency, input.startsOn, input.endsOn);
  await assertLeafCategory(householdId, input.categoryId);
  if (input.accountId !== null) await assertAccountBelongs(householdId, input.accountId);
  if (input.creditCardId !== null) await assertCardBelongs(householdId, input.creditCardId);
  if (input.accountId !== null && input.creditCardId !== null) {
    throw new RecurringReferenceError('Informe uma conta OU um cartão, não os dois.');
  }
  const [row] = await db
    .insert(recurringExpenses)
    .values({
      householdId,
      description: input.description.trim(),
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
  return row.id;
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
  await assertLeafCategory(householdId, patch.categoryId);
  if (patch.accountId !== null) await assertAccountBelongs(householdId, patch.accountId);
  if (patch.creditCardId !== null) await assertCardBelongs(householdId, patch.creditCardId);
  if (patch.accountId !== null && patch.creditCardId !== null) {
    throw new RecurringReferenceError('Informe uma conta OU um cartão, não os dois.');
  }
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
  // ocorrências já projetadas (CONTRACTS §8 não exige cascata).
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
      receiveDay: incomes.receiveDay,
      frequency: incomes.frequency,
      oneOffCompetence: incomes.oneOffCompetence,
      startsOn: incomes.startsOn,
      endsOn: incomes.endsOn,
      active: incomes.active,
    })
    .from(incomes)
    .leftJoin(members, eq(members.id, incomes.memberId))
    .where(eq(incomes.householdId, householdId))
    .orderBy(asc(incomes.description));

  return rows
    .filter((row): row is typeof row & { memberName: string } => row.memberName !== null)
    .map((row) => ({
      id: row.id,
      description: row.description,
      kind: row.kind,
      expectedCents: cents(row.expectedCents),
      memberId: row.memberId,
      memberName: row.memberName,
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
 * Coerência `frequency` × `oneOffCompetence` × `startsOn`:
 * - `one_off`: `oneOffCompetence` é **obrigatório** (a coluna tem CHECK no schema,
 *   mas o Zod da rota reforça a regra antes da query para a mensagem ficar em
 *   pt-BR). `startsOn` pode ser `null` (a competência é o que vale, ver
 *   CONTRACTS §8 / `expandOneOff`).
 * - Demais frequências: `oneOffCompetence` deve ser `null` (o motor ignora) e
 *   `startsOn` deve estar preenchido (sem `startsOn` não há cadência para
 *   projetar).
 */
const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertIncomeShape(input: IncomeInput): void {
  if (input.frequency === 'one_off') {
    if (input.oneOffCompetence === null) {
      throw new RecurringReferenceError('Receita eventual exige uma competência fixa.');
    }
    if (!COMPETENCE_PATTERN.test(input.oneOffCompetence)) {
      throw new RecurringReferenceError('Competência inválida.');
    }
    return;
  }
  if (input.oneOffCompetence !== null) {
    throw new RecurringReferenceError(
      'Competência fixa só se aplica a receitas eventuais.',
    );
  }
  if (input.startsOn === null) {
    throw new RecurringReferenceError('Informe a data de início da receita.');
  }
  if (input.endsOn !== null && input.endsOn < input.startsOn) {
    throw new RecurringReferenceError('Data final não pode ser anterior à data inicial.');
  }
}

export async function createIncome(
  householdId: string,
  input: IncomeInput,
): Promise<string> {
  assertIncomeShape(input);
  await assertMemberBelongs(householdId, input.memberId);
  const [row] = await db
    .insert(incomes)
    .values({
      householdId,
      description: input.description.trim(),
      kind: input.kind,
      expectedCents: input.expectedCents,
      memberId: input.memberId,
      receiveDay: input.receiveDay,
      frequency: input.frequency,
      oneOffCompetence: input.oneOffCompetence,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      active: true,
    })
    .returning({ id: incomes.id });
  if (row === undefined) throw new Error('Não foi possível criar a receita.');
  return row.id;
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
  await db
    .update(incomes)
    .set({
      description: patch.description.trim(),
      kind: patch.kind,
      expectedCents: patch.expectedCents,
      memberId: patch.memberId,
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
  const result = await db
    .update(incomes)
    .set({ active: false })
    .where(and(eq(incomes.id, id), eq(incomes.householdId, householdId)))
    .returning({ id: incomes.id });
  if (result.length === 0) {
    throw new RecurringReferenceError('Receita não encontrada.');
  }
}
