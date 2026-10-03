import type { ScenarioLabel } from '@/lib/db';
import type { InvestmentPlanInput, InvestmentScenarioInput } from '@/lib/db/queries/investment';
import type { Competence } from '@/lib/date';
import {
  accumulationCurve,
  DEFAULT_HORIZONS_YEARS,
  scenarioTable,
} from '@/lib/finance/investment';
import type { BasisPoints, Cents } from '@/lib/money';

/** Uma linha de `scenarioTable` (CONTRACTS §12), sem o `label` (está no cenário). */
export type ScenarioResult = {
  targetPortfolioCents: Cents;
  /** `null` = inalcançável com o aporte atual (CONTRACTS §12). */
  monthsWithCurrentContribution: number | null;
  requiredByHorizon: { years: number; contributionCents: Cents }[];
  projectedIncomeWithCurrentPlanCents: Cents;
  feasible: boolean;
};

/** Um ponto de `accumulationCurve`. */
export type CurvePoint = {
  month: number;
  competenceOffset: number;
  competence: Competence;
  portfolioCents: Cents;
  passiveIncomeCents: Cents;
};

export type ScenarioView = {
  label: ScenarioLabel;
  realReturnBp: BasisPoints;
  withdrawalBp: BasisPoints;
  result: ScenarioResult;
  /** Do mês da âncora (offset 0, patrimônio atual) até o maior horizonte. */
  curve: CurvePoint[];
};

/**
 * Roda o motor (`lib/finance/investment`) para o plano e os cenários. Puro: a rota usa
 * para responder o GET e, ANTES de gravar, para recusar premissas que o motor não aceita
 * (ele lança `RangeError` com mensagem em português; a rota devolve 400).
 */
export function computeScenarios(
  plan: Pick<
    InvestmentPlanInput,
    'desiredMonthlyIncomeCents' | 'currentPortfolioCents' | 'currentMonthlyContributionCents'
  >,
  scenarios: readonly InvestmentScenarioInput[],
  fromCompetence: Competence,
  horizonsYears: readonly number[] = DEFAULT_HORIZONS_YEARS,
): ScenarioView[] {
  const rows = scenarioTable({
    desiredMonthlyIncome: plan.desiredMonthlyIncomeCents,
    currentPortfolio: plan.currentPortfolioCents,
    currentMonthlyContribution: plan.currentMonthlyContributionCents,
    scenarios: scenarios.map((scenario) => ({
      label: scenario.label,
      realReturnBp: scenario.realReturnBp,
      withdrawalBp: scenario.withdrawalBp,
    })),
    horizonsYears: [...horizonsYears],
    fromCompetence,
  });
  const months = Math.max(0, ...horizonsYears) * 12;
  return scenarios.map((scenario, index) => {
    const row = rows[index];
    if (row === undefined) throw new Error('O motor não devolveu a linha do cenário.');
    return {
      label: scenario.label,
      realReturnBp: scenario.realReturnBp,
      withdrawalBp: scenario.withdrawalBp,
      result: {
        targetPortfolioCents: row.targetPortfolioCents,
        monthsWithCurrentContribution: row.monthsWithCurrentContribution,
        requiredByHorizon: row.requiredByHorizon,
        projectedIncomeWithCurrentPlanCents: row.projectedIncomeWithCurrentPlanCents,
        feasible: row.feasible,
      },
      curve: accumulationCurve({
        p0: plan.currentPortfolioCents,
        monthlyContribution: plan.currentMonthlyContributionCents,
        annualBp: scenario.realReturnBp,
        months,
        withdrawalBp: scenario.withdrawalBp,
        fromCompetence,
      }),
    };
  });
}

/** Premissas que passaram no Zod mas o motor recusa. A rota devolve 400 com a mensagem. */
export class InvestmentPremiseError extends Error {
  constructor(message: string) {
    super(`Premissas fora do alcance do cálculo: ${message}`);
    this.name = 'InvestmentPremiseError';
  }
}

/**
 * Roda o motor ANTES de gravar. Só o `RangeError` lançado AQUI vira erro de premissa: um
 * `RangeError` de outra origem (por exemplo, valor corrompido lido do banco no GET) segue
 * como 500, sem culpar o usuário.
 */
export function assertComputable(...args: Parameters<typeof computeScenarios>): void {
  try {
    computeScenarios(...args);
  } catch (error) {
    if (error instanceof RangeError) throw new InvestmentPremiseError(error.message);
    throw error;
  }
}
