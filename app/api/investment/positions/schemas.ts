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

/**
 * Corpo de `POST /api/investment/positions` e `PUT /api/investment/positions/[id]`.
 * Data no futuro é recusada em `body.ts` (precisa do "hoje", que só a rota lê).
 */
export const snapshotBodySchema = z.object({
  asOf: isoDateSchema,
  portfolioCents: z.custom<Cents>(
    (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    'Informe o total investido (zero ou mais).',
  ),
  note: z
    .string()
    .trim()
    .max(280, 'A observação tem no máximo 280 caracteres.')
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value)),
});

export const snapshotIdSchema = z.string().uuid();

export type SnapshotBody = z.infer<typeof snapshotBodySchema>;
