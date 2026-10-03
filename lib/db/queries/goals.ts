import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import type { GoalStatus } from '@/lib/db';
import { essentialAverageWindow } from '@/lib/finance/goals';
import { cents, type Cents } from '@/lib/money';
import type { Competence, IsoDate } from '@/lib/date';
import { accounts, categories, goals, transactions } from '@/lib/db/schema';

import { COUNTED_STATUSES } from './counted-statuses';

/**
 * Metas — T-305. Só seleção e gravação; toda conta (progresso, aporte, alvo da reserva,
 * média) mora em `lib/finance/goals.ts`.
 *
 * - `current_cents` de meta VINCULADA a uma conta (`account_id`) não é o gravado: é o
 *   saldo da conta hoje (`accountBalanceCents`).
 * - A reserva de emergência (`is_emergency_fund`) tem alvo CALCULADO, não digitado: o
 *   valor gravado é só um retrato do momento do salvamento; a leitura usa a média viva.
 *   No máximo uma por household (`EmergencyFundExistsError`).
 */

export type GoalRow = {
  id: string;
  name: string;
  /** Valor gravado. Na reserva de emergência é só um retrato; a tela usa o alvo calculado. */
  targetCents: Cents;
  targetDate: IsoDate | null;
  /** Já resolvido: saldo da conta quando vinculada, senão o valor gravado. */
  currentCents: Cents;
  accountId: string | null;
  accountName: string | null;
  priority: number;
  status: GoalStatus;
  isEmergencyFund: boolean;
};

export type GoalInput = {
  name: string;
  targetCents: Cents;
  targetDate: IsoDate | null;
  currentCents: Cents;
  accountId: string | null;
  priority: number;
  status: GoalStatus;
  isEmergencyFund: boolean;
};

export type EssentialAverageData = {
  from: Competence;
  to: Competence;
  /** Uma entrada por mês da janela com algum lançamento; `expenseNetCents` negativo = saída. */
  months: { competence: Competence; expenseNetCents: Cents }[];
};

export class GoalNotFoundError extends Error {
  constructor() {
    super('Meta não encontrada.');
    this.name = 'GoalNotFoundError';
  }
}

export class GoalReferenceError extends Error {
  constructor() {
    super('Conta inválida para a meta.');
    this.name = 'GoalReferenceError';
  }
}

export class EmergencyFundExistsError extends Error {
  constructor() {
    super('Já existe uma meta de reserva de emergência.');
    this.name = 'EmergencyFundExistsError';
  }
}

const EMERGENCY_FUND_INDEX = 'goals_household_emergency_fund_unique';

/**
 * O índice único parcial `goals_household_emergency_fund_unique` (no máximo uma reserva
 * viva por household) é quem GARANTE a regra; `assertSingleEmergencyFund` só dá a
 * mensagem boa no caso comum. Duas requisições concorrentes passam as duas no SELECT, e a
 * segunda bate no índice: 23505 com este nome de constraint. O drizzle embrulha o erro do
 * driver (`cause`), então a busca desce a cadeia.
 */
export function isEmergencyFundConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint_name === EMERGENCY_FUND_INDEX) return true;
    current = candidate.cause;
  }
  return false;
}

function safeCents(value: string | number | null | undefined): Cents {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  return cents(numeric);
}

/**
 * Saldo de cada conta em `accountIds` HOJE: saldo informado + movimento `posted` de
 * `opening_date` (inclusive, o saldo é de INÍCIO do dia) até `today` (inclusive), de
 * qualquer `kind`: pagamento de fatura e transferência também mexem no saldo da conta.
 */
async function accountBalances(
  householdId: string,
  accountIds: string[],
  today: IsoDate,
): Promise<Map<string, Cents>> {
  const result = new Map<string, Cents>();
  if (accountIds.length === 0) return result;
  const cashDay = sql`coalesce(${transactions.cashDate}, ${transactions.occurredOn})`;
  const [openings, movements] = await Promise.all([
    db
      .select({ id: accounts.id, openingCents: accounts.openingBalanceCents })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), inArray(accounts.id, accountIds))),
    db
      .select({
        accountId: transactions.accountId,
        total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(accounts.householdId, householdId),
          inArray(transactions.accountId, accountIds),
          eq(transactions.status, 'posted'),
          sql`${cashDay} >= ${accounts.openingDate}`,
          sql`${cashDay} <= ${today}::date`,
        ),
      )
      .groupBy(transactions.accountId),
  ]);
  const moved = new Map(movements.map((row) => [row.accountId, safeCents(row.total)]));
  for (const opening of openings) {
    result.set(opening.id, cents(safeCents(opening.openingCents) + (moved.get(opening.id) ?? 0)));
  }
  return result;
}

