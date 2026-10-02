import { loadProjectedCashflow } from '@/app/_lib/load-cashflow';
import { todayInSaoPaulo } from '@/app/_lib/today';
import { addCompetence, toCompetence } from '@/lib/date';
import { futureCommitment } from '@/lib/finance/commitment';
import { divergentStatements, monthlyKpis, spendingByCategory } from '@/lib/finance/kpis';
import { cents, type Cents } from '@/lib/money';

import { DashboardScreen } from '@/components/dashboard/dashboard-screen';
import { buildIncomeExpenseSeries } from '@/components/dashboard/income-expense-series';
import type { ProjectedState } from '@/components/dashboard/projected-balance';
import { type DivergentStatementItem, type UncategorizedItem } from '@/components/dashboard/pendencias-list';
import { requireSession } from '@/lib/auth/session';
import { listOverBudget, type OverBudgetItem } from '@/lib/db/queries/budgets';
import {
  getDashboardData,
  listIncomeExpenseRows,
  listOverdueRecurring,
  listUncategorizedTransactionItems,
} from '@/lib/db/queries/dashboard';
import { getSettings } from '@/lib/db/queries/settings';

export const dynamic = 'force-dynamic';

/** Gráfico 1 (SPEC §5.8): últimos 12 meses. */
const INCOME_EXPENSE_MONTHS = 12;
/** Quantas despesas fixas não realizadas listar (a contagem total vai junto). */
const OVERDUE_RECURRING_LIMIT = 10;

/**
 * Página `/` do APPFIN — dashboard da Fase 1 (T-115).
 *
 * Server Component assíncrono: chama os motores puros em
 * `lib/finance/kpis.ts` e `lib/finance/commitment.ts` passando dados do
 * banco já recortados por household (CONVENTIONS §7) e por janela
 * temporal. Nenhuma conta financeira é feita aqui — quem decide os
 * números é o motor.
 *
 * RC-03/RC-04 (transferência e pagamento de fatura fora da despesa; aporte
 * separado) já está aplicado dentro dos motores; esta página só reempacota.
 *
 * O horizonte do comprometimento vem de `household_settings.commitment_months`
 * (default 24, configurável em /config). `getSettings` é uma leitura
 * única de 1 linha 1:1 (PK = `household_id`), então cabe em uma única
 * round-trip antes do agregado de queries do dashboard. O mesmo valor é
 * passado para `getDashboardData` (janela da soma de `futureInstallmentsCents`)
 * e para `futureCommitment` (janela do gráfico/tabela de comprometimento). O N
 * é o mesmo, as janelas não: "Parcelas a vencer" começa no mês SEGUINTE (a
 * parcela do mês corrente já está na despesa do mês) e o comprometimento começa
 * no mês corrente. A razão está em `getDashboardData`.
 */
