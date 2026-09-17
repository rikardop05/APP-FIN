import { z } from 'zod';
import type { Cents } from '@/lib/money';
import { formatDateBR } from '@/lib/date';

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

export const accountBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  bank: z.string().trim().max(80).nullable().optional().default(null),
  kind: z.enum(['checking', 'savings', 'cash', 'brokerage']),
  openingBalanceCents: centsSchema,
  openingDate: isoDateSchema,
});

export const accountIdSchema = z.string().uuid();

export type AccountBody = z.infer<typeof accountBodySchema>;
