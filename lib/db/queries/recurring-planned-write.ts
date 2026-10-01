/**
 * Gravação da previsão de recorrência como linhas `planned`.
 *
 * O desenho das linhas está em `recurring-planned.ts` (puro, e é lá que mora a
 * regra de criação × edição — leia o cabeçalho antes de reusar este caminho).
 *
 * **`insertPlannedRowsIdempotent` sozinho só serve à CRIAÇÃO e à manutenção do
 * horizonte.** `DO NOTHING` pula o que já existe, que é o que se quer ao gerar
 * a mesma regra duas vezes. Usá-lo para regenerar após uma edição mantém as
 * linhas velhas com o valor antigo, em silêncio. A EDIÇÃO é `replanSeries`: apaga
 * as `planned` futuras não conciliadas e regenera (o padrão do
 * `replanInstallments`, CONTRACTS §4), preservando as conciliadas e as vencidas.
 *
 * O `ON CONFLICT` precisa repetir o predicado do índice parcial (o Postgres só
 * infere o índice se o alvo e o `WHERE` baterem), e por isso um alvo por
 * origem. Sem alvo, o `DO NOTHING` engoliria também conflito de OUTRO índice
 * único, e o erro sumiria.
 */

import { and, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  creditCards,
  householdSettings,
  incomes,
  recurringExpenses,
  transactions,
} from '@/lib/db/schema';
import type { CardCycleConfig } from '@/lib/finance/billing';
import { replanRecurrence, type RecurrenceInput } from '@/lib/finance/recurrence';

