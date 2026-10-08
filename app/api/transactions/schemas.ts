import { z } from 'zod';
import { formatDateBR } from '@/lib/date';
import type { Cents } from '@/lib/money';
import { APPLY_RULES_LIMIT } from '@/lib/db/queries/apply-rules-limit';

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
    /**
     * Decisão 16a: a previsão que a pessoa CONFIRMOU que este lançamento cumpre. Ausente =
     * `null` = grava normal; o servidor nunca concilia sozinho.
     */
    reconcilePlannedId: z.string().uuid().nullable().optional().default(null),
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

/** Resposta de `POST /api/transactions/reconcile-suggestion`: a previsão a perguntar, ou null. */
export const reconcileSuggestionResponseSchema = z.object({
  suggestion: z
    .object({
      plannedId: z.string().uuid(),
      description: z.string(),
      occurredOn: isoDateSchema,
      amountCents: centsSchema,
    })
    .nullable(),
});

export type TransactionFiltersInput = z.infer<typeof transactionFiltersSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;
export type ManualTransactionBody = z.infer<typeof manualTransactionBodySchema>;
/**
 * Confirmar um grupo da revisao (F4). O grupo pode passar das 100 linhas do
 * lote manual (uma compra parcelada em 12x de varios meses), entao o teto e o
 * mesmo da aplicacao de regras. `newRulePattern` null = so categorizar.
 */
export const reviewGroupConfirmationSchema = z.object({
  transactionIds: z
    .array(transactionIdSchema)
    .min(1)
    .max(APPLY_RULES_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, 'Lançamento repetido no grupo.'),
  categoryId: z.string().uuid(),
  newRulePattern: z.string().trim().min(1, 'Informe o padrão da regra.').max(120).nullable(),
});

export type BatchCategorizationInput = z.infer<typeof batchCategorizationSchema>;
export type ReviewGroupConfirmationInput = z.infer<typeof reviewGroupConfirmationSchema>;
export type RuleBody = z.infer<typeof ruleBodySchema>;

/**
 * Escopo da exclusão. `only` (padrão, o menos destrutivo) apaga só a linha;
 * `with-future` apaga também as parcelas FUTURAS `planned` do mesmo plano e só
 * vale numa parcela (o servidor recusa nas outras).
 */
export const deleteScopeSchema = z.enum(['only', 'with-future']);
