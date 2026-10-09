import { z } from 'zod';

/**
 * Schemas de fronteira do histórico de importações (T-111, FASE 3).
 *
 * - `importBatchHistoryItemSchema`: forma do item devolvido por
 *   `/api/import/history` e do `previousBatchSchema` que já vem no
 *   uploadResponse (reaproveitado na confirmação — RF-IMP-10).
 * - `importBatchesResponseSchema`: envelope da rota.
 * - `revertResponseSchema`: resposta do POST `/api/import/revert` — a tela
 *   não usa o corpo para nada além de detectar sucesso, mas Zod por fronteira
 *   é regra (CONVENTIONS §6).
 */

export const importBatchHistoryItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileHash: z.string(),
  status: z.enum(['pending', 'committed', 'reverted', 'failed']),
  rowsImported: z.number().int().nonnegative(),
  createdAt: z.string(),
  /**
   * Banco e competência do lote, devolvidos por `listImportBatches`. OBRIGATÓRIOS (só podem ser `null`:
   * lote de conta, ou sem banco detectado): se o servidor parar de mandá-los, a tela falha alto em vez de
   * cair em silêncio no nome do arquivo.
   */
  bankKey: z.string().nullable(),
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
});

export const importBatchesResponseSchema = z.object({
  batches: z.array(importBatchHistoryItemSchema),
});

export const revertResponseSchema = z.object({
  batchId: z.string().uuid(),
  transactionsDeleted: z.number().int().nonnegative(),
  installmentPlansDeleted: z.number().int().nonnegative(),
});

export type ImportBatchHistoryItem = z.infer<typeof importBatchHistoryItemSchema>;
export type ImportBatchesResponse = z.infer<typeof importBatchesResponseSchema>;
