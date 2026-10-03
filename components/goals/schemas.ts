import { z } from 'zod';

import type { Cents } from '@/lib/money';

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

const progressSchema = z.object({
  progressBp: z.number().int(),
  remainingCents: centsSchema,
  monthsRemaining: z.number().int().nullable(),
  requiredMonthlyCents: centsSchema.nullable(),
  onTrack: z.boolean().nullable(),
});

export const goalViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['active', 'achieved', 'paused', 'cancelled']),
  priority: z.number().int(),
  isEmergencyFund: z.boolean(),
  targetDate: z.string().nullable(),
  accountId: z.string().uuid().nullable(),
  accountName: z.string().nullable(),
  currentCents: centsSchema,
  targetCents: centsSchema.nullable(),
  progress: progressSchema.nullable(),
});

export const goalsResponseSchema = z.object({
  goals: z.array(goalViewSchema),
  accounts: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  emergency: z.object({
    months: z.number().int(),
    averageCents: centsSchema.nullable(),
    monthsWithData: z.number().int(),
    windowFrom: z.string(),
    windowTo: z.string(),
    targetCents: centsSchema.nullable(),
    exists: z.boolean(),
  }),
});

export type GoalsResponse = z.infer<typeof goalsResponseSchema>;
export type GoalView = GoalsResponse['goals'][number];
export type GoalAccountOption = GoalsResponse['accounts'][number];
