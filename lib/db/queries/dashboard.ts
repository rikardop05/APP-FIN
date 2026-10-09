import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql } from 'drizzle-orm';

import { addCompetence, toCompetence, type Competence, type IsoDate } from '@/lib/date';
import { db } from '@/lib/db';
import { COUNTED_STATUSES } from './counted-statuses';
import type { CategoryNature, TransactionKind, TransactionStatus } from '@/lib/db';
import {
  categories,
  creditCards,
  investmentPlans,
  statements,
  transactions,
} from '@/lib/db/schema';
import { cents, type Cents } from '@/lib/money';

/**
 * Agregação paralela para o dashboard (T-115). Cada item devolvido aqui entra
 * direto num dos três módulos puros de `lib/finance/kpis.ts` ou em
 * `lib/finance/commitment.ts` — nenhuma soma é feita aqui que não seja
 * trivial (soma SQL de parcelas futuras). Quem EXIBE o número chama o motor.
 *
 * `safeCents` espelha o padrão de `lib/db/queries/cards.ts`: agregados de
 * `bigint` chegam como string do postgres-js, viram `number` validado pelo
 * tipo `Cents`. Sem isso, a leitura do dashboard pode estourar o safe integer
 * com 5 mil lançamentos (regra de aceite do T-115).
 */

function safeCents(value: string | number | null | undefined): Cents {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  return cents(numeric);
}

export type DashboardMonthlyTransaction = {
  amountCents: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
  categoryNature: CategoryNature;
};

export type DashboardSpendingTransaction = {
  competence: Competence;
  amountCents: Cents;
  kind: TransactionKind;
  categoryId: string | null;
};

export type DashboardCommitmentTransaction = {
  competence: Competence;
  amountCents: Cents;
  creditCardId: string;
  status: TransactionStatus;
  /** Parcela de parcelamento (`installment_plan_id`); false = compra lancada ou estorno. */
  installment: boolean;
  /** A fatura da linha esta marcada como paga (`statements.status = 'paid'`): sai do comprometido. */
  statementPaid: boolean;
};

export type DashboardCategory = {
  id: string;
  name: string;
  nature: CategoryNature;
};

export type DashboardCard = {
  id: string;
  name: string;
  creditLimitCents: Cents | null;
};

export type DashboardDivergentStatement = {
  statementId: string;
  reportedTotalCents: Cents | null;
  period: string;
  creditCardName: string;
  amountCentsList: number[];
};

export type DashboardData = {
  competence: Competence;
  commitmentMonths: number;
  monthlyTransactions: DashboardMonthlyTransaction[];
  /** Soma SQL das parcelas planejadas na janela de `commitmentMonths` (alimenta `monthlyKpis.futureInstallmentsCents`). */
  futureInstallmentsCents: Cents;
  uncategorizedCount: number;
  spendingTransactions: DashboardSpendingTransaction[];
  categoriesForSpending: DashboardCategory[];
  commitmentTransactions: DashboardCommitmentTransaction[];
  cards: DashboardCard[];
  divergentStatements: DashboardDivergentStatement[];
  /**
   * Aporte mensal PLANEJADO do plano de investimento (`current_monthly_contribution_cents`),
   * para "Aportes de <mes>: R$ X de R$ Y planejados". null = household sem plano.
   */
  plannedContributionCents: Cents | null;
};

const SPENDING_AVERAGE_WINDOW_MONTHS = 3;



