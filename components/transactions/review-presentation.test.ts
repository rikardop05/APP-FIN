import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import {
  categoryChoices,
  confirmationBody,
  initialDraft,
  reviewResultMessage,
} from './review-presentation';
import type { ReviewCategory, ReviewGroup } from './schemas';

const ALIMENTACAO = '00000000-0000-4000-8000-000000000001';
const MERCADO = '00000000-0000-4000-8000-000000000002';
const DELIVERY = '00000000-0000-4000-8000-000000000003';
const SALARIO = '00000000-0000-4000-8000-000000000004';
const OUTROS = '00000000-0000-4000-8000-000000000005';
const RECEITAS = '00000000-0000-4000-8000-000000000006';
const RULE = '00000000-0000-4000-8000-000000000007';

const categories: ReviewCategory[] = [
  { id: ALIMENTACAO, name: 'Alimentação', parentId: null, nature: 'essential' },
  { id: MERCADO, name: 'Mercado', parentId: ALIMENTACAO, nature: 'essential' },
  { id: DELIVERY, name: 'Delivery', parentId: ALIMENTACAO, nature: 'non_essential' },
  { id: RECEITAS, name: 'Receitas', parentId: null, nature: 'income' },
  { id: SALARIO, name: 'Salário', parentId: RECEITAS, nature: 'income' },
  { id: OUTROS, name: 'Outros', parentId: null, nature: 'non_essential' },
];

function group(over: Partial<ReviewGroup> = {}): ReviewGroup {
  return {
    key: 'out|pattern:irmaos boa',
    pattern: 'irmaos boa',
    direction: 'out',
    transactionIds: ['t1', 't2'],
    count: 2,
    totalCents: cents(-12550),
    sampleDescriptions: ['IRMAOS BOA'],
    ruleId: null,
    suggestedCategoryId: null,
    suggestedCategoryName: null,
    ...over,
  };
}

describe('categoryChoices', () => {
  it('saida: so folhas que nao sao de receita, com a raiz no rotulo, em ordem alfabetica', () => {
    expect(categoryChoices(categories, 'out')).toEqual([
      { id: DELIVERY, label: 'Alimentação › Delivery' },
      { id: MERCADO, label: 'Alimentação › Mercado' },
      { id: OUTROS, label: 'Outros' },
    ]);
  });

  it('entrada: so folhas de receita', () => {
    expect(categoryChoices(categories, 'in')).toEqual([{ id: SALARIO, label: 'Receitas › Salário' }]);
  });

  it('sem categorias, sem opcoes', () => {
    expect(categoryChoices([], 'out')).toEqual([]);
  });
});

describe('initialDraft', () => {
  it('grupo sem regra: "criar regra" marcado com o padrao sugerido', () => {
    expect(initialDraft(group())).toEqual({ pattern: 'irmaos boa', categoryId: '', createRule: true });
  });

  it('grupo de regra existente: categoria sugerida e sem criar regra duplicada', () => {
    expect(initialDraft(group({ ruleId: RULE, suggestedCategoryId: MERCADO }))).toEqual({
      pattern: 'irmaos boa',
      categoryId: MERCADO,
      createRule: false,
    });
  });

  it('grupo sem padrao sugerido: nao marca criar regra', () => {
    expect(initialDraft(group({ pattern: '' })).createRule).toBe(false);
  });
});

describe('confirmationBody', () => {
  it('sem categoria nao confirma', () => {
    expect(confirmationBody(group(), { pattern: 'x', categoryId: '', createRule: false })).toEqual({
      ok: false,
      message: 'Escolha a categoria.',
    });
  });

  it('criar regra com padrao vazio nao confirma', () => {
    expect(confirmationBody(group(), { pattern: '   ', categoryId: MERCADO, createRule: true })).toEqual({
      ok: false,
      message: 'Informe o padrão da regra ou desmarque "Criar regra".',
    });
  });

  it('com regra: manda o padrao aparado e todos os ids do grupo', () => {
    expect(confirmationBody(group(), { pattern: ' irmaos boa ', categoryId: MERCADO, createRule: true })).toEqual({
      ok: true,
      body: { transactionIds: ['t1', 't2'], categoryId: MERCADO, newRulePattern: 'irmaos boa' },
    });
  });

  it('sem regra: newRulePattern null, mesmo com padrao preenchido', () => {
    expect(confirmationBody(group(), { pattern: 'irmaos boa', categoryId: MERCADO, createRule: false })).toEqual({
      ok: true,
      body: { transactionIds: ['t1', 't2'], categoryId: MERCADO, newRulePattern: null },
    });
  });
});

describe('reviewResultMessage', () => {
  it('so categorizou', () => {
    expect(reviewResultMessage({ categorized: 1, skipped: 0, propagated: 0, ruleId: null })).toBe('1 lançamento categorizado.');
  });

  it('com regra, propagacao e pulados, no plural', () => {
    expect(reviewResultMessage({ categorized: 3, skipped: 2, propagated: 4, ruleId: RULE })).toBe(
      '3 lançamentos categorizados; regra criada para os próximos; 4 parcelas sem categoria acompanharam o parcelamento; 2 pulados porque mudaram desde que a tela abriu.',
    );
  });
});
