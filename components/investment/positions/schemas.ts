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

export const snapshotSchema = z.object({
  id: z.string().uuid(),
  asOf: z.string(),
  portfolioCents: centsSchema,
  note: z.string().nullable(),
});

const adherenceMonthSchema = z.object({
  competence: z.string(),
  actualCents: centsSchema,
  plannedCents: centsSchema,
  adherenceBp: bpSchema.nullable(),
  belowPlan: z.boolean(),
  inProgress: z.boolean(),
});

const comparisonSchema = z.object({
  asOf: z.string(),
  competence: z.string(),
  portfolioCents: centsSchema,
  status: z.enum(['compared', 'before_plan', 'beyond_curve']),
  byScenario: z.array(
    z.object({
      label: labelSchema,
      projectedCents: centsSchema.nullable(),
      diffCents: centsSchema.nullable(),
      diffBp: bpSchema.nullable(),
    }),
  ),
});

/** Espelho de `PositionsResponse` (`app/api/investment/positions/load.ts`), mais o `saved` do POST. */
export const positionsResponseSchema = z.object({
  currentCompetence: z.string(),
  plan: z
    .object({
      plannedMonthlyCents: centsSchema,
      currentPortfolioCents: centsSchema,
      startCompetence: z.string(),
    })
    .nullable(),
  snapshots: z.array(snapshotSchema),
  contributions: z.array(z.object({ competence: z.string(), actualCents: centsSchema })),
  adherence: z
    .object({
      months: z.array(adherenceMonthSchema),
      summary: z.object({
        closedMonths: z.number().int(),
        averageAdherenceBp: bpSchema.nullable(),
        monthsBelowPlan: z.number().int(),
      }),
    })
    .nullable(),
  comparison: z.array(comparisonSchema).nullable(),
  saved: z.object({ id: z.string().uuid(), replaced: z.boolean() }).optional(),
});

export type PositionsData = z.infer<typeof positionsResponseSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ComparisonEntry = NonNullable<PositionsData['comparison']>[number];
export type AdherenceMonth = NonNullable<PositionsData['adherence']>['months'][number];
