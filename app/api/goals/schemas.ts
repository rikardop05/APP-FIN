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

export const goalIdSchema = z.string().uuid();

/**
 * `POST /api/goals` e `PUT /api/goals/[id]` (a mesma forma: o PUT substitui os campos).
 *
 * - Meta comum: `targetCents > 0`. Sem prazo, `targetDate` é `null` (e a tela mostra a
 *   ausência do aporte mensal, não zero).
 * - Reserva de emergência: o alvo é CALCULADO (`N × média essencial`), então o corpo não o
 *   traz (`null`); o servidor grava só um retrato.
 * - `currentCents` é ignorado pela leitura quando há `accountId` (vale o saldo da conta).
 * - `priority`: MENOR número = mais prioritária (default 100, como no schema).
 */
export const goalBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Dê um nome à meta.').max(80),
    targetCents: centsSchema.nullable(),
    targetDate: isoDateSchema.nullable(),
    currentCents: centsSchema,
    accountId: z.string().uuid().nullable(),
    priority: z.number().int().min(1).max(10_000),
    status: z.enum(['active', 'achieved', 'paused', 'cancelled']),
    isEmergencyFund: z.boolean(),
  })
  .superRefine((body, ctx) => {
    if (!body.isEmergencyFund && (body.targetCents === null || body.targetCents <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['targetCents'], message: 'Informe um valor-alvo maior que zero.' });
    }
    if (body.currentCents < 0) {
      ctx.addIssue({ code: 'custom', path: ['currentCents'], message: 'O valor atual não pode ser negativo.' });
    }
  });

export type GoalBody = z.infer<typeof goalBodySchema>;
