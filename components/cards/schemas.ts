import { z } from 'zod';
import { parseBRL, type Cents } from '@/lib/money';
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

const moneyInputSchema = z
  .string()
  .trim()
  .refine((value) => parseBRL(value) !== null, 'Informe um valor válido.');

const optionalMoneyInputSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (value.length === 0) return true;
      const cents = parseBRL(value);
      return cents !== null && cents >= 0;
    },
    'Informe um valor válido.',
  );

const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);

export const accountFormSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da conta.').max(80),
  bank: z.string().trim().max(80),
  kind: z.enum(['checking', 'savings', 'cash', 'brokerage']),
  openingBalance: moneyInputSchema,
  openingDate: isoDateSchema,
});

export const cardFormSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cartão.').max(80),
  bank: z.string().trim().max(80),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'other']),
  holderMemberId: z.string().uuid().nullable(),
  paymentAccountId: z.string().uuid().nullable(),
  creditLimit: optionalMoneyInputSchema,
  closingDay: z
    .string()
    .regex(/^\d+$/, 'Use um dia entre 1 e 31.')
    .transform(Number)
    .pipe(z.number().int().min(1, 'Use um dia entre 1 e 31.').max(31, 'Use um dia entre 1 e 31.')),
  dueDay: z
    .string()
    .regex(/^\d+$/, 'Use um dia entre 1 e 31.')
    .transform(Number)
    .pipe(z.number().int().min(1, 'Use um dia entre 1 e 31.').max(31, 'Use um dia entre 1 e 31.')),
});

export type AccountFormValues = z.input<typeof accountFormSchema>;
export type AccountFormData = z.output<typeof accountFormSchema>;
export type CardFormValues = z.input<typeof cardFormSchema>;
export type CardFormData = z.output<typeof cardFormSchema>;

export const accountListSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      bank: z.string().nullable(),
      kind: z.enum(['checking', 'savings', 'cash', 'brokerage']),
      openingBalanceCents: centsSchema,
      openingDate: isoDateSchema,
      active: z.boolean(),
    }),
  ),
});

export const cardListSchema = z.object({
  cards: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      bank: z.string().nullable(),
      brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'other']),
      holderMemberId: z.string().uuid().nullable(),
      paymentAccountId: z.string().uuid().nullable(),
      creditLimitCents: centsSchema.nullable(),
      closingDay: z.number().int(),
      dueDay: z.number().int(),
      active: z.boolean(),
      statements: z.array(
        z.object({
          id: z.string().uuid(),
          period: z.string().regex(/^\d{4}-\d{2}$/),
          closingDate: isoDateSchema,
          dueDate: isoDateSchema,
          reportedTotalCents: centsSchema.nullable(),
          computedTotalCents: centsSchema,
          differenceCents: centsSchema.nullable(),
          status: z.enum(['open', 'closed', 'paid']),
          source: z.enum(['import', 'manual', 'generated']),
        }),
      ),
    }),
  ),
  members: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});

export type AccountList = z.infer<typeof accountListSchema>;
export type CardList = z.infer<typeof cardListSchema>;
export type AccountRecord = AccountList['accounts'][number];
export type CardRecord = CardList['cards'][number];
export type StatementRecord = CardRecord['statements'][number];
