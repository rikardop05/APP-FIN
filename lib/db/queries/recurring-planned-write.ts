/**
 * Gravação da previsão de recorrência como linhas `planned`.
 *
 * O desenho das linhas está em `recurring-planned.ts` (puro, e é lá que mora a
 * regra de criação × edição — leia o cabeçalho antes de reusar este caminho).
 *
 * **`insertPlannedRowsIdempotent` só serve à CRIAÇÃO e à manutenção do
 * horizonte.** `DO NOTHING` pula o que já existe, que é o que se quer ao gerar
 * a mesma regra duas vezes. Usá-lo para regenerar após uma edição mantém as
 * linhas velhas com o valor antigo, em silêncio. A edição apaga as `planned`
 * futuras não conciliadas e regenera; ela ainda não existe, e por isso
 * `assertNoPlannedRows` recusa editar uma regra que já tem previsão.
 *
 * O `ON CONFLICT` precisa repetir o predicado do índice parcial (o Postgres só
 * infere o índice se o alvo e o `WHERE` baterem), e por isso um alvo por
 * origem. Sem alvo, o `DO NOTHING` engoliria também conflito de OUTRO índice
 * único, e o erro sumiria.
 */

import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  creditCards,
  householdSettings,
  incomes,
  recurringExpenses,
  transactions,
} from '@/lib/db/schema';
import type { CardCycleConfig } from '@/lib/finance/billing';

import {
  plannedRowsForExpense,
  plannedRowsForIncome,
  plannedWindow,
  type ExpenseRule,
  type IncomeRule,
  type PlannedTransactionRow,
} from './recurring-planned';
import { RecurringReferenceError } from './recurring-shape';

/** `tx` de `db.transaction` — a gravação deve rodar na mesma transação da regra. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insere as linhas `planned` ignorando as que já existem para a mesma origem e
 * competência. Devolve quantas entraram de fato (o resto já existia).
 */
export async function insertPlannedRowsIdempotent(
  tx: DbTransaction,
  rows: readonly PlannedTransactionRow[],
): Promise<number> {
  const fromExpense = rows.filter((row) => row.recurringExpenseId !== null);
  const fromIncome = rows.filter((row) => row.incomeId !== null);
  if (fromExpense.length + fromIncome.length !== rows.length) {
    throw new Error('Linha prevista sem origem (despesa fixa ou receita).');
  }

  let inserted = 0;
  if (fromExpense.length > 0) {
    const result = await tx
      .insert(transactions)
      .values(fromExpense.map((row) => ({ ...row })))
      .onConflictDoNothing({
        target: [
          transactions.householdId,
          transactions.recurringExpenseId,
          transactions.competence,
        ],
        where: sql`${transactions.status} = 'planned' and ${transactions.recurringExpenseId} is not null`,
      })
      .returning({ id: transactions.id });
    inserted += result.length;
  }
  if (fromIncome.length > 0) {
    const result = await tx
      .insert(transactions)
      .values(fromIncome.map((row) => ({ ...row })))
      .onConflictDoNothing({
        target: [transactions.householdId, transactions.incomeId, transactions.competence],
        where: sql`${transactions.status} = 'planned' and ${transactions.incomeId} is not null`,
      })
      .returning({ id: transactions.id });
    inserted += result.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Criação: gera as linhas da regra recém-criada, NA MESMA transação dela.
// ---------------------------------------------------------------------------

async function readProjectionMonths(tx: DbTransaction, householdId: string): Promise<number> {
  const [row] = await tx
    .select({ projectionMonths: householdSettings.projectionMonths })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId))
    .limit(1);
  if (row === undefined) {
    throw new Error('Configurações da família não encontradas. Rode o seed.');
  }
  return row.projectionMonths;
}

async function readCardCycle(
  tx: DbTransaction,
  householdId: string,
  cardId: string,
): Promise<CardCycleConfig> {
  const [card] = await tx
    .select({ closingDay: creditCards.closingDay, dueDay: creditCards.dueDay })
    .from(creditCards)
    .where(and(eq(creditCards.id, cardId), eq(creditCards.householdId, householdId)))
    .limit(1);
  if (card === undefined) throw new RecurringReferenceError('Cartão não encontrado.');
  return card;
}

