import { z } from 'zod';
import type { Cents } from '@/lib/money';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
);

const installmentSchema = z
  .object({
    current: z.number().int().min(1).max(99),
    total: z.number().int().min(1).max(99),
  })
  .refine((value) => value.current <= value.total);

const confirmedRowSchema = z.object({
  index: z.number().int().min(0),
  include: z.boolean(),
  occurredOn: isoDateSchema,
  description: z.string().trim().min(1).max(240),
  rawDescription: z.string().max(500),
  amountCents: centsSchema,
  categoryId: z.string().uuid().nullable(),
  memberId: z.string().uuid().nullable(),
  installment: installmentSchema.nullable(),
  forceDuplicate: z.boolean().optional(),
});

const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');

export const recalculateBodySchema = z.object({
  sourceKind: z.enum(['credit_card', 'account']),
  sourceId: z.string().uuid(),
  cardCycle: z
    .object({
      closingDay: z.number().int().min(1).max(31),
      dueDay: z.number().int().min(1).max(31),
    })
    .nullable(),
  rows: z.array(confirmedRowSchema).max(2_000),
  /**
   * Competência declarada da fatura. Quando a origem é cartão, é obrigatória
   * — mesma regra que no commit. Em conta é ignorada.
   */
  statementCompetence: competenceSchema.nullable(),
});

export type RecalculateBody = z.infer<typeof recalculateBodySchema>;
