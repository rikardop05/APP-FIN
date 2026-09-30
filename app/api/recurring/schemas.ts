import { z } from 'zod';
import type { Cents } from '@/lib/money';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const nullableUuid = z.string().uuid().nullable();
const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

const frequencySchema = z.enum([
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
  'one_off',
]);

/**
 * Recorrência de despesa (RF-ORC-01 e RF-ORC-02 do SPEC §5.4, via CONTRACTS §8).
 *
 * - `expectedCents` chega negativo (saída) — a tela inverte o sinal para o usuário,
 *   o schema normaliza para a convenção do banco.
 * - `accountId` XOR `creditCardId`: nunca os dois.
 * - `annualAdjustmentBp` em basis points (default zero = sem reajuste).
 */
export const recurringExpenseBodySchema = z
  .object({
    description: z.string().trim().min(1).max(240),
    expectedCents: centsSchema.refine((value) => value !== 0, 'Valor não pode ser zero.'),
    categoryId: z.string().uuid(),
    dueDay: z
      .number()
      .int()
      .min(1)
      .max(31),
    frequency: frequencySchema,
    accountId: nullableUuid,
    creditCardId: nullableUuid,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullable(),
    annualAdjustmentBp: z.number().int().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.accountId !== null && value.creditCardId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe uma conta OU um cartão, não os dois.',
        path: ['accountId'],
      });
    }
    if (value.endsOn !== null && value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data final não pode ser anterior à data inicial.',
        path: ['endsOn'],
      });
    }
  });

export type RecurringExpenseBody = z.infer<typeof recurringExpenseBodySchema>;
