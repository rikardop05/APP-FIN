import { todayInSaoPaulo } from '@/app/_lib/today';
import { addCompetence, toCompetence } from '@/lib/date';
import { futureCommitment } from '@/lib/finance/commitment';
import { divergentStatements, monthlyKpis, spendingByCategory } from '@/lib/finance/kpis';
import { cents, type Cents } from '@/lib/money';

import { DashboardScreen } from '@/components/dashboard/dashboard-screen';
import { type DivergentStatementItem, type UncategorizedItem } from '@/components/dashboard/pendencias-list';
import { requireSession } from '@/lib/auth/session';
import { listOverBudget, type OverBudgetItem } from '@/lib/db/queries/budgets';
import { getDashboardData, listUncategorizedTransactionItems } from '@/lib/db/queries/dashboard';
import { topUpPlanned } from '@/lib/db/queries/recurring-planned-write';
import { getSettings } from '@/lib/db/queries/settings';

export const dynamic = 'force-dynamic';

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
 * e para `futureCommitment` (janela do gráfico/tabela de comprometimento) —
 * a família não vê "parcelas a vencer" com dois números diferentes.
 */
export default async function DashboardPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  const competence = toCompetence(today);

  // Completa a previsao de recorrencia ate o horizonte antes de ler o painel.
  // Nunca lanca: falha aqui nao pode virar 500 no dashboard.
  await topUpPlanned(householdId, today);
  const settings = await getSettings(householdId);

  const [dashboard, uncategorizedItems] = await Promise.all([
    getDashboardData(householdId, today, settings.commitmentMonths),
    listUncategorizedTransactionItems(householdId, today),
  ]);

  // Orcamentos estourados no mes (T-205): "estourado" e o `light === 'red'` de
  // `budgetStatus`, decidido la. Se a consulta falhar, o painel segue SEM essa
  // linha (e o erro vai para o log): `overBudget` omitido = pagina ainda nao
  // carrega, e um orcamento quebrado nao pode derrubar o painel inteiro.
  let overBudget: OverBudgetItem[] | undefined;
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
      }}
      pendencias={{
        uncategorizedCount: dashboard.uncategorizedCount,
        uncategorizedItems: pendenciaItems,
        divergentStatements: divergentItems,
        ...(overBudget === undefined ? {} : { overBudget }),
      }}
    />
  );
}
