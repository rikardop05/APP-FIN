import { z } from 'zod';

export const statementIdSchema = z.string().uuid();

/** Corpo do POST /api/statements/[id]/status: marcar (`paid`) ou desmarcar (`open`). */
export const statementStatusBodySchema = z
  .object({ status: z.enum(['paid', 'open']) })
  .strict();

export type StatementStatusBody = z.infer<typeof statementStatusBodySchema>;
