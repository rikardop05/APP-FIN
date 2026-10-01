import { z } from 'zod';

import type { BasisPoints, Cents } from '@/lib/money';

/**
 * Respostas de `/api/budgets` como a TELA as lê. A tela faz `.parse` nelas: se a
 * rota esquecer um campo, o `.parse` lança em vez de a tela ler `undefined`. É a
 * outra ponta do contrato que `app/api/budgets/body-shape.test.ts` compara.
 */

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
);

const basisPointsSchema = z.custom<BasisPoints>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
);

const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const rowSchema = z.object({
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  rootName: z.string(),
  plannedCents: centsSchema,
  spentCents: centsSchema,
  /** Negativo quando gastou além do orçado. */
  remainingCents: centsSchema,
  /** `null` só com orçamento zero. */
  usageBp: basisPointsSchema.nullable(),
  light: z.enum(['green', 'yellow', 'red']),
  /** Previsto a realizar (`planned`): fora do semáforo, soma ao realizado no painel. */
  upcomingCents: centsSchema,
});

const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rootId: z.string().uuid(),
  rootName: z.string(),
  nature: z.enum(['essential', 'non_essential', 'investment', 'income']),
});

export const budgetMonthResponseSchema = z.object({
  period: competenceSchema,
  warnBp: basisPointsSchema,
  rows: z.array(rowSchema),
  /** Todas as folhas orçáveis, com ou sem orçamento: a tela monta o formulário com elas. */
  categories: z.array(categorySchema),
});

export const suggestionResponseSchema = z.object({
  period: competenceSchema,
  mode: z.enum(['previous', 'avg3']),
  suggestions: z.array(z.object({ categoryId: z.string().uuid(), suggestedCents: centsSchema })),
});

export const apiErrorSchema = z.object({ error: z.string() });

export type BudgetMonthResponse = z.infer<typeof budgetMonthResponseSchema>;
export type BudgetRowView = BudgetMonthResponse['rows'][number];
export type BudgetCategoryView = BudgetMonthResponse['categories'][number];
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;