import {
  buildPlannedRows,
  dropOccupied,
  expenseRecurrence,
  expenseSeries,
  incomeRecurrence,
  incomeSeries,
  plannedRowsForExpense,
  plannedRowsForIncome,
  plannedWindow,
  type ExpenseRule,
  type IncomeRule,
  type PlannedSeries,
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

export async function readCardCycle(
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
// Edição: preserva o conciliado e o vencido, apaga e regenera o futuro.
// ---------------------------------------------------------------------------

/**
 * Trava por household, até o fim da transação. Replan e `topUpPlanned` a tomam.
 *
 * Sem ela há uma corrida estreita e impossível de reproduzir: o top-up lê a
 * regra VELHA antes do commit da edição e as linhas NOVAS depois, e insere
 * linhas do ritmo antigo (mensal que virou trimestral) com o valor antigo — que
 * o `DO NOTHING` depois preserva. É o defeito dos R$ 180, só que raro.
 */
export async function lockHousehold(tx: DbTransaction, householdId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${householdId}))`);
}

/**
 * "Esta `planned` já foi conciliada com um lançamento realizado?"
 *
 * **Hoje devolve `false` para TODAS, de propósito, e este é o único lugar a
 * mudar.** `matchPlannedToPosted` (CONTRACTS §9) CASA previsto com realizado,
 * mas ninguém grava o par, e o schema não tem marcador de conciliação. A
 * heurística "a `posted` de mesma origem e competência é a que concilia" é
 * FALSA: com `dayWindow`, a conta de luz do dia 28 paga no dia 2 do mês seguinte
 * cai em OUTRA competência. Por isso não foi usada.
 *
 * Decisão pendente com o Ricardo (como o RF-ORC-03 grava o par): coluna
 * `matched_transaction_id`, ou status `reconciled`. Neste segundo desenho a
 * linha conciliada deixa de ser `planned`, nunca chega aqui, e esta função
 * continua `false` — a ocupação da competência (`dropOccupied`) já a protege.
 * Enquanto isso, nenhum teste de integração consegue provar a preservação de
 * uma conciliada; só `replanRecurrence` (pura) a prova.
 */
function isConciliated(_row: { id: string }): boolean {
  void _row;
  return false;
}

type Origin = { expenseId: string } | { incomeId: string };

function originMatch(origin: Origin) {
  return 'expenseId' in origin
    ? eq(transactions.recurringExpenseId, origin.expenseId)
    : eq(transactions.incomeId, origin.incomeId);
}

/** A regra nova e a série a gravar. `null` = desativar: só apaga o futuro. */
export interface ReplanPlan {
  recurrence: RecurrenceInput;
  series: PlannedSeries;
}

export interface ReplanSummary {
  deleted: number;
  preserved: number;
  inserted: number;
  /** Competências em que a ocorrência nova NÃO entrou porque já havia uma. */
  skippedOccupied: string[];
}

/**
 * Replaneja a previsão de UMA origem, dentro da transação do chamador (que já
 * tem de ter atualizado a regra e tomado `lockHousehold`).
 *
 * 1. lê as `planned` da origem; 2. `replanRecurrence` decide o que apagar;
 * 3. apaga; 4. monta as ocorrências novas; 5. descarta as que cairiam numa
 * competência ocupada por QUALQUER linha restante da origem (`planned` vencida
 * preservada, ou `posted`); 6. insere o resto.
 *
 * É o contrário de `insertPlannedRowsIdempotent` usado sozinho: aquele pula o
 * que existe (certo na CRIAÇÃO) e mantém o valor antigo (errado na EDIÇÃO).
 */
export async function replanSeries(
  tx: DbTransaction,
  householdId: string,
  origin: Origin,
  today: string,
  plan: ReplanPlan | null,
): Promise<ReplanSummary> {
  const stored = await tx
    .select({ id: transactions.id, occurredOn: transactions.occurredOn })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'planned'),
        originMatch(origin),
      ),
    );
  const months = await readProjectionMonths(tx, householdId);
  const result = replanRecurrence({
    rule: plan === null ? null : plan.recurrence,
    existing: stored.map((row) => ({
      id: row.id,
      date: row.occurredOn,
      conciliated: isConciliated(row),
    })),
    window: plannedWindow(today, months),
    today,
  });

  if (result.deleteIds.length > 0) {
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.status, 'planned'),
          inArray(transactions.id, result.deleteIds),
        ),
      );
  }

  let inserted = 0;
  let skippedOccupied: string[] = [];
  if (plan !== null && result.insert.length > 0) {
    const remaining = await tx
      .select({ competence: transactions.competence })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), originMatch(origin)));
    const { kept, skipped } = dropOccupied(
      buildPlannedRows(plan.series, result.insert),
      new Set(remaining.map((row) => row.competence)),
    );
    skippedOccupied = skipped;
    if (kept.length > 0) inserted = await insertPlannedRowsIdempotent(tx, kept);
  }

  return {
    deleted: result.deleteIds.length,
    preserved: result.preservedIds.length,
    inserted,
    skippedOccupied,
  };
}

/** Replaneja uma despesa fixa. `rule = null` desativa (sem nova previsão). */
export function replanExpense(
  tx: DbTransaction,
  householdId: string,
  id: string,
  rule: ExpenseRule | null,
  cycle: CardCycleConfig | null,
  today: string,
): Promise<ReplanSummary> {
  return replanSeries(
    tx,
    householdId,
    { expenseId: id },
    today,
    rule === null
      ? null
      : {
          recurrence: expenseRecurrence(rule),
          series: expenseSeries(householdId, rule, cycle),
        },
  );
}

/** Replaneja uma receita. `rule = null` desativa (sem nova previsão). */
export function replanIncome(
  tx: DbTransaction,
  householdId: string,
  id: string,
  rule: IncomeRule | null,
  today: string,
): Promise<ReplanSummary> {
  return replanSeries(
    tx,
    householdId,
    { incomeId: id },
    today,
    rule === null
      ? null
      : { recurrence: incomeRecurrence(rule), series: incomeSeries(householdId, rule) },
  );
}

// ---------------------------------------------------------------------------
// Manutenção do horizonte: completa o que falta, sem nunca derrubar a página.
// ---------------------------------------------------------------------------

type Reader = Pick<typeof db, 'select'>;

/**
 * As linhas que faltam até `today + projection_months`, para todas as regras
 * ativas. Não escreve. Uma regra com problema é ignorada (e logada) sem impedir
 * as outras; uma FONTE quebrada (por exemplo, a coluna `incomes.account_id`
 * antes da migration 0003) idem.
 *
 * "Já existe" = qualquer linha da mesma origem e competência, `planned` OU
 * `posted`: a conciliação (RF-ORC-03) cria a `posted`, e regenerar a `planned`
 * por cima dela seria contar o mesmo gasto duas vezes.
 */
async function computeMissingRows(
  reader: Reader,
  householdId: string,
  today: string,
): Promise<PlannedTransactionRow[]> {
  const [settings] = await reader
    .select({ projectionMonths: householdSettings.projectionMonths })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId))
    .limit(1);
  if (settings === undefined) return [];
  const window = plannedWindow(today, settings.projectionMonths);

  const [expenseRules, incomeRules] = await Promise.all([
    reader
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
    // Cada fonte falha sozinha: uma leitura quebrada não pode impedir a outra.
    reader
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
  if (expenseRules.length === 0 && incomeRules.length === 0) return [];

  const existing = await reader
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
  return missing;
}

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
 * servidor; a página renderiza com o que existe.
 *
 * **Caminho rápido, sem trava e sem transação:** as ocorrências são aritmética
 * em memória; o banco só é lido. Se nada falta (~99% das leituras), acaba aí.
 * Só quando falta algo abre uma transação, toma `lockHousehold` e RECALCULA o que
 * falta sob a trava antes de inserir — para não gravar com base numa regra que
 * uma edição acabou de trocar.
 *
 * Limite conhecido: se o usuário APAGAR uma `planned` à mão (para "pular" um
 * mês), o top-up a recria. Pular ocorrência exigiria um marcador próprio.
 */
export async function topUpPlanned(householdId: string, today: string): Promise<void> {
  try {
    const firstPass = await computeMissingRows(db, householdId, today);
    if (firstPass.length === 0) return;
    await db.transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      const missing = await computeMissingRows(tx, householdId, today);
      if (missing.length > 0) await insertPlannedRowsIdempotent(tx, missing);
    });
  } catch (error) {
    console.error('[topUpPlanned] falhou; a página segue com a previsão existente:', error);
  }
}
