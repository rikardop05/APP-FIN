import { competenceLong } from '@/components/cashflow/labels';
import { formatDateBR } from '@/lib/date';
import { bankLabel } from './review-model';

/**
 * Textos do histórico de importações. Fora do .tsx porque o vitest não transforma JSX.
 */

/** Dia (AAAA-MM-DD) de um instante `timestamptz` no fuso de São Paulo: 22h de 12/09 lá é 13/09 em UTC. */
export function saoPauloDay(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

export type BatchStatus = 'pending' | 'committed' | 'reverted' | 'failed';

export function rowCountLabel(rowsImported: number): string {
  if (rowsImported === 1) return '1 lançamento';
  return `${rowsImported} lançamentos`;
}

/** Resultado do desfazer. As telas já se atualizam (`router.refresh`): nada de "recarregue". */
export function revertedMessage(transactionsDeleted: number): string {
  return `Lote desfeito: ${rowCountLabel(transactionsDeleted)} ${transactionsDeleted === 1 ? 'removido' : 'removidos'}. Os números das outras telas já estão atualizados.`;
}

/** Estado do lote, no masculino (é o lote que foi confirmado, desfeito...). */
export function batchStatusLabel(status: BatchStatus): string {
  if (status === 'committed') return 'Confirmado';
  if (status === 'reverted') return 'Desfeito';
  if (status === 'pending') return 'Pendente';
  return 'Falhou';
}

/**
 * Título do lote: "Nubank · outubro de 2026" quando o histórico traz banco e competência; sem competência
 * (lote desfeito perde a fatura) mas com banco e data, "Nubank · importação de 12/09/2026"; senão o nome
 * do arquivo, que sempre existe.
 */
export function batchTitle(batch: {
  fileName: string;
  bankKey?: string | null;
  competence?: string | null;
  createdAt?: string | null;
}): string {
  const bank = batch.bankKey ? bankLabel(batch.bankKey) : null;
  if (batch.competence) {
    return bank === null ? competenceLong(batch.competence) : `${bank} · ${competenceLong(batch.competence)}`;
  }
  if (bank !== null && batch.createdAt) {
    return `${bank} · importação de ${formatDateBR(saoPauloDay(batch.createdAt))}`;
  }
  return batch.fileName;
}

/** Lote desfeito que não guarda mais nada: só atrapalha a lista principal. */
export function isEmptyReverted(batch: { status: BatchStatus; rowsImported: number }): boolean {
  return batch.status === 'reverted' && batch.rowsImported === 0;
}

/** Separa a lista principal dos lotes "Desfeito, sem lançamentos", mantendo a ordem. */
export function splitBatches<T extends { status: BatchStatus; rowsImported: number }>(
  batches: readonly T[],
): { main: T[]; hidden: T[] } {
  const main: T[] = [];
  const hidden: T[] = [];
  for (const batch of batches) (isEmptyReverted(batch) ? hidden : main).push(batch);
  return { main, hidden };
}

export function hiddenBatchesLabel(count: number): string {
  return count === 1 ? 'Ver 1 importação desfeita' : `Ver ${count} importações desfeitas`;
}

/**
 * O que o lote guarda hoje. Lote desfeito NÃO tem mais lançamentos: dizer "47 lançamentos" ao lado de
 * "Desfeito" induzia a achar que ainda estão lá.
 */
export function batchRowsText(status: BatchStatus, rowsImported: number): string {
  if (status === 'reverted') {
    return rowsImported === 0
      ? 'Desfeito, sem lançamentos'
      : `Desfeito: ${rowCountLabel(rowsImported)} ${rowsImported === 1 ? 'removido' : 'removidos'}`;
  }
  if (status === 'pending') return 'Aguardando confirmação, nada gravado';
  if (status === 'failed') return 'Não gravou lançamentos';
  return rowCountLabel(rowsImported);
}
