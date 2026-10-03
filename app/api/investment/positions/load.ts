import { getInvestmentPlan } from '@/lib/db/queries/investment';
import {
  getContributionMonths,
  getPlanStartCompetence,
  listSnapshots,
  type SnapshotRow,
} from '@/lib/db/queries/investment-positions';
import { addCompetence, diffMonths, toCompetence, type Competence, type IsoDate } from '@/lib/date';
import { accumulationCurve, DEFAULT_HORIZONS_YEARS } from '@/lib/finance/investment';
import { contributionAdherence, portfolioVsProjection } from '@/lib/finance/positions';
import { cents, type Cents } from '@/lib/money';

/** D5: 12 meses fechados antes do corrente + o corrente. */
export const ADHERENCE_CLOSED_MONTHS = 12;

/** Teto do motor para a curva (100 anos). */
const MAX_CURVE_MONTHS = 1_200;

export type PositionsResponse = {
  currentCompetence: Competence;
  /** `null` = sem plano: há registros e aportes, mas nada com que comparar. */
  plan: {
    plannedMonthlyCents: Cents;
    currentPortfolioCents: Cents;
    /** Competência de `current_portfolio_as_of`: âncora da curva de comparação (D7). */
    startCompetence: Competence;
    /**
     * Data exata a que `currentPortfolioCents` se refere (`current_portfolio_as_of`, D7). É o
     * que identifica O registro que virou o patrimônio atual: dois registros no mesmo mês
     * têm a mesma competência, nunca a mesma data.
     */
    currentPortfolioAsOf: IsoDate;
  } | null;
  snapshots: SnapshotRow[];
  /** Aporte efetivo da janela D5, mês a mês, com 0 nos meses sem aporte. */
  contributions: { competence: Competence; actualCents: Cents }[];
  /**
   * `contributionAdherence` (lib/finance/positions) sobre os meses da janela a partir da
   * âncora do plano (`current_portfolio_as_of`); `null` sem plano.
   */
  adherence: ReturnType<typeof contributionAdherence> | null;
  /** `portfolioVsProjection`; `null` sem plano. */
  comparison: ReturnType<typeof portfolioVsProjection> | null;
};

/**
 * Monta a resposta de `/api/investment/positions`: lê o banco e entrega aderência e
 * comparação já calculadas pelo motor (`lib/finance/positions`). A tela não faz conta.
 */
export async function loadPositionsResponse(householdId: string, today: string): Promise<PositionsResponse> {
  const currentCompetence = toCompetence(today);
  const from = addCompetence(currentCompetence, -ADHERENCE_CLOSED_MONTHS);
  const [stored, startCompetence, snapshots, found] = await Promise.all([
    getInvestmentPlan(householdId),
    getPlanStartCompetence(householdId),
    listSnapshots(householdId),
    getContributionMonths(householdId, from, currentCompetence),
  ]);
  const byCompetence = new Map(found.map((month) => [month.competence, month.actualCents]));
  const contributions = Array.from({ length: ADHERENCE_CLOSED_MONTHS + 1 }, (_, index) => {
    const competence = addCompetence(from, index);
    return { competence, actualCents: byCompetence.get(competence) ?? cents(0) };
  });

  if (stored === null || startCompetence === null) {
    return { currentCompetence, plan: null, snapshots, contributions, adherence: null, comparison: null };
  }
  const { plan, scenarios } = stored;

  // A curva cobre o maior horizonte e, se preciso, até o registro mais recente ou o mês
  // corrente (registro além do fim sairia `beyond_curve`). Todas com o MESMO tamanho.
  const latest = [currentCompetence, ...snapshots.map((snapshot) => toCompetence(snapshot.asOf))].reduce(
    (max, competence) => (diffMonths(competence, max) > 0 ? competence : max),
    startCompetence,
  );
  const months = Math.min(
    MAX_CURVE_MONTHS,
    Math.max(Math.max(...DEFAULT_HORIZONS_YEARS) * 12, diffMonths(latest, startCompetence)),
  );
  const curves = scenarios.map((scenario) => ({
    label: scenario.label,
    points: accumulationCurve({
      p0: plan.currentPortfolioCents,
      monthlyContribution: plan.currentMonthlyContributionCents,
      annualBp: scenario.realReturnBp,
      months,
      withdrawalBp: scenario.withdrawalBp,
      fromCompetence: startCompetence,
    }),
  }));

  return {
    currentCompetence,
    plan: {
      plannedMonthlyCents: plan.currentMonthlyContributionCents,
      currentPortfolioCents: plan.currentPortfolioCents,
      startCompetence,
      currentPortfolioAsOf: plan.currentPortfolioAsOf,
    },
    snapshots,
    contributions,
    // Só meses desde a âncora do plano: antes dela não havia este aporte planejado, e contar
    // esses meses como "abaixo do planejado" acusaria a família de um plano que não existia.
    // A lista `contributions` continua com a janela D5 inteira.
    adherence: contributionAdherence({
      months: contributions.filter((month) => diffMonths(month.competence, startCompetence) >= 0),
      plannedMonthlyCents: plan.currentMonthlyContributionCents,
      currentCompetence,
    }),
    comparison: portfolioVsProjection({ snapshots, curves, planStartCompetence: startCompetence }),
  };
}
