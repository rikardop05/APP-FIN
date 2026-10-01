import { z } from 'zod';
import type { Cents } from '@/lib/money';

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  nature: z.enum(['essential', 'non_essential', 'investment', 'income']),
});

const optionSchema = z.object({ id: z.string().uuid(), name: z.string() });

export const transactionSchema = z.object({
  id: z.string().uuid(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competence: z.string().regex(/^\d{4}-\d{2}$/),
  cashDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string(),
  rawDescription: z.string(),
  amountCents: centsSchema,
  kind: z.enum(['expense', 'income', 'transfer', 'credit_card_payment', 'investment_contribution']),
  status: z.enum(['posted', 'planned']),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  categoryNature: z.enum(['essential', 'non_essential', 'investment', 'income']).nullable(),
  accountId: z.string().uuid().nullable(),
  accountName: z.string().nullable(),
  creditCardId: z.string().uuid().nullable(),
  creditCardName: z.string().nullable(),
  memberId: z.string().uuid().nullable(),
  memberName: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  note: z.string().nullable(),
});

export const transactionResponseSchema = z.object({
  transactions: z.array(transactionSchema),
  options: z.object({
    categories: z.array(categorySchema),
    accounts: z.array(optionSchema),
    cards: z.array(optionSchema),
    members: z.array(optionSchema),
  }),
});

export const ruleSuggestionSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  categoryId: z.string().uuid().nullable(),
  memberId: z.string().uuid().nullable(),
  suggestion: z.object({ pattern: z.string(), matchType: z.literal('contains') }),
});

export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
export type TransactionOptions = TransactionResponse['options'];
export type RuleSuggestion = z.infer<typeof ruleSuggestionSchema>;

// ---------------------------------------------------------------------------
// Exclusão de lançamento: a resposta de `GET .../delete-impact` e do `DELETE`.
// Tudo que o diálogo diz vem do servidor; a tela só formata. `.parse` aqui faz uma
// rota que esqueça um campo falhar alto em vez de a tela ler `undefined`.
// ---------------------------------------------------------------------------

const deleteEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan_hole'), planDescription: z.string(), remaining: z.number().int() }),
  z.object({ kind: z.literal('plan_removed'), planDescription: z.string() }),
  z.object({
    kind: z.literal('statement_total'),
    cardName: z.string(),
    competence: z.string(),
    beforeCents: centsSchema,
    afterCents: centsSchema,
    reportedCents: centsSchema.nullable(),
  }),
  z.object({ kind: z.literal('statement_unpaid'), cardName: z.string(), competence: z.string() }),
  z.object({
    kind: z.literal('import_batch'),
    fileName: z.string(),
    before: z.number().int(),
    after: z.number().int(),
  }),
  z.object({ kind: z.literal('returns_on_reimport') }),
  z.object({ kind: z.literal('occurrence_skipped'), ruleDescription: z.string(), competence: z.string() }),
]);

const deletedCountsSchema = z.object({
  transactions: z.number().int().nonnegative(),
  futureInstallments: z.number().int().nonnegative(),
});

export const deleteImpactSchema = z.object({
  target: z.object({
    id: z.string().uuid(),
    description: z.string(),
    amountCents: centsSchema,
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['posted', 'planned']),
  }),
  deleted: deletedCountsSchema,
  effects: z.array(deleteEffectSchema),
});

export const deleteResultSchema = z.object({ id: z.string().uuid(), deleted: deletedCountsSchema });

export type DeleteImpact = z.infer<typeof deleteImpactSchema>;
export type DeleteEffect = DeleteImpact['effects'][number];