/**
 * Busca paralela de todos os dados do dashboard em UMA chamada. Oito
 * `Promise.all` rodam juntas no servidor; o objetivo é manter a latência do
 * dashboard abaixo do limite de 1,5 s com 5 mil lançamentos (aceite do T-115).
 *
 * Cada query é estreita por `householdId` (CONVENTIONS §7 — fronteira de
 * isolamento) e limitada ao recorte temporal necessário para o motor chamado
 * na camada de tela. As somas SQL acontecem aqui SÓ onde o motor recebe o
 * valor pronto (ex.: `futureInstallmentsCents`); totais exibidos são
 * produzidos por `monthlyKpis`, `spendingByCategory` e `divergentStatements`.
 *
 * O horizonte vem de `household_settings.commitment_months` (N, default 24) — a
 * página passa o valor já lido. As DUAS janelas usam o mesmo N, mas NÃO são a
 * mesma janela, de propósito:
 * - `futureInstallmentsCents` ("Parcelas a vencer"): competência+1 .. +N. O mês
 *   corrente fica FORA porque a parcela dele já está em "Despesa do mês"
 *   (`monthlyKpis` soma `posted` e `planned`, CONTRACTS §14); contar de novo
 *   seria somar duas vezes. SPEC §5.8: "soma das parcelas futuras".
 * - `commitmentTransactions` (card "Comprometimento futuro"): competência ..
 *   +N-1, ou seja, os N meses A PARTIR do corrente, porque a fatura que vence
 *   agora é compromisso de cartão (RF-CC-03, tabela de 24 meses).
 * Por isso os dois números diferem pelo mês corrente e pelo último mês.
 */
export async function getDashboardData(
  householdId: string,
  today: IsoDate,
  commitmentMonths: number,
): Promise<DashboardData> {
  const competence = toCompetence(today);
  const spendingWindowStart = addCompetence(competence, -SPENDING_AVERAGE_WINDOW_MONTHS);
  const futureInstallmentsStart = addCompetence(competence, 1);
  const futureInstallmentsEnd = addCompetence(competence, commitmentMonths);

  const [
    monthlyRows,
    futureInstallmentsAgg,
    uncategorizedCountAgg,
    spendingRows,
    categoriesRows,
    commitmentRows,
    cardsRows,
    divergentRows,
    planRows,
  ] = await Promise.all([
    db
      .select({
        amountCents: transactions.amountCents,
        kind: transactions.kind,
        status: transactions.status,
        // Lançamento sem categoria fica com `categoryNature = null` no join.
        // `monthlyKpis` (CONTRACTS §14) só consulta `categoryNature` para
        // distinguir essencial de não-essencial; "ainda não categorizado" não
        // é essencial por definição, então coalescermos para 'non_essential'
        // é o default seguro. Lançamentos não-categorizados continuam na
        // soma de despesa (dependem só do `kind`), mas não viram
        // `essentialExpense`.
        categoryNature: sql<CategoryNature>`COALESCE(${categories.nature}, 'non_essential')`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.competence, competence),
          inArray(transactions.status, COUNTED_STATUSES),
        ),
      ),

    db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.status, 'planned'),
          eq(transactions.kind, 'expense'),
          // Só parcela de verdade: linha de plano (`installment_plan_id`, que o
          // CHECK `transactions_installment_number_iff_plan` amarra ao número).
          // Sem isso, a previsão de despesa fixa (`recurring_expense_id`) e a
          // `planned` avulsa entravam em "Parcelas a vencer".
          isNotNull(transactions.installmentPlanId),
          gte(transactions.competence, futureInstallmentsStart),
          lte(transactions.competence, futureInstallmentsEnd),
        ),
      ),

    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.competence, competence),
          inArray(transactions.status, COUNTED_STATUSES),
          isNull(transactions.categoryId),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0)
      .catch(() => 0),

    db
      .select({
        competence: transactions.competence,
        amountCents: transactions.amountCents,
        kind: transactions.kind,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.competence, spendingWindowStart),
          lte(transactions.competence, competence),
          inArray(transactions.status, COUNTED_STATUSES),
        ),
      ),

    db
      .select({
        id: categories.id,
        name: categories.name,
        nature: categories.nature,
      })
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(asc(categories.sortOrder)),

    listCommitmentTransactions(householdId, competence, commitmentMonths),

    db
      .select({
        id: creditCards.id,
        name: creditCards.name,
        creditLimitCents: creditCards.creditLimitCents,
      })
      .from(creditCards)
      .where(
        and(eq(creditCards.householdId, householdId), eq(creditCards.active, true)),
      )
      .orderBy(asc(creditCards.name)),

    db
      .select({
        statementId: statements.id,
        reportedTotalCents: statements.reportedTotalCents,
        period: statements.period,
        creditCardName: creditCards.name,
        amountCents: transactions.amountCents,
      })
      .from(statements)
      .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
      .leftJoin(
        transactions,
        and(
          eq(transactions.statementId, statements.id),
          eq(transactions.householdId, householdId),
          // Fatura é o que foi lançado: `reconciled` (previsão cumprida) fora.
          inArray(transactions.status, COUNTED_STATUSES),
        ),
      )
      .where(
        and(
          eq(creditCards.householdId, householdId),
          eq(statements.period, competence),
        ),
      )
      .orderBy(desc(statements.period)),

    // Um plano por household (garantido em `createInvestmentPlan`).
    db
      .select({ contribution: investmentPlans.currentMonthlyContributionCents })
      .from(investmentPlans)
      .where(eq(investmentPlans.householdId, householdId))
      .limit(1),
  ]);

  const futureInstallmentsCents = safeCents(futureInstallmentsAgg[0]?.total ?? 0);

  const divergentStatements = collectDivergentStatements(
    divergentRows.map((row) => ({
      statementId: row.statementId,
      reportedTotalCents: row.reportedTotalCents === null ? null : safeCents(row.reportedTotalCents),
      period: row.period,
      creditCardName: row.creditCardName,
      amountCents: row.amountCents,
    })),
  );

  return {
    competence,
    commitmentMonths,
    monthlyTransactions: monthlyRows.map((row) => ({
      amountCents: safeCents(row.amountCents),
      kind: row.kind,
      status: row.status,
      categoryNature: row.categoryNature,
    })),
    futureInstallmentsCents,
    uncategorizedCount: Number(uncategorizedCountAgg),
    spendingTransactions: spendingRows.map((row) => ({
      competence: row.competence,
      amountCents: safeCents(row.amountCents),
      kind: row.kind,
      categoryId: row.categoryId,
    })),
    categoriesForSpending: categoriesRows,
    commitmentTransactions: commitmentRows,
    cards: cardsRows.map((row) => ({
      id: row.id,
      name: row.name,
      creditLimitCents: row.creditLimitCents === null ? null : safeCents(row.creditLimitCents),
    })),
    divergentStatements,
    plannedContributionCents:
      planRows[0] === undefined ? null : safeCents(planRows[0].contribution),
  };
}

