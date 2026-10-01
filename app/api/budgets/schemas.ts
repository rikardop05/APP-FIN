import { z } from 'zod';

import type { Cents } from '@/lib/money';

/** Competência `YYYY-MM`. O orçamento é por competência (`budgets.period`). */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

/** `GET /api/budgets?period=YYYY-MM`. */
export const budgetsQuerySchema = z.object({ period: periodSchema });

/**
 * `GET /api/budgets/suggestion?period=YYYY-MM&mode=previous|avg3`.
 *
 * É leitura pura: o botão da tela só PREENCHE o formulário. Nenhum caminho de
 * rota grava o sugerido; quem grava é a pessoa, ao confirmar (`PUT /api/budgets`).
 */
export const suggestionQuerySchema = z.object({
  period: periodSchema,
  mode: z.enum(['previous', 'avg3']),
});

/**
 * `PUT /api/budgets`: o CONJUNTO do mês. O que não vem é apagado, para uma
 * categoria removida na tela sumir do banco (senão o orçamento fantasma continua
 * pintando semáforo sem ninguém ver).
 *
 * `plannedCents = 0` é válido: "não quero gastar nada" é informação, não
 * ausência. Negativo é recusado aqui e no motor (inverteria a cor do semáforo).
 */
export const saveBudgetsBodySchema = z
  .object({
    period: periodSchema,
    items: z
      .array(
        z.object({
          categoryId: z.string().uuid(),
          plannedCents: centsSchema.refine(
            (value) => value >= 0,
            'O orçamento não pode ser negativo.',
          ),
        }),
      )
      .max(200, 'Orçamento com itens demais.'),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.categoryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Há categorias repetidas no orçamento.',
          path: ['items', index, 'categoryId'],
        });
      }
      seen.add(item.categoryId);
    }
  });

export type SaveBudgetsBody = z.infer<typeof saveBudgetsBodySchema>;
