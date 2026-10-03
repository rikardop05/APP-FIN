import { cents, formatBRL, parseBRL, type Cents } from '@/lib/money';

import { bpToPercentInput, percentInputToBp, SCENARIO_ORDER, type ScenarioLabel } from './display';
import type { InvestmentPlan, InvestmentScenario } from './schemas';

/** Tudo como a pessoa digita (texto); a conversão e a validação de borda ficam aqui. */
export type PlanFormValues = {
  name: string;
  desiredIncome: string;
  portfolio: string;
  contribution: string;
  inflation: string;
  tax: string;
  /** `YYYY-MM-DD` ou vazio. */
  targetDate: string;
  scenarios: Record<ScenarioLabel, { returnPct: string; withdrawalPct: string }>;
};

export type PlanRequestBody = {
  name: string;
  desiredMonthlyIncomeCents: Cents;
  currentPortfolioCents: Cents;
  currentMonthlyContributionCents: Cents;
  inflationBp: number;
  incomeTaxBp: number;
  targetDate: string | null;
};

export type PlanUpdateRequestBody = PlanRequestBody & {
  scenarios: { label: ScenarioLabel; realReturnBp: number; withdrawalBp: number }[];
};

export type FormErrors = Record<string, string>;

/** Premissas do DATA-MODEL (conservador 3/3, médio 5/4, otimista 7/5) para o formulário de criar. */
const DEFAULT_PERCENTS: Record<ScenarioLabel, { returnPct: string; withdrawalPct: string }> = {
  conservative: { returnPct: '3', withdrawalPct: '3' },
  moderate: { returnPct: '5', withdrawalPct: '4' },
  optimistic: { returnPct: '7', withdrawalPct: '5' },
};

export function emptyPlanValues(): PlanFormValues {
  return {
    name: 'Meu plano',
    desiredIncome: '',
    portfolio: formatBRL(cents(0)),
    contribution: formatBRL(cents(0)),
    inflation: '4,5',
    tax: '15',
    targetDate: '',
    scenarios: structuredClone(DEFAULT_PERCENTS),
  };
}

export function planToValues(
  plan: InvestmentPlan,
  scenarios: readonly Pick<InvestmentScenario, 'label' | 'realReturnBp' | 'withdrawalBp'>[],
): PlanFormValues {
  const values = emptyPlanValues();
  values.name = plan.name;
  values.desiredIncome = formatBRL(plan.desiredMonthlyIncomeCents);
  values.portfolio = formatBRL(plan.currentPortfolioCents);
  values.contribution = formatBRL(plan.currentMonthlyContributionCents);
  values.inflation = bpToPercentInput(plan.inflationBp);
  values.tax = bpToPercentInput(plan.incomeTaxBp);
  values.targetDate = plan.targetDate ?? '';
  for (const scenario of scenarios) {
    values.scenarios[scenario.label] = {
      returnPct: bpToPercentInput(scenario.realReturnBp),
      withdrawalPct: bpToPercentInput(scenario.withdrawalBp),
    };
  }
  return values;
}

/** Campo a campo (e cenário por rótulo): não depende da ordem das chaves. */
export function valuesEqual(a: PlanFormValues, b: PlanFormValues): boolean {
  const { scenarios: scenariosA, ...restA } = a;
  const { scenarios: scenariosB, ...restB } = b;
  const sameRest = (Object.keys(restA) as (keyof typeof restA)[]).every((key) => restA[key] === restB[key]);
  return (
    sameRest &&
    SCENARIO_ORDER.every(
      (label) =>
        scenariosA[label].returnPct === scenariosB[label].returnPct &&
        scenariosA[label].withdrawalPct === scenariosB[label].withdrawalPct,
    )
  );
}

type ParsedPlan = { ok: true; plan: PlanRequestBody; scenarios: PlanUpdateRequestBody['scenarios'] } | { ok: false; errors: FormErrors };

/**
 * Formulário -> corpo da API. Faixas iguais às de `app/api/investment/schemas.ts`:
 * dinheiro >= 0, inflação e imposto de 0 a 100 %, retorno real de -99,99 a 100 % ao ano,
 * retirada de 0,01 a 100 % ao ano. O que o motor ainda recusar volta como 400 da API.
 */
export function parsePlanForm(values: PlanFormValues): ParsedPlan {
  const errors: FormErrors = {};

  const name = values.name.trim();
  if (name === '') errors.name = 'Dê um nome ao plano.';

  const money = (key: string, text: string, message: string): Cents => {
    const parsed = parseBRL(text);
    if (parsed === null || parsed < 0) {
      errors[key] = message;
      return cents(0);
    }
    return parsed;
  };
  const desiredMonthlyIncomeCents = money('desiredIncome', values.desiredIncome, 'Informe a renda mensal desejada (zero ou mais).');
  const currentPortfolioCents = money('portfolio', values.portfolio, 'Informe o patrimônio atual (zero ou mais).');
  const currentMonthlyContributionCents = money('contribution', values.contribution, 'Informe o aporte mensal (zero ou mais).');

  const inflationBp = percentInputToBp(values.inflation, 0, 10_000);
  if (inflationBp === null) errors.inflation = 'Informe a inflação entre 0 e 100 %.';
  const incomeTaxBp = percentInputToBp(values.tax, 0, 10_000);
  if (incomeTaxBp === null) errors.tax = 'Informe o imposto entre 0 e 100 %.';

  if (values.targetDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(values.targetDate)) {
    errors.targetDate = 'Informe uma data válida.';
  }

  const scenarios: PlanUpdateRequestBody['scenarios'] = [];
  for (const label of SCENARIO_ORDER) {
    const row = values.scenarios[label];
    const realReturnBp = percentInputToBp(row.returnPct, -9_999, 10_000);
    const withdrawalBp = percentInputToBp(row.withdrawalPct, 1, 10_000);
    if (realReturnBp === null) errors[`${label}.return`] = 'Retorno real entre -99,99 % e 100 % ao ano.';
    if (withdrawalBp === null) errors[`${label}.withdrawal`] = 'Retirada entre 0,01 % e 100 % ao ano.';
    if (realReturnBp !== null && withdrawalBp !== null) scenarios.push({ label, realReturnBp, withdrawalBp });
  }

  if (Object.keys(errors).length > 0 || inflationBp === null || incomeTaxBp === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    plan: {
      name,
      desiredMonthlyIncomeCents,
      currentPortfolioCents,
      currentMonthlyContributionCents,
      inflationBp,
      incomeTaxBp,
      targetDate: values.targetDate === '' ? null : values.targetDate,
    },
    scenarios,
  };
}