/**
 * Grava a previsão de uma despesa fixa RECÉM-CRIADA. Só para a criação (usa
 * `DO NOTHING`; ver o cabeçalho do arquivo e o de `recurring-planned.ts`).
 */
export async function planNewExpense(
  tx: DbTransaction,
  householdId: string,
  rule: ExpenseRule,
  today: string,
): Promise<number> {
  const months = await readProjectionMonths(tx, householdId);
  const cycle =
    rule.creditCardId === null ? null : await readCardCycle(tx, householdId, rule.creditCardId);
  const rows = plannedRowsForExpense(householdId, rule, cycle, plannedWindow(today, months));
  return rows.length === 0 ? 0 : insertPlannedRowsIdempotent(tx, rows);
}

/** Grava a previsão de uma receita RECÉM-CRIADA. Só para a criação. */
export async function planNewIncome(
  tx: DbTransaction,
  householdId: string,
  rule: IncomeRule,
  today: string,
): Promise<number> {
  const months = await readProjectionMonths(tx, householdId);
  const rows = plannedRowsForIncome(householdId, rule, plannedWindow(today, months));
  return rows.length === 0 ? 0 : insertPlannedRowsIdempotent(tx, rows);
}

// ---------------------------------------------------------------------------
// Trava da edição: previsão gravada não é regenerada por este caminho.
// ---------------------------------------------------------------------------

/**
 * Falha ALTO se a regra já tem previsão gravada. Editar ou desativar uma regra
 * sem regenerar a previsão deixaria as linhas antigas com o valor antigo, e o
 * painel mostraria R$ 180 para sempre depois de a conta de luz virar R$ 220,
 * sem erro e sem aviso.
 *
 * A edição correta — apagar as `planned` futuras NÃO conciliadas e regenerar,
 * no padrão do `replanInstallments` (CONTRACTS §4) — ainda não existe, e "já
 * conciliada" não é "já passou": errar isso apaga lançamento real. Até lá,
 * recusar é o comportamento seguro.
 */
export async function assertNoPlannedRows(
  householdId: string,
  origin: { expenseId: string } | { incomeId: string },
): Promise<void> {
  const originMatch =
    'expenseId' in origin
      ? eq(transactions.recurringExpenseId, origin.expenseId)
      : eq(transactions.incomeId, origin.incomeId);
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'planned'),
        originMatch,
      ),
    )
    .limit(1);
  if (row !== undefined) {
    throw new RecurringReferenceError(
      'Esta regra já tem previsão gravada, e alterá-la ainda não atualiza a previsão. Edição e desativação aguardam a regeneração da previsão.',
    );
  }
}

// ---------------------------------------------------------------------------
// Manutenção do horizonte: completa o que falta, sem nunca derrubar a página.
// ---------------------------------------------------------------------------

/**
 * Completa a previsão até `today + projection_months` para todas as regras
 * ativas. Idempotente: chamar 100 vezes não duplica (mesmo `DO NOTHING` da
 * criação, contra o índice parcial). Existe porque a previsão gravada, ao
 * contrário da calculada na tela, ACABA: sem isto o futuro esvaziaria em 12
 * meses sem erro nenhum.
 *
 * **Nunca lança.** É manutenção disparada por leitura de página, e uma falha
 * aqui não pode transformar um GET em 500: a família perderia o painel inteiro
 * por causa de uma previsão de daqui a 11 meses. O erro vai para o log do
 * servidor; a página renderiza com o que existe. Uma regra com problema não
 * impede as outras.
 *
 * **Caminho rápido:** as ocorrências são aritmética em memória; o banco só é
 * consultado para ler as regras e o que já existe. Se nada falta, não há
 * escrita nem transação (o caso de ~99% das leituras).
 *
 * Considera "já existe" qualquer linha da mesma origem e competência, `planned`
 * OU `posted`: a conciliação (RF-ORC-03) cria a `posted`, e regenerar a
 * `planned` por cima dela seria contar o mesmo gasto duas vezes.
 *
 * Limite conhecido: se o usuário APAGAR uma `planned` à mão (para "pular" um
 * mês), o top-up a recria. Pular ocorrência exigiria um marcador próprio.
 */
