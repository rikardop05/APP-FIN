import { BarChart3 } from 'lucide-react';

import type { Competence } from '@/lib/date';
import type { CashflowProjection } from '@/lib/finance/cashflow';
import type { BasisPoints, Cents } from '@/lib/money';

import { CommitmentChart } from './commitment-chart';
import { CommitmentSummary } from './commitment-summary';
import { IncomeExpenseChart } from './income-expense-chart';
import type { IncomeExpenseMonth } from './income-expense-series';
import { KpisRow } from './kpis-row';
import {
  PendenciasList,
  type DivergentStatementItem,
  type OverBudgetListItem,
  type OverdueRecurringListItem,
  type UncategorizedItem,
} from './pendencias-list';
import { ProjectedBalance } from './projected-balance';
import { SpendingByCategory } from './spending-by-category';

type DashboardScreenProps = {
  competence: string;
  commitmentMonths: number;
  kpis: {
    incomeCents: Cents;
    expenseCents: Cents;
    contributionsCents: Cents;
    surplusCents: Cents;
    savingsRateBp: BasisPoints | null;
    essentialShareBp: BasisPoints | null;
    futureInstallmentsCents: Cents;
    uncategorizedCount: number;
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
    lastCommittedCompetence: string | null;
    windowEnd: string;
    /** `futureCommitment().byCompetence` — alimenta o gráfico 4. Omitido = sem gráfico. */
    byCompetence?: { competence: Competence; totalCents: Cents }[];
  };
  /** Gráfico 1: últimos 12 meses, de `buildIncomeExpenseSeries`. Omitido = sem gráfico. */
  incomeExpense?: IncomeExpenseMonth[];
  /** Gráfico 3: a MESMA projeção de `/fluxo` (`loadProjectedCashflow`). Omitido = sem gráfico. */
  projected?: { projection: CashflowProjection; warnings: string[] };
  pendencias: {
    uncategorizedCount: number;
    uncategorizedItems: UncategorizedItem[];
    divergentStatements: DivergentStatementItem[];
    overBudget?: OverBudgetListItem[];
    overdueRecurring?: { count: number; items: OverdueRecurringListItem[] };
  };
};

/**
 * Composição do dashboard (T-115).
 *
 * Esta tela NÃO calcula nada — todos os números exibidos vêm dos motores
 * puros em `lib/finance/kpis.ts` e `lib/finance/commitment.ts`:
 * - KPIs → `monthlyKpis` (CONTRACTS §14);
 * - Gastos por categoria → `spendingByCategory` (CONTRACTS §14);
 * - Resumo de comprometimento → `futureCommitment` (CONTRACTS §5), lendo
 *   apenas `totalCents` e `lastCommittedCompetence` (sem invólucro novo
 *   no motor — instrução do Orquestrador);
 * - Faturas divergentes → `divergentStatements` (CONTRACTS §14);
 * - Não categorizados → lista bruta de `transactions` com
 *   `category_id IS NULL`, contada por `monthlyKpis.uncategorizedCount`.
 *
 * Estrutura em três faixas (SPEC §5.8):
 * 1. KPIs do mês (8 cartões nesta FASE 1 — Receita, Despesa, Sobra/Déficit,
 *    Taxa de poupança, Essenciais, Aportes, Parcelas a vencer, Não
 *    categorizados);
 * 2. Os quatro gráficos da SPEC §5.8 desta fase (T-208): receita × despesa,
 *    gastos por categoria, saldo projetado e comprometimento em cartão. O saldo
 *    projetado é o MESMO de `/fluxo`, vindo de `loadProjectedCashflow`;
 * 3. Resumo de comprometimento + fila de pendências (não categorizados, faturas
 *    divergentes, orçamentos estourados, despesas fixas não realizadas).
 */
export function DashboardScreen({
  competence,
  commitmentMonths,
  kpis,
  spending,
  commitment,
  incomeExpense,
  projected,
  pendencias,
}: DashboardScreenProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          <BarChart3 className="h-7 w-7" aria-hidden="true" />
          Painel
        </h1>
        <p className="text-sm text-muted-foreground">
          Como estamos este mês e para onde estamos indo. Tudo vem do motor —
          nenhum número é calculado aqui.
        </p>
      </header>

      <KpisRow
        competence={competence}
        commitmentMonths={commitmentMonths}
        incomeCents={kpis.incomeCents}
        expenseCents={kpis.expenseCents}
        contributionsCents={kpis.contributionsCents}
        surplusCents={kpis.surplusCents}
        savingsRateBp={kpis.savingsRateBp}
        essentialShareBp={kpis.essentialShareBp}
        futureInstallmentsCents={kpis.futureInstallmentsCents}
        uncategorizedCount={kpis.uncategorizedCount}
      />

      {/* Linha 2 (SPEC §5.8): os quatro gráficos desta fase. O 5 (renda passiva) é Fase 3. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {incomeExpense ? (
          <IncomeExpenseChart months={incomeExpense} currentCompetence={competence} />
        ) : null}
        <SpendingByCategory items={spending} competence={competence} />
        {projected ? (
          <ProjectedBalance projection={projected.projection} warnings={projected.warnings} />
        ) : null}
        <div className="flex flex-col gap-6">
          {commitment.byCompetence ? <CommitmentChart entries={commitment.byCompetence} /> : null}
          <CommitmentSummary
            competence={competence}
            commitmentMonths={commitmentMonths}
            totalCents={commitment.totalCents}
            lastCommittedCompetence={commitment.lastCommittedCompetence}
            windowEnd={commitment.windowEnd}
          />
        </div>
      </div>

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
