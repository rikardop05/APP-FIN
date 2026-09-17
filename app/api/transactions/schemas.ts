import { z } from 'zod';
import { formatDateBR } from '@/lib/date';
import type { Cents } from '@/lib/money';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data válida.')
  .refine((value) => {
    try {
      formatDateBR(value);
      return true;
    } catch {
      return false;
    }
  }, 'Informe uma data válida.');

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

const nullableUuid = z.string().uuid().nullable().optional().default(null);
const optionalNullableUuid = z.string().uuid().nullable().optional();

export const transactionIdSchema = z.string().uuid();

export const transactionFiltersSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  categoryId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  creditCardId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  uncategorized: z.boolean().default(false),
});

export const transactionUpdateSchema = z
  .object({
    occurredOn: isoDateSchema.optional(),
    description: z.string().trim().min(1).max(240).optional(),
    amountCents: centsSchema.optional(),
    categoryId: optionalNullableUuid,
    memberId: optionalNullableUuid,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo.');

export const manualTransactionBodySchema = z
  .object({
    occurredOn: isoDateSchema,
    description: z.string().trim().min(1).max(240),
    amountCents: centsSchema,
    kind: z.enum(['expense', 'income', 'transfer', 'credit_card_payment', 'investment_contribution']),
    categoryId: nullableUuid,
    accountId: nullableUuid,
    creditCardId: nullableUuid,
    memberId: nullableUuid,
    note: z.string().trim().max(500).nullable().optional().default(null),
  })
  .superRefine((value, context) => {
    if ((value.accountId === null) === (value.creditCardId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountId'],
        message: 'Selecione uma conta ou um cartão.',
      });
    }
  });

export const batchCategorizationSchema = z
  .object({
    transactionIds: z.array(transactionIdSchema).min(1).max(100),
    categoryId: z.string().uuid(),
    memberId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, context) => {
    if (new Set(value.transactionIds).size !== value.transactionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transactionIds'],
        message: 'Não repita lançamentos na seleção.',
      });
    }
  });

export const ruleBodySchema = z.object({
  pattern: z.string().trim().min(1).max(120),
  matchType: z.enum(['contains', 'regex', 'exact']).default('contains'),
  categoryId: z.string().uuid(),
  memberId: z.string().uuid().nullable().default(null),
  priority: z.number().int().min(0).max(100_000).default(100),
});

export type TransactionFiltersInput = z.infer<typeof transactionFiltersSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;
export type ManualTransactionBody = z.infer<typeof manualTransactionBodySchema>;
export type BatchCategorizationInput = z.infer<typeof batchCategorizationSchema>;
export type RuleBody = z.infer<typeof ruleBodySchema>;
