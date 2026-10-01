import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { buildIncomeExpenseSeries, type IncomeExpenseInputRow } from './income-expense-series';

function row(partial: Partial<IncomeExpenseInputRow> & Pick<IncomeExpenseInputRow, 'competence' | 'amountCents'>): IncomeExpenseInputRow {
  return { kind: 'expense', status: 'posted', ...partial };
}

describe('buildIncomeExpenseSeries', () => {
  it('devolve SEMPRE as 12 competências, da mais antiga à corrente, com zero nos meses vazios', () => {
    const series = buildIncomeExpenseSeries([], '2026-10', 12);
    expect(series).toHaveLength(12);
    expect(series[0]?.competence).toBe('2025-11');
    expect(series[11]?.competence).toBe('2026-10');
    expect(series.every((m) => m.incomeCents === 0 && m.expenseCents === 0)).toBe(true);
  });

  it('soma posted e planned do mês (custo do mês inteiro), como o KPI', () => {
    const series = buildIncomeExpenseSeries(
      [
        row({ competence: '2026-10', amountCents: cents(-30_000) }),
        row({ competence: '2026-10', amountCents: cents(-12_000), status: 'planned' }),
        row({ competence: '2026-10', amountCents: cents(500_000), kind: 'income' }),
      ],
      '2026-10',
      12,
    );
    const current = series[11];
    // despesa: 30.000 + 12.000 = 42.000
    expect(current?.expenseCents).toBe(42_000);
    expect(current?.incomeCents).toBe(500_000);
  });

  it('transfer e pagamento de fatura são invisíveis (RC-03)', () => {
    const series = buildIncomeExpenseSeries(
      [
        row({ competence: '2026-10', amountCents: cents(-90_000), kind: 'credit_card_payment' }),
        row({ competence: '2026-10', amountCents: cents(-10_000), kind: 'transfer' }),
      ],
      '2026-10',
      12,
    );
    expect(series[11]?.expenseCents).toBe(0);
  });

  it('mês só com estorno dá despesa zero, não despesa positiva (piso do §14)', () => {
    const series = buildIncomeExpenseSeries([row({ competence: '2026-09', amountCents: cents(5_000) })], '2026-10', 12);
    expect(series[10]?.competence).toBe('2026-09');
    expect(series[10]?.expenseCents).toBe(0);
  });

  it('linha fora da janela é ignorada', () => {
    const series = buildIncomeExpenseSeries([row({ competence: '2024-01', amountCents: cents(-99) })], '2026-10', 12);
    expect(series.every((m) => m.expenseCents === 0)).toBe(true);
  });
});