/**
 * Agrupa as linhas brutas da junção `statements LEFT JOIN transactions` em
 * `DashboardDivergentStatement[]` — uma entrada por fatura com sua lista de
 * `amountCents` (em centavos já com sinal). O motor `divergentStatements`
 * (CONTRACTS §14) é quem compara com o `reportedTotalCents` declarado.
 */
function collectDivergentStatements(
  rows: {
    statementId: string;
    reportedTotalCents: Cents | null;
    period: string;
    creditCardName: string;
    amountCents: number | null;
  }[],
): DashboardDivergentStatement[] {
  const grouped = new Map<string, DashboardDivergentStatement>();
  for (const row of rows) {
    const existing = grouped.get(row.statementId);
    if (existing === undefined) {
      grouped.set(row.statementId, {
        statementId: row.statementId,
        reportedTotalCents: row.reportedTotalCents,
        period: row.period,
        creditCardName: row.creditCardName,
        amountCentsList: row.amountCents === null ? [] : [row.amountCents],
      });
      continue;
    }
    if (row.amountCents !== null) {
      existing.amountCentsList.push(row.amountCents);
    }
  }
  return [...grouped.values()];
}

/**
 * Entrada de `futureCommitment` (CONTRACTS §5): o ÚNICO recorte de "comprometimento
 * futuro". O painel (`getDashboardData`) e `/cartoes` chamam esta função, para as
 * duas telas nunca mostrarem dois números para o mesmo cartão.
 *
 * Janela: as `months` competências A PARTIR de `fromCompetence` (inclusive), a
 * mesma que o motor pavimenta. O recorte é por COMPETÊNCIA (o mês da fatura), não
 * pela data da compra.
 *
 * Entra toda linha de cartão que é compromisso: o que já está lançado (`posted`,
 * a fatura) e as parcelas de plano (`installment_plan_id`, em qualquer status).
 * Fica FORA a linha `planned` que não é parcela: a previsão de despesa fixa em
 * cartão (`recurring_expense_id`) e a `planned` avulsa. Previsão não é contrato;
 * com ela, "Parcelas já contratadas" passaria a incluir a assinatura do mês que
 * vem. Quando a previsão se realizar, ela chega como `posted` e entra.
 */
