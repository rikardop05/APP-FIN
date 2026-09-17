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
