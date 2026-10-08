import type { ImportPreviewRow } from '@/lib/import/pipeline';

/**
 * Estado de cada linha da prévia de importação: se chega marcada e como se chama. Fora do .tsx
 * porque o vitest não transforma JSX, e para o formulário (`initialDrafts`) e o contador inicial
 * usarem a MESMA regra.
 */

type PreviewState = ImportPreviewRow['state'];

/**
 * Chega marcada para importar? Não chegam: duplicada, pagamento de fatura anterior (RF-CC-04: pertence
 * ao extrato da conta) e linha INFORMATIVA (decisão 8: valor zero, nem despesa nem receita; só entra se
 * o usuário corrigir o valor).
 */
export function defaultInclude(state: PreviewState): boolean {
  return state !== 'duplicate' && state !== 'credit_card_payment' && state !== 'informational';
}

export function stateLabel(state: PreviewState): string {
  switch (state) {
    case 'duplicate':
      return 'Duplicada';
    case 'credit_card_payment':
      return 'Pagamento';
    case 'informational':
      return 'Informativa';
    case 'installment_first':
    case 'installment_part':
      return 'Parcelada';
    case 'new':
      return 'Nova';
  }
}

/** Quantas linhas chegam marcadas (o contador inicial do rodapé). */
export function includedByDefaultCount(rows: readonly { state: PreviewState }[]): number {
  return rows.filter((row) => defaultInclude(row.state)).length;
}
