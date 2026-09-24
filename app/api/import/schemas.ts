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

const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida.');
const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
  'Valor monetário inválido.',
);
const nullableUuid = z.string().uuid().nullable();

const sourceSchema = {
  sourceKind: z.enum(['credit_card', 'account']),
  sourceId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(240),
  today: isoDateSchema,
};

export const uploadBodySchema = z.discriminatedUnion('inputType', [
  z.object({
    ...sourceSchema,
    inputType: z.literal('text'),
    content: z.string().min(1).max(2_000_000),
    defaultCompetence: competenceSchema.optional(),
  }),
  z.object({
    ...sourceSchema,
    inputType: z.literal('pdf'),
    contentBase64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'PDF inválido.'),
    password: z.string().max(200).optional(),
    defaultCompetence: competenceSchema.optional(),
  }),
]);

const installmentSchema = z
  .object({
    current: z.number().int().min(1).max(99),
    total: z.number().int().min(1).max(99),
  })
  .refine((value) => value.current <= value.total, 'Parcela inválida.');

const confirmedRowSchema = z.object({
  index: z.number().int().min(0),
  include: z.boolean(),
  occurredOn: isoDateSchema,
  description: z.string().trim().min(1).max(240),
  rawDescription: z.string().max(500),
  amountCents: centsSchema,
  categoryId: nullableUuid,
  memberId: nullableUuid,
  installment: installmentSchema.nullable(),
  forceDuplicate: z.boolean().optional(),
});

export const commitBodySchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/, 'Hash do arquivo inválido.'),
  bankKey: z.string().trim().min(1).max(40).nullable(),
  format: z.enum(['pdf', 'text']),
  sourceKind: z.enum(['credit_card', 'account']),
  sourceId: z.string().uuid(),
  confirmedRows: z.array(confirmedRowSchema).max(2_000),
  reportedTotalCents: centsSchema.nullable(),
  allowReimport: z.boolean().default(false),
});

export const revertBodySchema = z.object({
  batchId: z.string().uuid(),
});

export type UploadBody = z.infer<typeof uploadBodySchema>;
export type CommitBody = z.infer<typeof commitBodySchema>;
export type RevertBody = z.infer<typeof revertBodySchema>;
