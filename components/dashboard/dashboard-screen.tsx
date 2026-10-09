import type { Competence } from '@/lib/date';
import type { BasisPoints, Cents } from '@/lib/money';
import { PageHeader } from '@/components/ui-kit';

import { CommittedCard, type CommittedMonth } from './committed-card';
import { Headline } from './headline';
import { IncomeExpenseChart } from './income-expense-chart';
import type { IncomeExpenseMonth } from './income-expense-series';
import { MonthSummary } from './month-summary';
import { PassiveIncomeCard } from './passive-income/passive-income-card';
import type { PassiveIncomeState } from './passive-income/passive-income';
import {
  PendenciasList,
  type DivergentStatementItem,
  type OverBudgetListItem,
  type OverdueRecurringListItem,
  type UncategorizedItem,
} from './pendencias-list';
import { monthName, pendingSummary } from './presentation';
import { ProjectedBalance, type ProjectedState } from './projected-balance';
import { SpendingByCategory } from './spending-by-category';

type DashboardScreenProps = {
  competence: Competence;
  kpis: {
    incomeCents: Cents;
    expenseCents: Cents;
    /** Só o LANÇADO; o planejado vem em `plannedContributionCents`. */
    contributionsCents: Cents;
    plannedContributionCents: Cents | null;
    surplusCents: Cents;
    savingsRateBp: BasisPoints | null;
    essentialShareBp: BasisPoints | null;
  };
  spending: {
    categoryId: string;
    name: string;
    nature: 'essential' | 'non_essential' | 'investment' | 'income';
    spentCents: Cents;
    average3mCents: Cents;
    variationBp: BasisPoints | null;
  }[];
  commitment: {
    totalCents: Cents;
    lastCommittedCompetence: Competence | null;
    windowEnd: Competence;
    /** `futureCommitment().breakdown`: as três linhas fecham exatamente com `totalCents`. */
    breakdown: {
      overdueUnpaidCents: Cents;
      currentStatementCents: Cents;
      laterInstallmentsCents: Cents;
      laterPurchasesCents: Cents;
    };
    /** `futureCommitment().overdueCompetences`: os meses das faturas vencidas e não pagas. */
    overdueCompetences: Competence[];
    /** `futureCommitment().byCompetence`: alimenta os canhotos presos e o "mês que vem". */
    byCompetence: CommittedMonth[];
  };
  /**
   * Os campos abaixo são OBRIGATÓRIOS de propósito: um componente opcional que a página esquece de
   * passar compila e some da tela. "Não deu para carregar" é um valor explícito, nunca omissão.
   */
  incomeExpense: IncomeExpenseMonth[];
  /** A MESMA projeção de `/fluxo` (`loadProjectedCashflow`). */
  projected: ProjectedState;
  /** Renda passiva (T-306). `none` = sem plano; `unavailable` = o planejador falhou. */
  passiveIncome: PassiveIncomeState;
  pendencias: {
    uncategorizedCount: number;
    uncategorizedItems: UncategorizedItem[];
    divergentStatements: DivergentStatementItem[];
    /** `null` = a consulta de orçamento falhou; a lista diz isso em vez de omitir a seção. */
    overBudget: OverBudgetListItem[] | null;
    overdueRecurring: { count: number; items: OverdueRecurringListItem[] };
  };
};

/**
 * Painel (onda 2, Carnê de Prestações). Esta tela NÃO calcula nada: todo número vem dos motores
 * (`monthlyKpis`, `spendingByCategory`, `futureCommitment`, `divergentStatements`, projeção do fluxo).
 *
 * Ordem pensada para responder em 10 segundos, inclusive no celular: o FUTURO antes do passado.
 * 1. Três números do mês: sobra (com a base), veredito de 12 meses e comprometido do mês que vem;
 *    pendências só como contagem com link.
 * 2. Comprometido nos cartões (futuro) e saldo projetado (futuro).
 * 3. O mês corrente e o passado: resumo, receita × despesa, gastos por categoria.
 * 4. Renda passiva (20 anos) atrás de "ver mais" e a lista de pendências por último.
 */
export function DashboardScreen({
  competence,
  kpis,
  spending,
  commitment,
  incomeExpense,
  projected,
  passiveIncome,
  pendencias,
}: DashboardScreenProps) {
  const pending = pendingSummary({
    uncategorizedCount: pendencias.uncategorizedCount,
    divergentCount: pendencias.divergentStatements.length,
    overBudgetCount: pendencias.overBudget?.length ?? 0,
    overdueRecurringCount: pendencias.overdueRecurring.count,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Painel" description={`Como estamos em ${monthName(competence)} e para onde vamos.`} />

      <Headline
        competence={competence}
        incomeCents={kpis.incomeCents}
        expenseCents={kpis.expenseCents}
        surplusCents={kpis.surplusCents}
        contributionsCents={kpis.contributionsCents}
        plannedContributionCents={kpis.plannedContributionCents}
        projected={projected}
        pending={pending}
        pendingUnavailable={pendencias.overBudget === null}
      />

      <CommittedCard
        competence={competence}
          windowEnd={commitment.windowEnd}
          totalCents={commitment.totalCents}
          lastCommittedCompetence={commitment.lastCommittedCompetence}
          breakdown={commitment.breakdown}
          overdueCompetences={commitment.overdueCompetences}
          byCompetence={commitment.byCompetence}
        />

      <ProjectedBalance state={projected} />

      <MonthSummary
        competence={competence}
        incomeCents={kpis.incomeCents}
        expenseCents={kpis.expenseCents}
        savingsRateBp={kpis.savingsRateBp}
        essentialShareBp={kpis.essentialShareBp}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IncomeExpenseChart months={incomeExpense} currentCompetence={competence} />
        <SpendingByCategory items={spending} competence={competence} />
      </div>

      <details className="group">
        <summary className="min-h-11 cursor-pointer border border-border bg-card px-4 py-3 text-sm font-medium text-foreground sm:px-5">
          Renda passiva em 20 anos
        </summary>
        <div className="mt-3">
          <PassiveIncomeCard state={passiveIncome} />
        </div>
      </details>

      <PendenciasList
        uncategorizedCount={pendencias.uncategorizedCount}
        uncategorizedItems={pendencias.uncategorizedItems}
        divergentStatements={pendencias.divergentStatements}
        overBudget={pendencias.overBudget}
        overdueRecurring={pendencias.overdueRecurring}
      />
    </div>
  );
}
