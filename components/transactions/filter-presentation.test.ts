import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  activeFilterLabels,
  applyDelayMs,
  EMPTY_FILTERS,
  filterToggleLabel,
  type TransactionFilterValues,
} from './filter-presentation';

const options = {
  categories: [{ id: 'cat-1', name: 'Mercado' }],
  accounts: [{ id: 'acc-1', name: 'Salário' }],
  cards: [{ id: 'card-1', name: 'Santander' }],
  members: [{ id: 'mem-1', name: 'Ricardo' }],
};
const filters = (overrides: Partial<TransactionFilterValues> = {}): TransactionFilterValues => ({ ...EMPTY_FILTERS, ...overrides });

describe('contagem de filtros ativos (o botão "Filtros" mostra quantos)', () => {
  it('sem filtro nenhum: zero', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('período conta UM, mesmo com data inicial e final', () => {
    expect(activeFilterCount(filters({ from: '2026-10-01' }))).toBe(1);
    expect(activeFilterCount(filters({ from: '2026-10-01', to: '2026-10-31' }))).toBe(1);
  });

  it('cada outro campo conta um: categoria, conta, cartão, responsável, texto e não categorizados', () => {
    expect(
      activeFilterCount(
        filters({ categoryId: 'cat-1', accountId: 'acc-1', creditCardId: 'card-1', memberId: 'mem-1', search: 'pad', uncategorized: true, from: '2026-10-01' }),
      ),
    ).toBe(7);
  });

  it('texto só com espaços não conta (a busca também o ignora)', () => {
    expect(activeFilterCount(filters({ search: '   ' }))).toBe(0);
  });

  it('rótulo do botão: "Filtros" sem filtro, "Filtros (N)" com N ativos', () => {
    expect(filterToggleLabel(0)).toBe('Filtros');
    expect(filterToggleLabel(3)).toBe('Filtros (3)');
  });
});

describe('resumo dos filtros ativos (visível com o painel fechado)', () => {
  it('uma frase por filtro, com o nome (não o id) e a data em pt-BR', () => {
    expect(
      activeFilterLabels(
        filters({ from: '2026-10-01', to: '2026-10-31', categoryId: 'cat-1', creditCardId: 'card-1', memberId: 'mem-1', search: ' padaria ', uncategorized: true }),
        options,
      ),
    ).toEqual([
      'Período: 01/10/2026 a 31/10/2026',
      'Categoria: Mercado',
      'Cartão: Santander',
      'Responsável: Ricardo',
      'Texto: “padaria”',
      'Só não categorizados',
    ]);
  });

  it('período com um lado só diz de que lado; id desconhecido não quebra', () => {
    expect(activeFilterLabels(filters({ from: '2026-10-01' }), options)).toEqual(['Período: a partir de 01/10/2026']);
    expect(activeFilterLabels(filters({ to: '2026-10-31' }), options)).toEqual(['Período: até 31/10/2026']);
    expect(activeFilterLabels(filters({ accountId: 'sumiu' }), options)).toEqual(['Conta: (removida)']);
    expect(activeFilterLabels(EMPTY_FILTERS, options)).toEqual([]);
  });
});

describe('os filtros aplicam sozinhos: quando', () => {
  it('seleção, data e caixa de marcar aplicam na hora (0 ms)', () => {
    const applied = filters();
    for (const next of [filters({ categoryId: 'cat-1' }), filters({ from: '2026-10-01' }), filters({ uncategorized: true }), filters({ memberId: 'mem-1' })]) {
      expect(applyDelayMs(applied, next)).toBe(0);
    }
  });

  it('digitar no texto espera a pessoa parar (350 ms), para não consultar a cada tecla', () => {
    expect(applyDelayMs(filters(), filters({ search: 'p' }))).toBe(350);
    expect(applyDelayMs(filters({ search: 'p' }), filters({ search: 'pa' }))).toBe(350);
  });

  it('apagar o texto também espera; texto igual (só espaço nas pontas) não atrasa', () => {
    expect(applyDelayMs(filters({ search: 'pad' }), filters())).toBe(350);
    expect(applyDelayMs(filters({ search: 'pad' }), filters({ search: 'pad ' }))).toBe(0);
  });
});
