import { z } from 'zod';

const matchTypeSchema = z.enum(['contains', 'regex', 'exact']);

/**
 * Barreira estrutural contra backtracking catastrofico (ReDoS), best-effort:
 * quantificador aninhado (`(a+)+`, `(a*)*`) e alternancia quantificada
 * (`(a|aa)+`). Nao e prova de seguranca — e a barreira proporcional para um app
 * familiar, sem dependencia nova. O padrao e limitado a 120 caracteres, e o
 * motor ignora regex que nao compila.
 */
const NESTED_QUANTIFIER = /\([^)]*[*+][^)]*\)\s*(?:[*+]|\{\d*,?\d*\})/;
const QUANTIFIED_ALTERNATION = /\([^)]*\|[^)]*\)\s*(?:[*+]|\{\d*,?\d*\})/;

export function hasCatastrophicBacktracking(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern) || QUANTIFIED_ALTERNATION.test(pattern);
}

/**
 * Fronteira de validacao de regra (CONVENTIONS §6).
 *
 * Regex invalida e recusada aqui: o motor (`lib/finance/categorization.ts`)
 * ignora regex que nao compila, o que faria a regra parecer salva e nunca
 * casar. Barrar na borda da ao usuario a mensagem certa.
 */
export const ruleBodySchema = z
  .object({
    pattern: z.string().trim().min(1, 'Informe o padrão.').max(120),
    matchType: matchTypeSchema,
    categoryId: z.string().uuid(),
    memberId: z.string().uuid().nullable().optional().default(null),
    active: z.boolean().optional().default(true),
    /** `null` no create = entra no fim da ordem. */
    priority: z.number().int().min(0).max(100000).nullable().optional().default(null),
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

export const ruleOrderSchema = z.object({
  ids: z.array(z.string().uuid()).max(500),
});

export const ruleIdSchema = z.string().uuid();

export type RuleBody = z.infer<typeof ruleBodySchema>;
export type RuleOrder = z.infer<typeof ruleOrderSchema>;
