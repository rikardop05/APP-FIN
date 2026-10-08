import type { CategoryNature, TransactionKind } from '@/lib/db';
import { categoryFitsKind } from '@/lib/finance/categorization';

/**
 * Natureza x tipo (achado do Esquadro e do Corvo na F4): despesa não vai para categoria de receita, e
 * receita só vai para categoria de receita. A natureza da categoria decide em que total o valor entra
 * (os KPIs somam pela `nature`): uma despesa numa categoria `income` viraria receita negativa no painel.
 *
 * A regra é `categoryFitsKind` (pura, em `lib/finance/categorization`); aqui ela vira ERRO no servidor
 * para a categorização MANUAL (lançamento novo, edição e lote), que a tela de revisão já respeitava ao
 * sugerir mas que o servidor não conferia. A importação e a aplicação de regras têm o seu caminho.
 */
export class CategoryKindMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryKindMismatchError';
  }
}

/** Lança `CategoryKindMismatchError` se ALGUM dos `kinds` não cabe na categoria de natureza `nature`. */
export function assertCategoryFitsKinds(nature: CategoryNature, kinds: readonly TransactionKind[]): void {
  const misfits = kinds.filter((kind) => !categoryFitsKind(nature, kind));
  if (misfits.length === 0) return;
  if (kinds.length === 1) {
    throw new CategoryKindMismatchError(
      misfits[0] === 'expense'
        ? 'Despesa não pode ir para uma categoria de receita.'
        : 'Receita só pode ir para uma categoria de receita.',
    );
  }
  const count = misfits.length;
  throw new CategoryKindMismatchError(
    `${String(count)} ${count === 1 ? 'lançamento não cabe' : 'lançamentos não cabem'} nesta categoria: ` +
      'despesa não vai para categoria de receita, e receita só vai para categoria de receita. Nada foi alterado.',
  );
}
