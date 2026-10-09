import { describe, expect, it } from 'vitest';
import type { BasisPoints, Cents } from '@/lib/money';
import { changedCount, monthTotals, saveHint } from './totals';

const c = (n: number) => n as Cents;
const warn = 8000 as BasisPoints;
const row = (planned: number, spent: number, expected: number) => ({ plannedCents: c(planned), spentCents: c(spent), expectedCents: c(expected) });

describe('monthTotals', () => {
  it('soma todas as linhas, inclusive orcamento zero, e calcula o uso', () => {
    const t = monthTotals([row(100000, 50000, 60000), row(100000, 10000, 20000)], warn);
    expect(t.plannedCents).toBe(200000);
    expect(t.expectedCents).toBe(80000);
    expect(t.spentCents).toBe(60000);
    expect(t.remainingCents).toBe(120000);
    expect(t.usageBp).toBe(4000);
    expect(t.light).toBe('green');
  });
  it('orcamento zero com gasto entra e deixa o total vermelho', () => {
    const t = monthTotals([row(100000, 0, 0), row(0, 30000, 30000)], warn);
    expect(t.plannedCents).toBe(100000);
    expect(t.expectedCents).toBe(30000);
  });
  it('amarelo a partir do aviso e vermelho acima de 100%', () => {
    expect(monthTotals([row(1000, 0, 800)], warn).light).toBe('yellow');
    expect(monthTotals([row(1000, 0, 1000)], warn).light).toBe('yellow');
    const over = monthTotals([row(1000, 0, 1001)], warn);
    expect(over.light).toBe('red');
    expect(over.remainingCents).toBe(-1);
  });
  it('so orcamento zero com gasto fica vermelho sem percentual', () => {
    const t = monthTotals([row(0, 500, 500)], warn);
    expect(t.usageBp).toBeNull();
    expect(t.light).toBe('red');
  });
  it('sem linhas nao ha cor', () => {
    expect(monthTotals([], warn).light).toBeNull();
  });
});

describe('saveHint e changedCount', () => {
  it('diz que nada mudou', () => {
    expect(saveHint(0)).toBe('Nada mudou desde o último salvamento');
    expect(saveHint(1)).toBe('1 categoria alterada, ainda não salva');
    expect(saveHint(3)).toBe('3 categorias alteradas, ainda não salvas');
  });
  it('conta categorias diferentes do salvo', () => {
    expect(changedCount({ a: '1', b: '2' }, { a: '1', b: '3' })).toBe(1);
    expect(changedCount({ a: '1' }, { a: '1', b: '' })).toBe(0);
    expect(changedCount({ a: '' }, {})).toBe(0);
    expect(changedCount({ a: '5' }, {})).toBe(1);
  });
});
