import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { addCompetence, toCompetence, type Competence, type IsoDate } from '@/lib/date';
import { db } from '@/lib/db';
import type { CategoryNature, TransactionKind, TransactionStatus } from '@/lib/db';
import {
  categories,
  creditCards,
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
 * O horizonte do comprometimento vem de `household_settings.commitment_months`
 * (default 24) — a página passa o valor já lido. Mesma janela serve para o
 * `futureCommitment` e para o `futureInstallmentsCents`, evitando que o
 * dashboard e o card de comprometimento mostrem números diferentes para a
 * mesma pergunta ("parcelas a vencer").
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
  const commitmentEnd = addCompetence(competence, commitmentMonths - 1);

  const [
    monthlyRows,
    futureInstallmentsAgg,
    uncategorizedCountAgg,
    spendingRows,
    categoriesRows,
    commitmentRows,
    cardsRows,
    divergentRows,
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

    db
      .select({
        competence: transactions.competence,
        amountCents: transactions.amountCents,
        creditCardId: transactions.creditCardId,
        status: transactions.status,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.competence, competence),
          lte(transactions.competence, commitmentEnd),
          isNotNull(transactions.creditCardId),
        ),
      ),

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
        ),
      )
      .where(
        and(
          eq(creditCards.householdId, householdId),
          eq(statements.period, competence),
        ),
      )
      .orderBy(desc(statements.period)),
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
    commitmentTransactions: commitmentRows
      .filter((row): row is typeof row & { creditCardId: string } => row.creditCardId !== null)
      .map((row) => ({
        competence: row.competence,
        amountCents: safeCents(row.amountCents),
        creditCardId: row.creditCardId,
        status: row.status,
      })),
    cards: cardsRows.map((row) => ({
      id: row.id,
      name: row.name,
      creditLimitCents: row.creditLimitCents === null ? null : safeCents(row.creditLimitCents),
    })),
    divergentStatements,
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
 * Soma SQL — `SUM(amount_cents)` — de parcelas planejadas em uma janela
 * arbitrária. Mantida como utilitário público caso outra tela precise do
 * mesmo recorte (a Fase 2 pode usar para "parcelas a vencer 3 m", por ex.).
 *
 * Quem chama define `months`; o dashboard usa `commitmentMonths` da
 * household_settings, garantindo que o número exibido no KPI bata com o do
 * card de comprometimento.
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
