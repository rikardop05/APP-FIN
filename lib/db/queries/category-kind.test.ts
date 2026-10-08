import { describe, expect, it } from 'vitest';

import { assertCategoryFitsKinds, CategoryKindMismatchError } from './category-kind';

describe('categoria x tipo do lançamento (natureza x tipo)', () => {
  it('despesa em categoria de receita é recusada, com a mensagem em português', () => {
    expect(() => assertCategoryFitsKinds('income', ['expense'])).toThrow(CategoryKindMismatchError);
    expect(() => assertCategoryFitsKinds('income', ['expense'])).toThrow(
      'Despesa não pode ir para uma categoria de receita.',
    );
  });

  it('receita só vai para categoria de receita: essencial, não essencial e investimento são recusadas', () => {
    for (const nature of ['essential', 'non_essential', 'investment'] as const) {
      expect(() => assertCategoryFitsKinds(nature, ['income']), nature).toThrow(
        'Receita só pode ir para uma categoria de receita.',
      );
    }
  });

  it('receita em categoria de receita e despesa em categoria de despesa passam', () => {
    expect(() => assertCategoryFitsKinds('income', ['income'])).not.toThrow();
    for (const nature of ['essential', 'non_essential', 'investment'] as const) {
      expect(() => assertCategoryFitsKinds(nature, ['expense']), nature).not.toThrow();
    }
  });

  it('em lote, UM lançamento que não cabe recusa o lote inteiro, dizendo quantos', () => {
    expect(() => assertCategoryFitsKinds('income', ['income', 'expense', 'income'])).toThrow(CategoryKindMismatchError);
    expect(() => assertCategoryFitsKinds('income', ['income', 'expense', 'expense'])).toThrow(
      '2 lançamentos não cabem nesta categoria: despesa não vai para categoria de receita, e receita só vai para categoria de receita. Nada foi alterado.',
    );
    expect(() => assertCategoryFitsKinds('essential', ['income', 'expense'])).toThrow(
      '1 lançamento não cabe nesta categoria: despesa não vai para categoria de receita, e receita só vai para categoria de receita. Nada foi alterado.',
    );
  });

  it('lote que cabe inteiro passa; lote vazio não lança', () => {
    expect(() => assertCategoryFitsKinds('essential', ['expense', 'expense'])).not.toThrow();
    expect(() => assertCategoryFitsKinds('income', [])).not.toThrow();
  });

  it('os demais tipos (transferência, aporte, pagamento de fatura) não são restringidos aqui', () => {
    for (const kind of ['transfer', 'investment_contribution', 'credit_card_payment'] as const) {
      expect(() => assertCategoryFitsKinds('income', [kind]), kind).not.toThrow();
      expect(() => assertCategoryFitsKinds('essential', [kind]), kind).not.toThrow();
    }
  });
});