export async function listGoals(householdId: string, today: IsoDate): Promise<GoalRow[]> {
  const rows = await db
    .select({
      id: goals.id,
      name: goals.name,
      targetCents: goals.targetCents,
      targetDate: goals.targetDate,
      currentCents: goals.currentCents,
      accountId: goals.accountId,
      accountName: accounts.name,
      priority: goals.priority,
      status: goals.status,
      isEmergencyFund: goals.isEmergencyFund,
    })
    .from(goals)
    .leftJoin(accounts, and(eq(accounts.id, goals.accountId), eq(accounts.householdId, householdId)))
    .where(and(eq(goals.householdId, householdId), ne(goals.status, 'cancelled')))
    .orderBy(asc(goals.priority), asc(goals.name));

  const linked = rows.flatMap((row) => (row.accountId === null ? [] : [row.accountId]));
  const balances = await accountBalances(householdId, [...new Set(linked)], today);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetCents: safeCents(row.targetCents),
    targetDate: row.targetDate,
    currentCents:
      row.accountId === null
        ? safeCents(row.currentCents)
        : (balances.get(row.accountId) ?? safeCents(row.currentCents)),
    accountId: row.accountId,
    accountName: row.accountName,
    priority: row.priority,
    status: row.status,
    isEmergencyFund: row.isEmergencyFund,
  }));
}

/**
 * Dados da média de despesa ESSENCIAL (`categories.nature = 'essential'`, `kind =
 * 'expense'`) dos meses fechados da janela de `essentialAverageWindow`. Só `COUNTED_STATUSES`:
 * previsão cumprida (`reconciled`) é a mesma despesa que o `posted` já traz.
 *
 * Devolve só os meses em que há ALGUM lançamento (qualquer tipo e categoria): é o que
 * separa "mês sem despesa essencial" (vale 0) de "mês sem histórico" (não entra na média).
 */
export async function getEssentialAverageData(
  householdId: string,
  today: IsoDate,
): Promise<EssentialAverageData> {
  const { from, to } = essentialAverageWindow(today);
  const rows = await db
    .select({
      competence: transactions.competence,
      net: sql<string>`coalesce(sum(case when ${transactions.kind} = 'expense' and ${categories.nature} = 'essential' then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
    )
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.status, COUNTED_STATUSES),
        gte(transactions.competence, from),
        lte(transactions.competence, to),
      ),
    )
    .groupBy(transactions.competence)
    .orderBy(asc(transactions.competence));
  return {
    from,
    to,
    months: rows.map((row) => ({ competence: row.competence, expenseNetCents: safeCents(row.net) })),
  };
}

async function assertAccount(householdId: string, accountId: string | null): Promise<void> {
  if (accountId === null) return;
  const [account] = await db
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
  if (!account) throw new GoalReferenceError();
}

async function assertSingleEmergencyFund(
  householdId: string,
  exceptId: string | null,
): Promise<void> {
  const conditions = [
    eq(goals.householdId, householdId),
    eq(goals.isEmergencyFund, true),
    ne(goals.status, 'cancelled'),
  ];
  if (exceptId !== null) conditions.push(ne(goals.id, exceptId));
  const [existing] = await db.select({ id: goals.id }).from(goals).where(and(...conditions)).limit(1);
  if (existing) throw new EmergencyFundExistsError();
}

export async function createGoal(householdId: string, input: GoalInput): Promise<string> {
  await assertAccount(householdId, input.accountId);
  if (input.isEmergencyFund) await assertSingleEmergencyFund(householdId, null);
  try {
    const [created] = await db
      .insert(goals)
      .values({ householdId, ...input })
      .returning({ id: goals.id });
    if (!created) throw new Error('Não foi possível criar a meta.');
    return created.id;
  } catch (error) {
    if (isEmergencyFundConflict(error)) throw new EmergencyFundExistsError();
    throw error;
  }
}

export async function updateGoal(
  householdId: string,
  id: string,
  input: GoalInput,
): Promise<void> {
  await assertAccount(householdId, input.accountId);
  if (input.isEmergencyFund) await assertSingleEmergencyFund(householdId, id);
  let updated: { id: string }[];
  try {
    updated = await db
      .update(goals)
      .set(input)
      .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
      .returning({ id: goals.id });
  } catch (error) {
    if (isEmergencyFundConflict(error)) throw new EmergencyFundExistsError();
    throw error;
  }
  if (updated.length === 0) throw new GoalNotFoundError();
}

export async function deleteGoal(householdId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
    .returning({ id: goals.id });
  if (deleted.length === 0) throw new GoalNotFoundError();
}
