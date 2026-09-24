import { z } from 'zod';

/**
 * Tipos e schemas da tela de configuracoes — T-114.
 *
 * Mesmos vocabularios das rotas de `app/api`, redigitados aqui para o cliente
 * nao depender de modulo de servidor. O que a tela le da API e validado antes
 * de entrar no estado (mesma disciplina do T-109).
 */

export const natureSchema = z.enum(['essential', 'non_essential', 'investment', 'income']);
export const matchTypeSchema = z.enum(['contains', 'regex', 'exact']);

export type Nature = z.infer<typeof natureSchema>;
export type MatchType = z.infer<typeof matchTypeSchema>;

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  nature: Nature;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  children: CategoryNode[];
};

const categoryNodeSchema: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
    nature: natureSchema,
    icon: z.string().nullable(),
    color: z.string().nullable(),
    sortOrder: z.number(),
    children: z.array(categoryNodeSchema),
  }),
);

export const categoriesResponseSchema = z.object({ categories: z.array(categoryNodeSchema) });

export const memberSchema = z.object({ id: z.string(), name: z.string() });
export type Member = z.infer<typeof memberSchema>;

export const ruleSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  matchType: matchTypeSchema,
  categoryId: z.string(),
  categoryName: z.string(),
  memberId: z.string().nullable(),
  memberName: z.string().nullable(),
  priority: z.number(),
  hits: z.number(),
  active: z.boolean(),
});
export type RuleRecord = z.infer<typeof ruleSchema>;

export const rulesResponseSchema = z.object({
  rules: z.array(ruleSchema),
  members: z.array(memberSchema),
});

/** Resposta dos endpoints que so devolvem a lista de regras (POST/PATCH/DELETE/order). */
export const rulesOnlyResponseSchema = z.object({ rules: z.array(ruleSchema) });

export const settingsSchema = z.object({
  emergencyFundMonths: z.number(),
  budgetWarnBp: z.number(),
  projectionMonths: z.number(),
  commitmentMonths: z.number(),
});
export type SettingsRecord = z.infer<typeof settingsSchema>;

export const settingsResponseSchema = z.object({ settings: settingsSchema });

/** Valores do formulario de categoria. `nature` so aparece na folha. */
export type CategoryFormValues = {
  name: string;
  nature: Nature | '';
  color: string;
  sortOrder: string;
};

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(80),
  nature: z.union([natureSchema, z.literal('')]),
  color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB.'), z.literal('')]),
  sortOrder: z.string().regex(/^\d{1,6}$/, 'Ordem deve ser um número.'),
});

/** Valores do formulario de regra. */
export type RuleFormValues = {
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  memberId: string;
  active: boolean;
};

export const ruleFormSchema = z
  .object({
    pattern: z.string().trim().min(1, 'Informe o padrão.').max(120),
    matchType: matchTypeSchema,
    categoryId: z.string().uuid('Escolha a categoria.'),
    memberId: z.string(),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.matchType !== 'regex') return;
    try {
      new RegExp(value.pattern);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'Expressão regular inválida.',
      });
      return;
    }
    if (hasCatastrophicBacktracking(value.pattern)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'Padrão com risco de travamento. Simplifique os quantificadores.',
      });
    }
  });

/**
 * Barreira estrutural contra backtracking catastrofico (ReDoS), best-effort —
 * mesma logica da fronteira da API, redigitada para o cliente nao importar
 * modulo de servidor. Ver `app/api/rules/schemas.ts`.
 */
const NESTED_QUANTIFIER = /\([^)]*[*+][^)]*\)\s*(?:[*+]|\{\d*,?\d*\})/;
const QUANTIFIED_ALTERNATION = /\([^)]*\|[^)]*\)\s*(?:[*+]|\{\d*,?\d*\})/;

function hasCatastrophicBacktracking(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern) || QUANTIFIED_ALTERNATION.test(pattern);
}

/** Valores do formulario de premissas globais. */
export type SettingsFormValues = {
  emergencyFundMonths: string;
  budgetWarnPercent: string;
  projectionMonths: string;
  commitmentMonths: string;
};

export const settingsFormSchema = z.object({
  emergencyFundMonths: z.string().regex(/^\d{1,2}$/, 'Meses inválidos.'),
  budgetWarnPercent: z.string().regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Percentual inválido.'),
  projectionMonths: z.string().regex(/^\d{1,2}$/, 'Meses inválidos.'),
  commitmentMonths: z.string().regex(/^\d{1,2}$/, 'Meses inválidos.'),
});
