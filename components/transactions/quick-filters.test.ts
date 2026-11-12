import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  activeFilterLabels,
  EMPTY_FILTERS,
  hasActiveFilters,
  panelFilterCount,
  panelFilterLabels,
  quickToggles,
  type TransactionFilterValues,
} from './filter-presentation';

const options = {
  categories: [{ id: 'cat-1', name: 'Mercado' }],
  accounts: [{ id: 'acc-1', name: 'Salário' }],
  cards: [{ id: 'card-1', name: 'Santander' }],
  members: [
    { id: 'mem-1', name: 'Ricardo' },
    { id: 'mem-2', name: 'Ana' },
  ],
};
const filters = (overrides: Partial<TransactionFilterValues> = {}): TransactionFilterValues => ({ ...EMPTY_FILTERS, ...overrides });
const apply = (current: TransactionFilterValues, key: string): TransactionFilterValues => {
  const toggle = quickToggles(current, options.members).find((item) => item.key === key);
  if (toggle === undefined) throw new Error(`toggle ausente: ${key}`);
  return { ...current, ...toggle.next };
};

describe('filtros rápidos (Lote 2, item 5)', () => {
  it('ordem da tela: Receitas, Despesas, Cartão, Conta e um por responsável', () => {
    expect(quickToggles(EMPTY_FILTERS, options.members).map((item) => item.label)).toEqual([
      'Receitas',
      'Despesas',
      'Cartão',
      'Conta',
      'Ricardo',
      'Ana',
    ]);
    expect(quickToggles(EMPTY_FILTERS, options.members).every((item) => !item.pressed)).toBe(true);
  });

  it('apertar liga, apertar de novo desliga', () => {
    const on = apply(EMPTY_FILTERS, 'direction-income');
    expect(on.direction).toBe('income');
    expect(quickToggles(on, options.members).find((item) => item.key === 'direction-income')?.pressed).toBe(true);
    expect(apply(on, 'direction-income').direction).toBe('');
  });

  it('dentro do grupo só um fica ligado: Despesas desliga Receitas, Conta desliga Cartão, Ana desliga Ricardo', () => {
    expect(apply(filters({ direction: 'income' }), 'direction-expense').direction).toBe('expense');
    expect(apply(filters({ origin: 'card' }), 'origin-account').origin).toBe('account');
    expect(apply(filters({ memberId: 'mem-1' }), 'member-mem-2').memberId).toBe('mem-2');
  });

  it('grupos diferentes combinam: Despesas + Cartão + Ricardo', () => {
    const combined = apply(apply(apply(EMPTY_FILTERS, 'direction-expense'), 'origin-card'), 'member-mem-1');
    expect(combined).toMatchObject({ direction: 'expense', origin: 'card', memberId: 'mem-1' });
    expect(activeFilterCount(combined)).toBe(3);
  });

  it('Conta limpa o cartão específico do painel (senão a lista sairia vazia), e Cartão limpa a conta', () => {
    expect(apply(filters({ creditCardId: 'card-1' }), 'origin-account')).toMatchObject({ origin: 'account', creditCardId: '' });
    expect(apply(filters({ accountId: 'acc-1' }), 'origin-card')).toMatchObject({ origin: 'card', accountId: '' });
    // Cartão rápido + cartão específico é coerente: fica.
    expect(apply(filters({ creditCardId: 'card-1' }), 'origin-card').creditCardId).toBe('card-1');
  });

  it('filtro rápido conta como filtro ativo (esconde o resumo do mês e decide o vazio)', () => {
    expect(hasActiveFilters(filters({ direction: 'income' }))).toBe(true);
    expect(hasActiveFilters(filters({ origin: 'account' }))).toBe(true);
    expect(activeFilterLabels(filters({ direction: 'expense', origin: 'card' }), options)).toEqual(['Só despesas', 'Só cartão']);
    expect(activeFilterLabels(filters({ direction: 'income', origin: 'account' }), options)).toEqual(['Só receitas', 'Só conta']);
  });
});

describe('o botão "Filtros" conta só o que mora no painel', () => {
  it('filtros rápidos, responsável e busca não entram', () => {
    expect(panelFilterCount(filters({ direction: 'income', origin: 'card', memberId: 'mem-1', search: 'pad' }))).toBe(0);
    expect(panelFilterLabels(filters({ direction: 'income', origin: 'card', memberId: 'mem-1', search: 'pad' }), options)).toEqual([]);
  });

  it('período (um), categoria, conta, cartão, situação e não categorizados entram', () => {
    const all = filters({
      from: '2026-10-01',
      to: '2026-10-31',
      categoryId: 'cat-1',
      accountId: 'acc-1',
      creditCardId: 'card-1',
      settlement: 'paid',
      uncategorized: true,
    });
    expect(panelFilterCount(all)).toBe(6);
    expect(panelFilterLabels(all, options)).toEqual([
      'Período: 01/10/2026 a 31/10/2026',
      'Categoria: Mercado',
      'Conta: Salário',
      'Cartão: Santander',
      'Só não categorizados',
      'Situação: pagos',
    ]);
  });
});
