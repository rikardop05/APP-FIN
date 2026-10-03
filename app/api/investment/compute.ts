import type { ScenarioLabel } from '@/lib/db';
import type { InvestmentPlanInput, InvestmentScenarioInput } from '@/lib/db/queries/investment';
import { diffMonths, toCompetence, type Competence } from '@/lib/date';
import {
  accumulationCurve,
  contributionFeasibility,
  DEFAULT_HORIZONS_YEARS,
  requiredContribution,
  scenarioTable,
} from '@/lib/finance/investment';
import { cents, type BasisPoints, type Cents } from '@/lib/money';

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

/** Contra qual aporte a sobra é comparada (a tela diz qual). */
export type FeasibilityBasis =
  | { kind: 'targetDate'; months: number }
  | { kind: 'horizon'; years: number };

/** RF-INV-05 por cenário: `contributionFeasibility` do motor, mais a base da comparação. */
export type ScenarioFeasibility = {
  basis: FeasibilityBasis;
  requiredCents: Cents;
  /** Quanto falta por mês; 0 quando cabe. */
  gapCents: Cents;
  feasible: boolean;
  /** Fração da sobra que o aporte consome; `null` quando a sobra é <= 0. */
  surplusUsageBp: BasisPoints | null;
};

export type ScenarioView = {
  label: ScenarioLabel;
  realReturnBp: BasisPoints;
  withdrawalBp: BasisPoints;
  result: ScenarioResult;
  /**
   * Aporte mensal para chegar ao alvo até o prazo do plano (`targetDate`). `null` quando o
   * plano não tem prazo, ou o prazo já chegou (0 meses ou menos), ou passa de 100 anos.
   */
  requiredForTargetDate: { months: number; contributionCents: Cents } | null;
  /** `null` quando não há histórico de sobra (nada a comparar). */
  feasibility: ScenarioFeasibility | null;
  /** Do mês da âncora (offset 0, patrimônio atual) até o maior horizonte. */
  curve: CurvePoint[];
};

/** Limite do motor para `requiredContribution` (100 anos). */
const MAX_TARGET_MONTHS = 1_200;

/**
 * Média mensal da sobra (receita − despesa) dos meses com histórico. `null` sem nenhum mês.
 * Pode ser negativa (déficit). Centavo mais próximo, meio se afasta do zero (a regra de
 * estado do motor), em inteiro.
 */
export function averageMonthlySurplus(months: readonly { surplusCents: Cents }[]): Cents | null {
  if (months.length === 0) return null;
  let total = 0n;
  for (const month of months) total += BigInt(cents(month.surplusCents));
  const count = BigInt(months.length);
  const magnitude = ((total < 0n ? -total : total) * 2n + count) / (count * 2n);
  return cents(Number(total < 0n ? -magnitude : magnitude));
}

/**
 * Meses do prazo: da competência de hoje até a do `targetDate`. Prazo no mês corrente dá 0
 * (não há mês de aporte pela frente). Fora de 1..1200 → `null`.
 */
export function targetDateMonths(targetDate: string | null, fromCompetence: Competence): number | null {
  if (targetDate === null) return null;
  const months = diffMonths(toCompetence(targetDate), fromCompetence);
  return months >= 1 && months <= MAX_TARGET_MONTHS ? months : null;
}

/**
 * Viabilidade de UM cenário contra a sobra média: compara com o aporte até o prazo, se
 * houver; senão com o do maior horizonte. `null` sem sobra conhecida ou sem nada a comparar.
 */
export function scenarioFeasibility(
  requiredForTargetDate: ScenarioView['requiredForTargetDate'],
  requiredByHorizon: ScenarioResult['requiredByHorizon'],
  averageSurplusCents: Cents | null,
): ScenarioFeasibility | null {
  if (averageSurplusCents === null) return null;
  let basis: FeasibilityBasis;
  let requiredCents: Cents;
  if (requiredForTargetDate !== null) {
    basis = { kind: 'targetDate', months: requiredForTargetDate.months };
    requiredCents = requiredForTargetDate.contributionCents;
  } else {
    const longest = requiredByHorizon.reduce<ScenarioResult['requiredByHorizon'][number] | null>(
      (best, item) => (best === null || item.years > best.years ? item : best),
      null,
    );
    if (longest === null) return null;
    basis = { kind: 'horizon', years: longest.years };
    requiredCents = longest.contributionCents;
  }
  const result = contributionFeasibility({
    requiredContributionCents: requiredCents,
    averageMonthlySurplusCents: averageSurplusCents,
  });
  return {
    basis,
    requiredCents,
    gapCents: result.gapCents,
    feasible: result.feasible,
    surplusUsageBp: result.surplusUsageBp,
  };
}

/**
 * Roda o motor (`lib/finance/investment`) para o plano e os cenários. Puro: a rota usa
 * para responder o GET e, ANTES de gravar, para recusar premissas que o motor não aceita
 * (ele lança `RangeError` com mensagem em português; a rota devolve 400).
 */
export function computeScenarios(
  plan: Pick<
    InvestmentPlanInput,
    'desiredMonthlyIncomeCents' | 'currentPortfolioCents' | 'currentMonthlyContributionCents' | 'targetDate'
  >,
  scenarios: readonly InvestmentScenarioInput[],
  fromCompetence: Competence,
  horizonsYears: readonly number[] = DEFAULT_HORIZONS_YEARS,
  averageSurplusCents: Cents | null = null,
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
  const deadline = targetDateMonths(plan.targetDate, fromCompetence);
  return scenarios.map((scenario, index) => {
    const row = rows[index];
    if (row === undefined) throw new Error('O motor não devolveu a linha do cenário.');
    const requiredForTargetDate =
      deadline === null
        ? null
        : {
            months: deadline,
            contributionCents: requiredContribution(
              row.targetPortfolioCents,
              plan.currentPortfolioCents,
              scenario.realReturnBp,
              deadline,
            ),
          };
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
      requiredForTargetDate,
      feasibility: scenarioFeasibility(requiredForTargetDate, row.requiredByHorizon, averageSurplusCents),
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
