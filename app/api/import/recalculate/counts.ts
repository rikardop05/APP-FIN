import type { FinalizeResult } from '@/lib/import/pipeline';

/**
 * As duas contagens do rodapé da importação, sem somar nem subtrair nada na tela.
 *
 * `finalizeImport` devolve numa lista só as linhas que o usuário marcou e as
 * parcelas futuras que o motor projetou. O total em centavos cobre só as
 * marcadas; a lista cobre as duas. Por isso o rodapé precisa dos dois números.
 *
 * As marcadas são as linhas recebidas menos as que o motor pulou (desmarcada ou
 * duplicata). As futuras são o resto da lista. NÃO derivar de
 * `installmentsCount - 1` por plano: uma compra 2/5 gera 3 parcelas futuras
 * (3/5 a 5/5), não 4 — o plano guarda o total, não a parcela em que a fatura está.
 */
export function countRows(
  receivedRows: number,
  result: Pick<FinalizeResult, 'transactions' | 'skipped'>,
): { includedRowsCount: number; plannedRowsCount: number } {
  const markedRows = receivedRows - result.skipped.length;
  return {
    includedRowsCount: result.transactions.length,
    plannedRowsCount: result.transactions.length - markedRows,
  };
}