export async function listCommitmentTransactions(
  householdId: string,
  fromCompetence: Competence,
  months: number,
): Promise<DashboardCommitmentTransaction[]> {
  const to = addCompetence(fromCompetence, months - 1);
  const rows = await db
    .select({
      competence: transactions.competence,
      amountCents: transactions.amountCents,
      creditCardId: transactions.creditCardId,
      status: transactions.status,
      installment: sql<boolean>`${transactions.installmentPlanId} is not null`,
      // Fatura paga (decisao do Ricardo, 2026-10-08): a da propria linha (`statement_id`)
      // ou, para a parcela projetada (sem `statement_id`), a do mesmo cartao e competencia.
      // Vencida e nao paga continua contando: so a marca explicita tira.
      //
      // Nomes QUALIFICADOS e alias `paid_s` de proposito: interpolar a coluna de
      // `transactions` aqui sai sem o nome da tabela, e dentro da subconsulta
      // `credit_card_id` resolve para a coluna de `statements` — a fatura paga de
      // QUALQUER cartao tirava a linha (pego pelo teste "outro cartao").
      statementPaid: sql<boolean>`exists (
        select 1 from "statements" as "paid_s"
        where "paid_s"."status" = 'paid'
          and ("paid_s"."id" = "transactions"."statement_id"
            or ("paid_s"."credit_card_id" = "transactions"."credit_card_id"
              and "paid_s"."period" = "transactions"."competence"))
      )`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNotNull(transactions.creditCardId),
        // Compromisso de cartão é GASTO (e estorno). Pagamento de fatura e
        // transferência não são, mesmo se gravados com `credit_card_id` (RC-03).
        notInArray(transactions.kind, ['credit_card_payment', 'transfer']),
        inArray(transactions.status, COUNTED_STATUSES),
        gte(transactions.competence, fromCompetence),
        lte(transactions.competence, to),
        or(eq(transactions.status, 'posted'), isNotNull(transactions.installmentPlanId)),
      ),
    );
  return rows
    .filter((row): row is typeof row & { creditCardId: string } => row.creditCardId !== null)
    .map((row) => ({
      competence: row.competence,
      amountCents: safeCents(row.amountCents),
      creditCardId: row.creditCardId,
      status: row.status,
      installment: row.installment === true,
      statementPaid: row.statementPaid === true,
    }));
}

/**
 * Soma SQL — `SUM(amount_cents)` — de parcelas planejadas em uma janela
 * arbitrária. Mantida como utilitário público caso outra tela precise do
 * mesmo recorte (a Fase 2 pode usar para "parcelas a vencer 3 m", por ex.).
 *
 * Quem chama define `months`; a janela é competência+1 .. +`months` (mês
 * corrente fora), a mesma de `futureInstallmentsCents` em `getDashboardData`.
 * NÃO é a janela do card de comprometimento (ver o comentário de lá).
 */
export async function sumFutureInstallments(
  householdId: string,
  today: IsoDate,
  months: number,
): Promise<Cents> {
  const competence = toCompetence(today);
  const from = addCompetence(competence, 1);
  const to = addCompetence(competence, months);
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'planned'),
        eq(transactions.kind, 'expense'),
        // O mesmo recorte de `futureInstallmentsAgg`: só linha de plano.
        isNotNull(transactions.installmentPlanId),
        gte(transactions.competence, from),
        lte(transactions.competence, to),
      ),
    );
  return safeCents(row?.total ?? 0);
}

/**
 * Lista dos IDs de transações não categorizadas NA COMPETÊNCIA CORRENTE.
 * Alimenta a fila de pendências; o motor (`monthlyKpis.uncategorizedCount`)
 * devolve só a contagem, mas o painel precisa do link "ir categorizar" e,
 * portanto, dos IDs. Mantida em query separada para não inflar o payload
 * do dashboard.
 */
export async function listUncategorizedTransactionIds(
  householdId: string,
  today: IsoDate,
): Promise<string[]> {
  const competence = toCompetence(today);
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.competence, competence),
        inArray(transactions.status, COUNTED_STATUSES),
        isNull(transactions.categoryId),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Versão paralela da anterior que também devolve a descrição e o valor — o
 * link de pendências precisa do nome legível e do sinal para o usuário
 * reconhecer a linha. Mantida nesta camada (não no motor) porque é seleção
 * de dados, não regra de domínio.
 */
