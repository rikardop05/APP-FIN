/**
 * Quantas linhas o lote importou (`import_batches.rows_imported`): as CONFIRMADAS menos TODO o que
 * o `finalizeImport` deixou em `skipped`: as desmarcadas pelo usuário (`excluded_by_user`), as
 * duplicatas (`duplicate`) e as informativas de valor zero (`informational`, decisão 8). Contar só as
 * duplicatas inflava o número com linhas que nunca viraram lançamento.
 *
 * Não conta as parcelas futuras geradas: são previsão, não linha lida do arquivo.
 */
export function importedRowsCount(confirmedRowsCount: number, skipped: readonly { reason: string }[]): number {
  return confirmedRowsCount - skipped.length;
}
