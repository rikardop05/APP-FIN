import { competenceLong } from '@/components/cashflow/labels';
import { bankLabel } from './review-model';

/**
 * Textos do histórico de importações. Fora do .tsx porque o vitest não transforma JSX.
 */

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
 * Título do lote: "Nubank · outubro de 2026" quando o histórico traz banco e competência; senão o nome
 * do arquivo, que sempre existe.
 */
export function batchTitle(batch: {
  fileName: string;
  bankKey?: string | null;
  competence?: string | null;
}): string {
  if (batch.competence) {
    const bank = batch.bankKey ? bankLabel(batch.bankKey) : null;
    return bank === null ? competenceLong(batch.competence) : `${bank} · ${competenceLong(batch.competence)}`;
  }
  return batch.fileName;
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
