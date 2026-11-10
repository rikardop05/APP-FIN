import type { TransactionKind, TransactionStatus } from '@/lib/db';

/**
 * Troca de TIPO na edição de um lançamento (Lote 1, item 4): a regra única que a tela usa para
 * mostrar o campo e o servidor usa para aceitar o PATCH. Módulo sem banco de propósito, para a
 * tela poder importar (como `apply-rules-limit`).
 *
 * Tipos entre os quais um lançamento de CONTA pode trocar. `credit_card_payment` fica fora nas duas
 * pontas: pagamento de fatura está amarrado à fatura que ele quita, e não se cria nem se desfaz por
 * troca de tipo.
 */
export const EDITABLE_TRANSACTION_KINDS = [
  'expense',
  'income',
  'transfer',
  'investment_contribution',
] as const satisfies readonly TransactionKind[];

export type EditableTransactionKind = (typeof EDITABLE_TRANSACTION_KINDS)[number];

export function isEditableTransactionKind(kind: TransactionKind): kind is EditableTransactionKind {
  return (EDITABLE_TRANSACTION_KINDS as readonly TransactionKind[]).includes(kind);
}

/**
 * O tipo desta linha pode ser trocado? Só lançamento de CONTA (em cartão, o tipo vem da fatura), já
 * LANÇADO (previsão de recorrência ou de receita é regenerada com o tipo da regra) e que hoje é um
 * dos tipos editáveis.
 */
export function canEditTransactionKind(row: {
  accountId: string | null;
  status: TransactionStatus;
  kind: TransactionKind;
}): boolean {
  return row.accountId !== null && row.status === 'posted' && isEditableTransactionKind(row.kind);
}
