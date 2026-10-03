import { z } from 'zod';

import type { BasisPoints, Cents } from '@/lib/money';

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);
const bpSchema = z.custom<BasisPoints>(
  (value) => typeof value === 'number' && Number.isInteger(value),
  'Percentual inválido.',
);

const labelSchema = z.enum(['conservative', 'moderate', 'optimistic']);

const planSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  desiredMonthlyIncomeCents: centsSchema,
  currentPortfolioCents: centsSchema,
  currentMonthlyContributionCents: centsSchema,
  inflationBp: bpSchema,
  incomeTaxBp: bpSchema,
  targetDate: z.string().nullable(),
});

const scenarioSchema = z.object({
  label: labelSchema,
  realReturnBp: bpSchema,
  withdrawalBp: bpSchema,
  result: z.object({
    targetPortfolioCents: centsSchema,
    monthsWithCurrentContribution: z.number().int().nullable(),
    requiredByHorizon: z.array(z.object({ years: z.number().int(), contributionCents: centsSchema })),
    projectedIncomeWithCurrentPlanCents: centsSchema,
    feasible: z.boolean(),
  }),
  curve: z.array(
    z.object({
      month: z.number().int(),
      competenceOffset: z.number().int(),
      competence: z.string(),
      portfolioCents: centsSchema,
      passiveIncomeCents: centsSchema,
    }),
  ),
});

/** Espelho de `InvestmentResponse` (`app/api/investment/load.ts`). */
export const investmentResponseSchema = z.object({
  fromCompetence: z.string(),
  horizonsYears: z.array(z.number().int()),
  plan: planSchema.nullable(),
  scenarios: z.array(scenarioSchema),
});

export type InvestmentData = z.infer<typeof investmentResponseSchema>;
export type InvestmentPlan = z.infer<typeof planSchema>;
export type InvestmentScenario = z.infer<typeof scenarioSchema>;
