import { z } from 'zod';
import type { Cents } from '@/lib/money';

const centsSchema = z
  .custom<Cents>(
    (value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    'Valor monetário inválido.',
  )
  .nullable();

export const cardBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  bank: z.string().trim().max(80).nullable().optional().default(null),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'other']),
  holderMemberId: z.string().uuid().nullable().optional().default(null),
  paymentAccountId: z.string().uuid().nullable().optional().default(null),
  creditLimitCents: centsSchema,
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
});

export const cardIdSchema = z.string().uuid();

/** Corpo do PUT /api/cards/[id]/holders: upsert por (cartao, final). Decisao 20. */
export const cardHolderBodySchema = z
  .object({
    last4: z.string().trim().regex(/^[0-9]{4}$/),
    memberId: z.string().uuid(),
  })
  .strict();

export const cardHolderIdSchema = z.string().uuid();

export type CardBody = z.infer<typeof cardBodySchema>;
