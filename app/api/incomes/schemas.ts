import { z } from 'zod';
import type { Cents } from '@/lib/money';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const competenceSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
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
 * Receita recorrente (RF-ORC-03 do SPEC §5.4, via CONTRACTS §8).
 *
 * `expectedCents` chega positivo (entrada). O schema do banco tem CHECK
 * `incomes_one_off_requires_competence` (DATA-MODEL §2), mas a regra do Zod
 * fica mais explícita para a mensagem de erro ficar em pt-BR.
 */
export const incomeBodySchema = z
  .object({
    description: z.string().trim().min(1).max(240),
    kind: z.enum(['salary', 'pro_labore', 'variable', 'rent', 'other']),
    expectedCents: centsSchema.refine((value) => value > 0, 'Valor deve ser positivo.'),
    memberId: z.string().uuid(),
    receiveDay: z
      .number()
      .int()
      .min(1)
      .max(31),
    frequency: frequencySchema,
    oneOffCompetence: competenceSchema.nullable(),
    startsOn: isoDateSchema.nullable(),
    endsOn: isoDateSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === 'one_off') {
      if (value.oneOffCompetence === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receita eventual exige uma competência fixa.',
          path: ['oneOffCompetence'],
        });
      }
      return;
    }
    // Fora de `one_off`, a competência fixa é ignorada pelo motor — recusar
    // evita "cadastrou mas nunca vai usar".
    if (value.oneOffCompetence !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Competência fixa só se aplica a receitas eventuais.',
        path: ['oneOffCompetence'],
      });
    }
    if (value.startsOn === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a data de início da receita.',
        path: ['startsOn'],
      });
      return;
    }
    if (value.endsOn !== null && value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data final não pode ser anterior à data inicial.',
        path: ['endsOn'],
      });
    }
  });

export type IncomeBody = z.infer<typeof incomeBodySchema>;
