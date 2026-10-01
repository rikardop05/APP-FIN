import { describe, expect, it } from 'vitest';

import { expandRecurrence } from '@/lib/finance/recurrence';
import { basisPoints, cents } from '@/lib/money';

import {
  buildPlannedRows,
  PlannedSeriesError,
  type PlannedSeries,
} from './recurring-planned';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const ACCOUNT = '00000000-0000-4000-8000-000000000002';
const CARD = '00000000-0000-4000-8000-000000000003';

function expenseSeries(overrides: Partial<PlannedSeries> = {}): PlannedSeries {
  return {
    householdId: HOUSEHOLD,
    origin: { kind: 'expense', recurringExpenseId: '00000000-0000-4000-8000-0000000000e1' },
    description: 'Conta de luz',
    categoryId: '00000000-0000-4000-8000-0000000000c1',
    memberId: null,
    destination: { accountId: ACCOUNT, creditCardId: null },
    ...overrides,
  };
}

function monthly(expected: number, months = 3) {
  return expandRecurrence(
    {
      expectedCents: cents(expected),
      dueDay: 5,
      frequency: 'monthly',
      startsOn: '2026-09-01',
      endsOn: null,
      annualAdjustmentBp: null,
    },
    { from: '2026-09', months },
  );
}

describe('buildPlannedRows', () => {
  it('uma linha por ocorrência, sempre planned e com a origem da regra', () => {
    const rows = buildPlannedRows(expenseSeries(), monthly(-18000));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('planned');
      expect(row.recurringExpenseId).toBe('00000000-0000-4000-8000-0000000000e1');
      expect(row.incomeId).toBeNull();
      expect(row.accountId).toBe(ACCOUNT);
      expect(row.creditCardId).toBeNull();
      expect(row.amountCents).toBe(-18000);
      expect(row.kind).toBe('expense');
      expect(row.dedupeHash).toBeNull();
      expect(row.rawDescription).toBe('');
    }
    expect(rows.map((row) => row.competence)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(rows[0]?.occurredOn).toBe('2026-09-05');
    expect(rows[0]?.cashDate).toBe('2026-09-05');
  });

  it('receita sai como income e leva incomeId, não recurringExpenseId', () => {
    const rows = buildPlannedRows(
      {
        ...expenseSeries(),
        origin: { kind: 'income', incomeId: '00000000-0000-4000-8000-0000000000a1' },
        categoryId: null,
        memberId: '00000000-0000-4000-8000-0000000000b1',
      },
      monthly(500000, 2),
    );
    expect(rows.map((row) => row.kind)).toEqual(['income', 'income']);
    expect(rows[0]?.incomeId).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(rows[0]?.recurringExpenseId).toBeNull();
  });

  it('reajuste anual chega nas linhas (o valor não é o mesmo em todo mês)', () => {
    const occurrences = expandRecurrence(
      {
        expectedCents: cents(-10000),
        dueDay: 5,
        frequency: 'monthly',
        startsOn: '2026-09-01',
        endsOn: null,
        annualAdjustmentBp: basisPoints(1000),
      },
      { from: '2026-09', months: 14 },
    );
    const rows = buildPlannedRows(expenseSeries(), occurrences);
    expect(rows[0]?.amountCents).toBe(-10000);
    expect(rows[13]?.amountCents).toBe(-11000);
  });

  it('despesa com valor positivo lança, em vez de gravar o sinal errado', () => {
    expect(() => buildPlannedRows(expenseSeries(), monthly(18000))).toThrow(PlannedSeriesError);
  });

  it('receita com valor negativo lança', () => {
    const series: PlannedSeries = {
      ...expenseSeries(),
      origin: { kind: 'income', incomeId: '00000000-0000-4000-8000-0000000000a1' },
    };
    expect(() => buildPlannedRows(series, monthly(-500000))).toThrow(PlannedSeriesError);
  });

  describe('cartão: a competência é a da FATURA (billingPeriodFor), não o mês da data', () => {
    const cardSeries = (closingDay: number, dueDay: number): PlannedSeries =>
      expenseSeries({
        destination: { accountId: null, creditCardId: CARD, cycle: { closingDay, dueDay } },
      });
    const charge = (dueDay: number, months = 1, from = '2026-09') =>
      expandRecurrence(
        {
          expectedCents: cents(-4990),
          dueDay,
          frequency: 'monthly',
          startsOn: `${from}-01`,
          endsOn: null,
          annualAdjustmentBp: null,
        },
        { from, months },
      );

    it('Nubank (fecha 1, vence 9): cobrança dia 28 de set cai na fatura de out, vence 09/10', () => {
      const [row] = buildPlannedRows(cardSeries(1, 9), charge(28));
      expect(row?.competence).toBe('2026-10');
      expect(row?.cashDate).toBe('2026-10-09');
      expect(row?.occurredOn).toBe('2026-09-28');
      expect(row?.creditCardId).toBe(CARD);
      expect(row?.accountId).toBeNull();
    });

    it('Santander (fecha 1, vence 10): cobrança dia 28 de set cai em out, vence 10/10', () => {
      const [row] = buildPlannedRows(cardSeries(1, 10), charge(28));
      expect(row?.competence).toBe('2026-10');
      expect(row?.cashDate).toBe('2026-10-10');
    });

    it('Mercado Pago (fecha 14, vence 20): cobrança dia 5 de set cai em set, vence 20/09', () => {
      const [row] = buildPlannedRows(cardSeries(14, 20), charge(5));
      expect(row?.competence).toBe('2026-09');
      expect(row?.cashDate).toBe('2026-09-20');
    });

    it('fecha 25, vence 5 (o ciclo que atravessa o mês): dia 28 cai no mês SEGUINTE, vence só 2 meses depois', () => {
      const rows = buildPlannedRows(cardSeries(25, 5), charge(28, 3));
      expect(rows.map((row) => row.competence)).toEqual(['2026-10', '2026-11', '2026-12']);
      expect(rows.map((row) => row.cashDate)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    });

    it('fecha 25, vence 5: dia 20 (antes do fechamento) fica na fatura do próprio mês', () => {
      const [row] = buildPlannedRows(cardSeries(25, 5), charge(20));
      expect(row?.competence).toBe('2026-09');
      expect(row?.cashDate).toBe('2026-10-05');
    });

    it('dia 31 com fechamento 28 junta janeiro e fevereiro na mesma fatura: lança, não descarta em silêncio', () => {
      expect(() => buildPlannedRows(cardSeries(28, 5), charge(31, 2, '2027-01'))).toThrow(
        PlannedSeriesError,
      );
      expect(() => buildPlannedRows(cardSeries(28, 5), charge(31, 2, '2027-01'))).toThrow(
        /2027-02/,
      );
    });

    it('a mesma série em conta, com o mesmo dia 31, NÃO colide (conta usa o mês da data)', () => {
      const rows = buildPlannedRows(expenseSeries(), charge(31, 2, '2027-01'));
      expect(rows.map((row) => row.competence)).toEqual(['2027-01', '2027-02']);
    });
  });

  it('sem ocorrências, sem linhas (e sem exigir nada da série vazia além do destino)', () => {
    expect(buildPlannedRows(expenseSeries(), [])).toEqual([]);
  });
});
