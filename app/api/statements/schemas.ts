import { z } from 'zod';

export const statementIdSchema = z.string().uuid();

/**
 * Corpo do POST /api/statements/[id]/status: marcar (`paid`, integral ou com `paidAmountCents`)
 * ou desmarcar (`open`, que limpa o valor). Valor: inteiro de centavos, positivo.
 */
export const statementStatusBodySchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('paid'),
      paidAmountCents: z.number().int().positive().safe().optional(),
    })
    .strict(),
  z.object({ status: z.literal('open') }).strict(),
]);

export type StatementStatusBody = z.infer<typeof statementStatusBodySchema>;
