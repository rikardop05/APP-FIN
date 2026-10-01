import { z } from 'zod';
import type { Cents } from '@/lib/money';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const nullableUuid = z.string().uuid().nullable();
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
 * Recorrência de despesa (RF-ORC-01 e RF-ORC-02 do SPEC §5.4, via CONTRACTS §8).
 *
 * - `expectedCents` NEGATIVO (saída) — DATA-MODEL §2, transactions. A tela inverte
 *   o sinal antes de enviar; o schema **rejeita** valor positivo em vez de
 *   normalizar silenciosamente. Rejeitar é honesto (o cliente mandou errado) e
 *   coerente com a borda de RECEITA (que também rejeita valor ≤ 0). Normalizar
 *   silenciosamente mascara um bug de sinal na própria tela — e o defeito
 *   aparece depois no `projectCashflow`, longe da causa. Lição do G-07 (parcela
 *   11/12 voltando para 2025-11 em silêncio): falta de info deve falhar alto,
 *   não cair em fallback. O CHECK no banco é da Estaca; até lá, esta é a
 *   única linha de defesa e ela precisa ser alta.
 * - `accountId` XOR `creditCardId`: exatamente um. Nenhum dos dois falha aqui,
 *   na fronteira — a previsão gravada vira linha de `transactions`, que tem o
 *   mesmo CHECK, e o erro apareceria dois passos depois, vazando constraint.
 * - `annualAdjustmentBp` em basis points (default zero = sem reajuste).
 */
export const recurringExpenseBodySchema = z
  .object({
    description: z.string().trim().min(1).max(240),
    expectedCents: centsSchema.refine(
      (value) => value < 0,
      'Despesa deve ser negativa — informe o valor como positivo e a tela inverte o sinal; valor já chegando positivo aqui é bug do chamador.',
    ),
    categoryId: z.string().uuid(),
    dueDay: z
      .number()
      .int()
      .min(1)
      .max(31),
    frequency: frequencySchema,
    accountId: nullableUuid,
    creditCardId: nullableUuid,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullable(),
    annualAdjustmentBp: z.number().int().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.accountId !== null && value.creditCardId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe uma conta OU um cartão, não os dois.',
        path: ['accountId'],
      });
    }
    if (value.accountId === null && value.creditCardId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a conta ou o cartão de onde a despesa sai.',
        path: ['accountId'],
      });
    }
    if (value.endsOn !== null && value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data final não pode ser anterior à data inicial.',
        path: ['endsOn'],
      });
    }
  });

export type RecurringExpenseBody = z.infer<typeof recurringExpenseBodySchema>;
