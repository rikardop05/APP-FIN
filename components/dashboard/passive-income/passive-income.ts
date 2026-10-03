import { formatMonthsToTarget, scenarioName, SCENARIO_ORDER, type ScenarioLabel } from '@/components/investment/display';
import type { InvestmentScenario } from '@/components/investment/schemas';
import type { IsoDate } from '@/lib/date';
import { goalProgress } from '@/lib/finance/goals';
import type { Cents } from '@/lib/money';

/**
 * Card de renda passiva no painel (T-306): decide o que o card diz. Nenhuma conta de
 * dinheiro aqui; o progresso vem do motor de metas (`goalProgress`) e o resto é o que o
 * planejador (`loadInvestmentResponse`) já calculou. Fora do .tsx porque o vitest não
 * transforma JSX.
 *
 * O estado é um tipo FECHADO e a prop do painel é obrigatória (mesmo padrão do saldo
 * projetado): "não deu para carregar" é um valor, nunca omissão.
 */

/** Só o que o card lê da resposta do planejador (estrutural: aceita `InvestmentResponse`). */
export type PassiveIncomeSource = {
  horizonsYears: number[];
  plan: { name: string; desiredMonthlyIncomeCents: Cents; currentPortfolioCents: Cents } | null;
  scenarios: {
    label: ScenarioLabel;
    result: { targetPortfolioCents: Cents; monthsWithCurrentContribution: number | null };
    curve: InvestmentScenario['curve'];
  }[];
};

export type PassiveIncomeScenarioRow = {
  label: ScenarioLabel;
  name: string;
  targetCents: Cents;
  /** Patrimônio atual / alvo, em bp, de 0 a 10000. `null` quando o alvo é 0 (renda desejada zero). */
  progressBp: number | null;
  /** "X anos e Y meses", "Inalcançável com o aporte atual"... (mesma regra do planejador). */
  timeText: string;
};

export type PassiveIncomeState =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | {
      kind: 'ok';
      planName: string;
      currentPortfolioCents: Cents;
      desiredMonthlyIncomeCents: Cents;
      /** O maior horizonte das curvas, em anos. */
      horizonYears: number;
      /** Conservador, médio, otimista. */
      scenarios: PassiveIncomeScenarioRow[];
      /** O alvo do cenário médio, a referência do gráfico. `null` se o cenário não veio. */
      moderateTargetCents: Cents | null;
      curves: Pick<InvestmentScenario, 'label' | 'curve'>[];
    };

export function buildPassiveIncomeState(source: PassiveIncomeSource, today: IsoDate): PassiveIncomeState {
  const { plan } = source;
  if (plan === null) return { kind: 'none' };

  const byLabel = new Map(source.scenarios.map((scenario) => [scenario.label, scenario]));
  const ordered = SCENARIO_ORDER.flatMap((label) => {
    const scenario = byLabel.get(label);
    return scenario ? [scenario] : [];
  });

  const scenarios: PassiveIncomeScenarioRow[] = ordered.map((scenario) => {
    const targetCents = scenario.result.targetPortfolioCents;
    return {
      label: scenario.label,
      name: scenarioName(scenario.label),
      targetCents,
      // `goalProgress` recusa alvo <= 0; sem alvo não há progresso a mostrar.
      progressBp:
        targetCents > 0
          ? goalProgress({ targetCents, currentCents: plan.currentPortfolioCents, targetDate: null, today }).progressBp
          : null,
      timeText: formatMonthsToTarget(scenario.result.monthsWithCurrentContribution).text,
    };
  });

  return {
    kind: 'ok',
    planName: plan.name,
    currentPortfolioCents: plan.currentPortfolioCents,
    desiredMonthlyIncomeCents: plan.desiredMonthlyIncomeCents,
    horizonYears: Math.max(0, ...source.horizonsYears),
    scenarios,
    moderateTargetCents: byLabel.get('moderate')?.result.targetPortfolioCents ?? null,
    curves: ordered.map((scenario) => ({ label: scenario.label, curve: scenario.curve })),
  };
}
