import { getInvestmentPlan, type InvestmentPlanRow } from '@/lib/db/queries/investment';
import { toCompetence, type Competence } from '@/lib/date';
import { DEFAULT_HORIZONS_YEARS } from '@/lib/finance/investment';

import { computeScenarios, type ScenarioView } from './compute';

/**
 * Resposta de `GET /api/investment` (e de POST/PUT, que devolvem o estado novo).
 * `plan: null` = o household ainda não criou o plano; `scenarios` vem vazio.
 * Todo valor em R$ de hoje (taxas reais, RF-INV-01).
 */
export type InvestmentResponse = {
  /** Âncora da curva: a competência de hoje em São Paulo. */
  fromCompetence: Competence;
  horizonsYears: number[];
  plan: InvestmentPlanRow | null;
  /** conservative, moderate, optimistic. */
  scenarios: ScenarioView[];
};

/** Lê o plano e entrega tudo já calculado pelo motor. A tela não faz conta. */
export async function loadInvestmentResponse(
  householdId: string,
  today: string,
): Promise<InvestmentResponse> {
  const fromCompetence = toCompetence(today);
  const horizonsYears = [...DEFAULT_HORIZONS_YEARS];
  const stored = await getInvestmentPlan(householdId);
  if (stored === null) return { fromCompetence, horizonsYears, plan: null, scenarios: [] };
  return {
    fromCompetence,
    horizonsYears,
    plan: stored.plan,
    scenarios: computeScenarios(stored.plan, stored.scenarios, fromCompetence, horizonsYears),
  };
}