export async function listUncategorizedTransactionItems(
  householdId: string,
  today: IsoDate,
): Promise<{ id: string; description: string; amountCents: number; occurredOn: string }[]> {
  const competence = toCompetence(today);
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amountCents: transactions.amountCents,
      occurredOn: transactions.occurredOn,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.competence, competence),
        inArray(transactions.status, COUNTED_STATUSES),
        isNull(transactions.categoryId),
      ),
    )
    .orderBy(desc(transactions.occurredOn));
  return rows;
}

/**
 * Lista de IDs de faturas com `reportedTotalCents` preenchido no mês corrente —
 * pré-filtro barato para alimentar `divergentStatements` no painel. Quem
 * decide SE cada uma é divergente é o motor; esta função só lista candidatas.
 */
export async function listStatementIdsForCompetence(
  householdId: string,
  today: IsoDate,
): Promise<string[]> {
  const competence = toCompetence(today);
  const rows = await db
    .select({ id: statements.id })
    .from(statements)
    .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
    .where(
      and(
        eq(creditCards.householdId, householdId),
        eq(statements.period, competence),
        isNotNull(statements.reportedTotalCents),
      ),
    );
  return rows.map((row) => row.id);
}

export type IncomeExpenseRow = {
  competence: Competence;
  amountCents: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
};

/**
 * Linhas para o gráfico "receita × despesa" (T-208): as últimas `months`
 * competências, ATÉ a corrente (inclusive). Devolve linhas, não totais: quem
 * soma é `monthlyKpis`, uma vez por mês, para a barra do mês corrente bater com o
 * card "Receita/Despesa do mês" por construção (mesma regra de piso e estorno).
 *
 * `posted` e `planned` entram juntos, como nos KPIs ("o custo do mês inteiro").
 */
export async function listIncomeExpenseRows(
  householdId: string,
  today: IsoDate,
  months: number,
): Promise<IncomeExpenseRow[]> {
  const competence = toCompetence(today);
  const from = addCompetence(competence, -(months - 1));
  const rows = await db
    .select({
      competence: transactions.competence,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      status: transactions.status,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.competence, from),
        lte(transactions.competence, competence),
        inArray(transactions.status, COUNTED_STATUSES),
      ),
    );
  return rows.map((row) => ({ ...row, amountCents: safeCents(row.amountCents) }));
}

export type OverdueRecurringItem = {
  id: string;
  description: string;
  occurredOn: string;
  amountCents: Cents;
};

/**
 * Despesas recorrentes previstas e NÃO realizadas (SPEC §5.8, linha 3): linha
 * `planned`, de origem `recurring_expense_id`, com `occurred_on` ANTERIOR a hoje.
 * O corte é a DATA, não o mês, e `occurred_on = hoje` NÃO é vencida — a mesma
 * fronteira de `replanRecurrence`, que apaga e regenera a de hoje.
 *
 * Só `planned` conta: a previsão cumprida por um lançamento real vira `reconciled`
 * (decisão nº 7) e sai daqui. Enquanto a importação não conciliar (§3.4) ou para
 * lançamento manual (fora de escopo), uma previsão paga continua `planned` e
 * aparece: falso positivo conhecido, que a tela declara em vez de esconder.
 *
 * Devolve o total e só os `limit` mais antigos — a lista não cresce sem teto.
 */
export async function listOverdueRecurring(
  householdId: string,
  today: IsoDate,
  limit: number,
): Promise<{ count: number; items: OverdueRecurringItem[] }> {
  const where = and(
    eq(transactions.householdId, householdId),
    eq(transactions.status, 'planned'),
    isNotNull(transactions.recurringExpenseId),
    sql`${transactions.occurredOn} < ${today}::date`,
  );
  const [countRows, itemRows] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)::int` }).from(transactions).where(where),
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        occurredOn: transactions.occurredOn,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(where)
      .orderBy(asc(transactions.occurredOn))
      .limit(limit),
  ]);
  return {
    count: countRows[0]?.count ?? 0,
    items: itemRows.map((row) => ({ ...row, amountCents: safeCents(row.amountCents) })),
  };
}
