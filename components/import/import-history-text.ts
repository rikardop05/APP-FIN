/**
 * Textos do histórico de importações. Fora do .tsx porque o vitest não transforma JSX.
 */

export function rowCountLabel(rowsImported: number): string {
  if (rowsImported === 1) return '1 lançamento';
  return `${rowsImported} lançamentos`;
}

/** Resultado do desfazer. As telas já se atualizam (`router.refresh`): nada de "recarregue". */
export function revertedMessage(transactionsDeleted: number): string {
  return `Lote desfeito: ${rowCountLabel(transactionsDeleted)} ${transactionsDeleted === 1 ? 'removido' : 'removidos'}. Os números das outras telas já estão atualizados.`;
}
