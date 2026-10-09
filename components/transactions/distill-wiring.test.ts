import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');

describe('distill de Lancamentos e Orcamento (fiacao)', () => {
  it('filtros recolhidos, sem botao Filtrar nem submit', () => {
    const src = read('components/transactions/transaction-filters.tsx');
    expect(src).toContain('aria-expanded');
    expect(src).not.toContain('onSubmit');
    expect(src).not.toMatch(/>\s*Filtrar\s*</);
  });
  it('tela aplica filtros sozinha e ordena pelo mes atual', () => {
    const src = read('components/transactions/lancamentos-screen.tsx');
    expect(src).toContain('applyDelayMs');
    expect(src).toContain('sortForDisplay');
    expect(src).not.toContain('submitFilters');
  });
  it('acoes da linha nao empilham', () => {
    const src = read('components/transactions/transaction-list.tsx');
    expect(src).toContain('flex-nowrap');
    expect(src).not.toContain('flex-wrap gap-2');
  });
  it('orcamento mostra total e estado do salvar', () => {
    const src = read('components/budget/budget-screen.tsx');
    expect(src).toContain('monthTotals');
    expect(src).toContain('saveHint');
  });
});
