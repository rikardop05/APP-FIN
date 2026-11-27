import { describe, expect, it } from 'vitest';

import { addCompetence, type Competence } from '@/lib/date';
import { cents } from '@/lib/money';

import { buildIncomeExpenseSeries } from './income-expense-series';
import type { IncomeExpenseMonth } from './income-expense-series';
import { averageNote, previousMonthNote, requiredIncome } from './required-income';

/** Série de 12 meses até `current`, com a despesa de cada mês (0 = sem despesa). */
function series(current: Competence, expenses: Record<number, number>): IncomeExpenseMonth[] {
  return Array.from({ length: 12 }, (_, index) => {
    const offset = index - 11; // 0 = mês corrente, -1 = anterior...
    return {
      competence: addCompetence(current, offset),
      incomeCents: cents(0),
      expenseCents: cents(expenses[offset] ?? 0),
    };
  });
}

describe('requiredIncome', () => {
  it('a meta vale para o mês seguinte ao corrente, inclusive na virada de ano', () => {
    expect(requiredIncome(series('2026-10', {}), '2026-10').nextCompetence).toBe('2026-11');
    expect(requiredIncome(series('2026-12', {}), '2026-12').nextCompetence).toBe('2027-01');
  });

  it('média dos 6 meses fechados antes do corrente; o corrente em andamento fica de fora', () => {
    const result = requiredIncome(
      series('2026-11', {
        0: 999_999, // novembro, em andamento: não entra
        [-1]: 600_000,
        [-2]: 500_000,
        [-3]: 400_000,
        [-4]: 300_000,
        [-5]: 200_000,
        [-6]: 100_000,
        [-7]: 9_000_000, // sétimo mês atrás: fora da janela
      }),
      '2026-11',
    );
    expect(result.average).toEqual({
      monthsCounted: 6,
      fromCompetence: '2026-05',
      toCompetence: '2026-10',
      averageCents: 350_000,
    });
    expect(result.previousMonth).toEqual({ competence: '2026-10', expenseCents: 600_000 });
  });

  it('arredonda a média para o centavo mais próximo', () => {
    const result = requiredIncome(series('2026-11', { [-1]: 100, [-2]: 100, [-3]: 101 }), '2026-11');
    // 301 / 3 = 100,33 -> 100
    expect(result.average?.averageCents).toBe(100);
    const rounded = requiredIncome(series('2026-11', { [-1]: 100, [-2]: 101 }), '2026-11');
    // 201 / 2 = 100,5 -> 101 (empate afasta do zero)
    expect(rounded.average?.averageCents).toBe(101);
  });

  it('meses vazios ANTES do primeiro gasto não puxam a média: é o tempo antes de usar o app', () => {
    const result = requiredIncome(series('2026-11', { [-2]: 400_000, [-1]: 200_000 }), '2026-11');
    expect(result.average).toEqual({
      monthsCounted: 2,
      fromCompetence: '2026-09',
      toCompetence: '2026-10',
      averageCents: 300_000,
    });
  });

  it('mês sem despesa DEPOIS do primeiro gasto é gasto zero de verdade e entra na média', () => {
    const result = requiredIncome(series('2026-11', { [-3]: 300_000, [-1]: 300_000 }), '2026-11');
    expect(result.average?.monthsCounted).toBe(3);
    expect(result.average?.averageCents).toBe(200_000);
  });

  it('sem nenhuma despesa nos meses fechados não há média nem meta inventada', () => {
    const result = requiredIncome(series('2026-11', { 0: 50_000 }), '2026-11');
    expect(result.average).toBeNull();
    expect(result.previousMonth.expenseCents).toBe(0);
  });

  it('o mês anterior pode ter despesa zero mesmo havendo média', () => {
    const result = requiredIncome(series('2026-11', { [-2]: 300_000 }), '2026-11');
    expect(result.previousMonth).toEqual({ competence: '2026-10', expenseCents: 0 });
    expect(result.average?.monthsCounted).toBe(2);
  });

  it('usa a despesa de buildIncomeExpenseSeries: transferência e pagamento de fatura não contam', () => {
    const built = buildIncomeExpenseSeries(
      [
        { competence: '2026-10', amountCents: cents(-80_000), kind: 'expense', status: 'posted' },
        { competence: '2026-10', amountCents: cents(-500_000), kind: 'credit_card_payment', status: 'posted' },
        { competence: '2026-10', amountCents: cents(-20_000), kind: 'transfer', status: 'posted' },
        { competence: '2026-10', amountCents: cents(900_000), kind: 'income', status: 'posted' },
      ],
      '2026-11',
      12,
    );
    const result = requiredIncome(built, '2026-11');
    expect(result.previousMonth.expenseCents).toBe(80_000);
    expect(result.average?.averageCents).toBe(80_000);
  });
});

describe('textos do bloco', () => {
  it('média cheia, curta e de um mês só', () => {
    expect(
      averageNote({ monthsCounted: 6, fromCompetence: '2026-05', toCompetence: '2026-10', averageCents: cents(1) }),
    ).toBe('Média de maio a outubro.');
    expect(
      averageNote({ monthsCounted: 3, fromCompetence: '2026-08', toCompetence: '2026-10', averageCents: cents(1) }),
    ).toBe('Média de 3 meses, de agosto a outubro: o histórico ainda é curto.');
    expect(
      averageNote({ monthsCounted: 1, fromCompetence: '2026-10', toCompetence: '2026-10', averageCents: cents(1) }),
    ).toBe('Gasto de outubro, o único mês fechado até agora.');
  });

  it('o mês anterior sem despesa explica o vazio', () => {
    expect(previousMonthNote({ competence: '2026-10', expenseCents: cents(5) })).toBe('Despesa total de outubro.');
    expect(previousMonthNote({ competence: '2026-10', expenseCents: cents(0) })).toBe(
      'Sem despesa lançada em outubro.',
    );
  });
});