export default async function DashboardPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  const competence = toCompetence(today);

  // Saldo projetado (gráfico 3): o MESMO caminho de `/fluxo` (`loadProjectedCashflow`),
  // para as duas telas mostrarem o mesmo saldo. Falha NÃO some: vira `unavailable`,
  // que a tela escreve, e o erro vai para o log. Casa sem nada para projetar vira
  // `empty` (mesmo critério do `/fluxo`), em vez de uma curva reta em zero.
  //
  // Roda PRIMEIRO, e de propósito: o loader é quem chama `topUpPlanned` (completa
  // a previsão de recorrência até o horizonte; nunca lança), e as leituras do
  // painel abaixo precisam ver essas linhas. Assim a escrita roda UMA vez por
  // visita. Não mova esta chamada para depois das leituras nem para dentro do
  // `Promise.all`: elas leriam antes da previsão estar completa.
  let projected: ProjectedState;
  try {
    const loaded = await loadProjectedCashflow(householdId, today);
    projected = loaded.hasProjectableData
      ? { kind: 'ok', projection: loaded.projection, warnings: loaded.warnings }
      : { kind: 'empty' };
  } catch (error) {
    console.error('[dashboard] saldo projetado indisponivel:', error);
    projected = { kind: 'unavailable' };
  }

  const settings = await getSettings(householdId);

  const [dashboard, uncategorizedItems, incomeExpenseRows, overdueRecurring] = await Promise.all([
    getDashboardData(householdId, today, settings.commitmentMonths),
    listUncategorizedTransactionItems(householdId, today),
    listIncomeExpenseRows(householdId, today, INCOME_EXPENSE_MONTHS),
    listOverdueRecurring(householdId, today, OVERDUE_RECURRING_LIMIT),
  ]);

  // Orcamentos estourados no mes (T-205): "estourado" e o `light === 'red'` de
  // `budgetStatus`, decidido la. Se a consulta falhar, o painel segue com um aviso
  // no lugar da lista (e o erro vai para o log):
  // carrega, e um orcamento quebrado nao pode derrubar o painel inteiro.
  // `null` = nao deu para conferir; a lista de pendencias escreve isso (nunca
  // "nada pendente").
  let overBudget: OverBudgetItem[] | null = null;
  try {
    overBudget = await listOverBudget(householdId, competence);
  } catch (error) {
    console.error('[dashboard] orcamentos estourados indisponiveis:', error);
  }

  const kpis = monthlyKpis({
    competence,
    transactions: dashboard.monthlyTransactions,
    futureInstallmentsCents: dashboard.futureInstallmentsCents,
    uncategorizedCount: dashboard.uncategorizedCount,
  });

  const spending = spendingByCategory({
    competence,
    transactions: dashboard.spendingTransactions,
    categories: dashboard.categoriesForSpending,
  });

  const commitment = futureCommitment({
    fromCompetence: competence,
    months: settings.commitmentMonths,
    cards: dashboard.cards,
    transactions: dashboard.commitmentTransactions,
  });

  const divergent = divergentStatements(
    dashboard.divergentStatements.map((entry) => ({
      statementId: entry.statementId,
      reportedTotalCents: entry.reportedTotalCents,
      transactions: entry.amountCentsList.map((amount) => ({ amountCents: cents(amount) })),
    })),
  );

  const divergentItems: DivergentStatementItem[] = divergent.map((entry, index) => {
    const source = dashboard.divergentStatements[index];
    return {
      statementId: entry.statementId,
      cardName: source?.creditCardName ?? 'Cartão',
      period: source?.period ?? competence,
      reportedTotalCents: source?.reportedTotalCents ?? null,
      differenceCents: entry.differenceCents,
    };
  });

  const pendenciaItems: UncategorizedItem[] = uncategorizedItems.map((item) => ({
    id: item.id,
    description: item.description,
    amountCents: item.amountCents,
    occurredOn: item.occurredOn,
  }));

  const windowEnd = addCompetence(competence, settings.commitmentMonths - 1);
  // Gráfico 1: cada mes passa por `monthlyKpis`, o motor do card do mes.
  const incomeExpense = buildIncomeExpenseSeries(incomeExpenseRows, competence, INCOME_EXPENSE_MONTHS);

  return (
    <DashboardScreen
      competence={competence}
      commitmentMonths={settings.commitmentMonths}
      kpis={{
        incomeCents: kpis.incomeCents,
        expenseCents: kpis.expenseCents,
        contributionsCents: kpis.contributionsCents,
        surplusCents: kpis.surplusCents,
        savingsRateBp: kpis.savingsRateBp,
        essentialShareBp: kpis.essentialShareBp,
        futureInstallmentsCents: kpis.futureInstallmentsCents,
        uncategorizedCount: kpis.uncategorizedCount,
      }}
      spending={spending.map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        nature: row.nature,
        spentCents: row.spentCents,
        average3mCents: row.average3mCents,
        variationBp: row.variationBp,
      }))}
      commitment={{
        totalCents: commitment.totalCents as Cents,
        lastCommittedCompetence: commitment.lastCommittedCompetence,
        windowEnd,
        byCompetence: commitment.byCompetence.map((entry) => ({
          competence: entry.competence,
          totalCents: entry.totalCents,
        })),
      }}
      incomeExpense={incomeExpense}
      projected={projected}
      pendencias={{
        uncategorizedCount: dashboard.uncategorizedCount,
        uncategorizedItems: pendenciaItems,
        divergentStatements: divergentItems,
        overBudget,
        overdueRecurring,
      }}
    />
  );
}
