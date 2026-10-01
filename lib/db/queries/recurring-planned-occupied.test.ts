import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { dropOccupied, type PlannedTransactionRow } from './recurring-planned';

function row(competence: string): PlannedTransactionRow {
  return {
    householdId: '00000000-0000-4000-8000-000000000001',
    occurredOn: `${competence}-05`,
    competence,
    cashDate: `${competence}-05`,
    description: 'Conta de luz',
    rawDescription: '',
    amountCents: cents(-22000),
    kind: 'expense',
    status: 'planned',
    categoryId: null,
    accountId: '00000000-0000-4000-8000-000000000002',
    creditCardId: null,
    memberId: null,
    recurringExpenseId: '00000000-0000-4000-8000-0000000000e1',
    incomeId: null,
    dedupeHash: null,
  };
}

describe('dropOccupied', () => {
  it('descarta a linha cuja competência já tem ocorrência e informa qual', () => {
    const { kept, skipped } = dropOccupied(
      [row('2026-10'), row('2026-11'), row('2026-12')],
      new Set(['2026-10', '2026-12']),
    );
    expect(kept.map((r) => r.competence)).toEqual(['2026-11']);
    expect(skipped).toEqual(['2026-10', '2026-12']);
  });

  it('sem competência ocupada, mantém tudo na ordem recebida', () => {
    const rows = [row('2026-11'), row('2026-12')];
    const { kept, skipped } = dropOccupied(rows, new Set());
    expect(kept).toEqual(rows);
    expect(skipped).toEqual([]);
  });

  it('é puro: não altera a lista nem o conjunto recebidos', () => {
    const rows = [row('2026-11')];
    const occupied = new Set(['2026-11']);
    dropOccupied(rows, occupied);
    expect(rows).toHaveLength(1);
    expect([...occupied]).toEqual(['2026-11']);
  });
});