export async function topUpPlanned(householdId: string, today: string): Promise<void> {
  try {
    const [settings] = await db
      .select({ projectionMonths: householdSettings.projectionMonths })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, householdId))
      .limit(1);
    if (settings === undefined) return;
    const window = plannedWindow(today, settings.projectionMonths);

    const [expenseRules, incomeRules] = await Promise.all([
      db
        .select({
          id: recurringExpenses.id,
          description: recurringExpenses.description,
          expectedCents: recurringExpenses.expectedCents,
          categoryId: recurringExpenses.categoryId,
          dueDay: recurringExpenses.dueDay,
          frequency: recurringExpenses.frequency,
          accountId: recurringExpenses.accountId,
          creditCardId: recurringExpenses.creditCardId,
          startsOn: recurringExpenses.startsOn,
          endsOn: recurringExpenses.endsOn,
          annualAdjustmentBp: recurringExpenses.annualAdjustmentBp,
          closingDay: creditCards.closingDay,
          cardDueDay: creditCards.dueDay,
        })
        .from(recurringExpenses)
        .leftJoin(creditCards, eq(creditCards.id, recurringExpenses.creditCardId))
        .where(
          and(eq(recurringExpenses.householdId, householdId), eq(recurringExpenses.active, true)),
        ),
      // Cada fonte falha sozinha: uma leitura quebrada (por exemplo, a coluna
      // `incomes.account_id` antes da migration 0003) não pode impedir a outra.
      db
        .select({
          id: incomes.id,
          description: incomes.description,
          expectedCents: incomes.expectedCents,
          memberId: incomes.memberId,
          accountId: incomes.accountId,
          receiveDay: incomes.receiveDay,
          frequency: incomes.frequency,
          oneOffCompetence: incomes.oneOffCompetence,
          startsOn: incomes.startsOn,
          endsOn: incomes.endsOn,
        })
        .from(incomes)
        .where(and(eq(incomes.householdId, householdId), eq(incomes.active, true)))
        .catch((error: unknown) => {
          console.error('[topUpPlanned] leitura de receitas falhou; seguindo só com despesas:', error);
          return [];
        }),
    ]);
    if (expenseRules.length === 0 && incomeRules.length === 0) return;

    const existing = await db
      .select({
        recurringExpenseId: transactions.recurringExpenseId,
        incomeId: transactions.incomeId,
        competence: transactions.competence,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.competence, window.from),
          or(isNotNull(transactions.recurringExpenseId), isNotNull(transactions.incomeId)),
        ),
      );
    const have = new Set(
      existing.map((row) => `${row.recurringExpenseId ?? row.incomeId ?? ''}|${row.competence}`),
    );

    const missing: PlannedTransactionRow[] = [];
    const collect = (rows: PlannedTransactionRow[]) => {
      for (const row of rows) {
        const origin = row.recurringExpenseId ?? row.incomeId ?? '';
        if (!have.has(`${origin}|${row.competence}`)) missing.push(row);
      }
    };

    for (const rule of expenseRules) {
      try {
        const cycle =
          rule.closingDay === null || rule.cardDueDay === null
            ? null
            : { closingDay: rule.closingDay, dueDay: rule.cardDueDay };
        collect(plannedRowsForExpense(householdId, rule, cycle, window));
      } catch (error) {
        console.error(`[topUpPlanned] despesa fixa ${rule.id} ignorada:`, error);
      }
    }
    for (const rule of incomeRules) {
      try {
        collect(plannedRowsForIncome(householdId, rule, window));
      } catch (error) {
        console.error(`[topUpPlanned] receita ${rule.id} ignorada:`, error);
      }
    }

    if (missing.length === 0) return;
    await db.transaction((tx) => insertPlannedRowsIdempotent(tx, missing));
  } catch (error) {
    console.error('[topUpPlanned] falhou; a página segue com a previsão existente:', error);
  }
}
