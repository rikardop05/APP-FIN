import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { importBatches } from '@/lib/db/schema';

/**
 * Item da listagem de histórico de importações para a tela /importar (T-111,
 * FASE 3). Diferente de `ImportBatchHistoryItem` em `lib/db/queries/import.ts`,
 * que é privado e filtrado por `fileHash` para o aviso RF-IMP-10 do upload:
 * aqui NÃO filtramos por hash — a tela lista TODOS os lotes do household,
 * porque o histórico com desfazer precisa enxergar qualquer lote, não só o do
 * mesmo arquivo que está sendo importado agora.
 *
 * Acrescenta `rowsImported` (persistido na própria linha de import_batches)
 * para o texto da confirmação explícita do desfazer — a confirmação diz
 * "Desfazer importação de 12/09 com 47 lançamentos?" e o número sai daqui.
 *
 * Mantido em arquivo separado de `import.ts` por instrução do Orquestrador
 * (T-111 FASE 3): nada naquele arquivo pode ser tocado. Não há reuso do
 * código privado de `listPreviousBatches` porque o filtro de hash é exatamente
 * o que NÃO queremos aqui — o SELECT é diferente de propósito.
 */
export type ImportBatchHistoryListItem = {
  id: string;
  fileName: string;
  fileHash: string;
  status: 'pending' | 'committed' | 'reverted' | 'failed';
  rowsImported: number;
  createdAt: string;
};

export async function listImportBatches(
  householdId: string,
): Promise<ImportBatchHistoryListItem[]> {
  const rows = await db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      fileHash: importBatches.fileHash,
      status: importBatches.status,
      rowsImported: importBatches.rowsImported,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(eq(importBatches.householdId, householdId))
    .orderBy(desc(importBatches.createdAt));
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    fileHash: row.fileHash,
    status: row.status,
    rowsImported: row.rowsImported,
    createdAt: row.createdAt.toISOString(),
  }));
}
