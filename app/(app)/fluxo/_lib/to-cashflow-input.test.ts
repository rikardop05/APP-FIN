import { describe, expect, it } from 'vitest';

import type { CashflowData, CashflowRow } from '@/lib/db/queries/cashflow';
import { projectCashflow } from '@/lib/finance/cashflow';
import { cents } from '@/lib/money';

import { toCashflowInput } from './to-cashflow-input';

function data(rows: CashflowRow[], overrides: Partial<CashflowData> = {}): CashflowData {
  return {
    fromCompetence: '2026-10',
    months: 3,
    openingBalanceCents: cents(100_000),
    rows,
    recurrencePlannedThrough: '2026-12',
    cardRowsWithoutCashDate: 0,
    ...overrides,
  };
}

function row(partial: Partial<CashflowRow> & Pick<CashflowRow, 'cashDate' | 'amountCents'>): CashflowRow {
  return {
    kind: 'expense',
    status: 'planned',
    origin: 'account',
    isInstallment: false,
    ...partial,
  };
}

describe('toCashflowInput — cada linha num balde só', () => {
  it('parcela de cartão conta UMA vez: dentro da fatura, não em installments', () => {
    // Fatura de nov: compra R$ 200,00 + parcela R$ 300,00 = R$ 500,00 devidos.
    const { input, composition } = toCashflowInput(
      data([
        row({ cashDate: '2026-11-10', amountCents: cents(-20_000), origin: 'card' }),
        row({ cashDate: '2026-11-10', amountCents: cents(-30_000), origin: 'card', isInstallment: true }),
      ]),
    );

    expect(input.installments).toEqual([]);
    expect(input.statementsDue).toEqual([{ competence: '2026-11', amountCents: 50_000 }]);
    expect(composition['2026-11']).toEqual({ statementsCents: 50_000, statementInstallmentsCents: 30_000 });

    // Conta: 100.000 − 50.000 em nov = 50.000. Se a parcela entrasse também em
    // installments, o fechamento seria 20.000 — o dobro de saída.
    const nov = projectCashflow(input).months[1];
    expect(nov?.closingCents).toBe(50_000);
  });

  it('parcela em conta vai para installments; despesa e entrada em conta, nos seus baldes', () => {
    const { input } = toCashflowInput(
      data([
        row({ cashDate: '2026-10-05', amountCents: cents(-12_000), isInstallment: true }),
        row({ cashDate: '2026-10-06', amountCents: cents(-8_000) }),
        row({ cashDate: '2026-10-07', amountCents: cents(500_000), kind: 'income' }),
      ]),
    );

    expect(input.installments).toEqual([{ competence: '2026-10', amountCents: 12_000 }]);
    expect(input.recurringExpenses.map((o) => o.amountCents)).toEqual([-8_000]);
    expect(input.incomes.map((o) => o.amountCents)).toEqual([500_000]);

    // 100.000 + 500.000 − 8.000 − 12.000 = 580.000
    expect(projectCashflow(input).months[0]?.closingCents).toBe(580_000);
  });

  it('o mês vem de cash_date, não da competência: fatura de set paga em out cai em out', () => {
    const { input } = toCashflowInput(
      data([row({ cashDate: '2026-10-09', amountCents: cents(-70_000), origin: 'card' })]),
    );
    expect(input.statementsDue).toEqual([{ competence: '2026-10', amountCents: 70_000 }]);
  });

  it('o sinal decide a direção: estorno em linha expense é entrada, não despesa', () => {
    const { input } = toCashflowInput(
      data([row({ cashDate: '2026-10-12', amountCents: cents(4_000), kind: 'expense' })]),
    );
    expect(input.incomes.map((o) => o.amountCents)).toEqual([4_000]);
    expect(input.recurringExpenses).toEqual([]);
  });

  it('aporte em conta vai para plannedContributions, em magnitude', () => {
    const { input } = toCashflowInput(
      data([row({ cashDate: '2026-10-15', amountCents: cents(-25_000), kind: 'investment_contribution' })]),
    );
    expect(input.plannedContributions).toEqual([{ competence: '2026-10', amountCents: 25_000 }]);
  });

  it('fatura com saldo credor não vira saída e gera aviso (o motor lançaria)', () => {
    const { input, warnings } = toCashflowInput(
      data([
        row({ cashDate: '2026-11-10', amountCents: cents(-10_000), origin: 'card' }),
        row({ cashDate: '2026-11-10', amountCents: cents(15_000), origin: 'card' }),
      ]),
    );
    expect(input.statementsDue).toEqual([]);
    expect(warnings.some((w) => w.includes('11/2026') && w.includes('saldo credor'))).toBe(true);
    expect(() => projectCashflow(input)).not.toThrow();
  });

  it('carrega o saldo de abertura e a competência inicial sem tocar neles', () => {
    const { input } = toCashflowInput(data([], { openingBalanceCents: cents(-3_000) }));
    expect(input.openingBalanceCents).toBe(-3_000);
    expect(input.fromCompetence).toBe('2026-10');
    expect(input.months).toBe(3);
  });
});

describe('toCashflowInput — avisos de cobertura', () => {
  it('previsão que acaba antes do fim da janela avisa o último mês coberto', () => {
    const { warnings } = toCashflowInput(data([], { recurrencePlannedThrough: '2026-11' }));
    expect(warnings).toContain(
      'A previsão de despesas fixas e receitas vai só até 11/2026; os meses seguintes estão sem elas.',
    );
  });

  it('sem nenhuma previsão avisa que não há cadastro', () => {
    const { warnings } = toCashflowInput(data([], { recurrencePlannedThrough: null }));
    expect(warnings).toContain('Não há despesas fixas nem receitas previstas cadastradas.');
  });

  it('previsão cobrindo a janela inteira não gera aviso', () => {
    expect(toCashflowInput(data([])).warnings).toEqual([]);
  });

  it('linha de cartão sem cash_date vira aviso, não chute de mês', () => {
    const { warnings } = toCashflowInput(data([], { cardRowsWithoutCashDate: 2 }));
    expect(warnings.some((w) => w.startsWith('2 lançamento(s) de cartão sem data'))).toBe(true);
  });
});
