import {
  canEditTransactionKind,
  EDITABLE_TRANSACTION_KINDS,
  type EditableTransactionKind,
} from '@/lib/db/queries/transactions-editable-kinds';
import type { Cents } from '@/lib/money';
import { signedAmountCents } from './manual-sign';
import type { Transaction } from './schemas';

/**
 * Edição de uma linha em `/lancamentos`: o que o editor manda no PATCH e as duas regras da troca de
 * TIPO (Lote 1, item 4). Pura e fora do `.tsx` porque o vitest deste repo não transforma JSX, e
 * porque um erro aqui grava o lançamento com a direção ou a categoria erradas.
 */

/** Corpo do `PATCH /api/transactions/[id]` como o editor monta. `kind` só vai quando MUDOU. */
export type TransactionEditValues = {
  occurredOn: string;
  description: string;
  amountCents: number;
  categoryId: string | null;
  memberId: string | null;
  kind?: EditableTransactionKind;
};

export const editableKindLabel: Record<EditableTransactionKind, string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
  investment_contribution: 'Aporte',
};

/** O campo Tipo aparece nesta linha? A MESMA regra que o servidor aplica ao aceitar a troca. */
export function showsKindField(row: Pick<Transaction, 'accountId' | 'status' | 'kind'>): boolean {
  return canEditTransactionKind(row);
}

/** Lê o valor do `<select>` de tipo; qualquer coisa fora da lista é `null` (o tipo não muda). */
export function readEditableKind(value: string): EditableTransactionKind | null {
  return EDITABLE_TRANSACTION_KINDS.find((kind) => kind === value) ?? null;
}

type CategoryNature = NonNullable<Transaction['categoryNature']>;

/**
 * A categoria desta natureza cabe no tipo? ESPELHO de `categoryFitsKind` (`lib/finance/categorization`).
 * Espelho e nao import porque aquele modulo puxa `node:crypto` (via `dedupe`) e este arquivo roda no
 * navegador: importar derruba o app inteiro. Aqui a regra so decide o que o CAMPO mostra; quem
 * recusa a gravacao e o servidor, com a regra original. `edit-values.test.ts` compara os dois em
 * toda combinacao de natureza x tipo e quebra se divergirem.
 */
export function natureFitsKind(nature: CategoryNature, kind: EditableTransactionKind): boolean {
  if (kind === 'expense') return nature !== 'income';
  if (kind === 'income') return nature === 'income';
  return true;
}

/**
 * Categoria que fica no campo depois de trocar o tipo (`''` = "Não categorizado").
 *
 * Segue a regra de natureza x tipo (`categoryFitsKind`, a mesma que o servidor cobra): a categoria
 * fica se cabe no tipo novo; se não cabe (categoria de receita numa Despesa), é limpa em vez de o
 * salvar falhar com um erro que a pessoa não provocou de propósito.
 *
 * Em **Transferência** e **Aporte** qualquer categoria cabe, então ela FICA. De propósito: os
 * totais por categoria só olham `kind = 'expense'` e a Sobra só olha o tipo, então a categoria numa
 * transferência não entra em número nenhum; já limpá-la faria o Painel acusar "1 sem categoria"
 * para uma linha que a pessoa acabou de resolver (achado da Lupa, Lote 1).
 */
export function categoryAfterKindChange(
  categoryId: string,
  kind: EditableTransactionKind,
  categories: readonly { id: string; nature: CategoryNature }[],
): string {
  if (categoryId === '') return '';
  const category = categories.find((item) => item.id === categoryId);
  if (category === undefined) return '';
  return natureFitsKind(category.nature, kind) ? categoryId : '';
}

/**
 * A edição INVERTE a direção do dinheiro? Compara o valor gravado hoje com o que vai ser gravado.
 * Acontece ao trocar para Receita ou Despesa, em que o sinal vem do tipo (regra de 2026-10-02): uma
 * transferência de saída virada Receita passa a ser entrada. `null` = mesma direção (ou valor zero).
 * O editor usa isto só para AVISAR antes de salvar; quem decide o sinal é `signedAmountCents`.
 */
export function directionChange(currentCents: number, nextCents: number): 'to-inflow' | 'to-outflow' | null {
  if (currentCents < 0 && nextCents > 0) return 'to-inflow';
  if (currentCents > 0 && nextCents < 0) return 'to-outflow';
  return null;
}

/**
 * Monta o corpo do PATCH a partir do que está nos campos. O valor lido do campo ganha o sinal do
 * tipo que vai ser GRAVADO (Despesa negativa, Receita positiva, os demais como digitado), e `kind`
 * só entra no corpo quando é diferente do da linha: editar a descrição de uma linha de cartão não
 * manda tipo nenhum.
 */
export function buildEditValues(
  row: Pick<Transaction, 'kind'>,
  fields: {
    occurredOn: string;
    description: string;
    typedAmountCents: Cents;
    kind: Transaction['kind'];
    categoryId: string;
    memberId: string;
  },
): TransactionEditValues {
  const changedKind = fields.kind !== row.kind ? readEditableKind(fields.kind) : null;
  return {
    occurredOn: fields.occurredOn,
    description: fields.description.trim(),
    amountCents: signedAmountCents(fields.typedAmountCents, changedKind ?? row.kind),
    categoryId: fields.categoryId || null,
    memberId: fields.memberId || null,
    ...(changedKind === null ? {} : { kind: changedKind }),
  };
}
