import { describe, expect, it } from 'vitest';
import type { Cents } from '@/lib/money';
import { futureStubsForCard } from './card-stubs';

const c = (n: number) => n as Cents;
const CARD = { id: 'card-a', name: 'Santander', closingDay: 1, dueDay: 7 };

const tx = (competence: string, amount: number, extra: { installment?: boolean; card?: string } = {}) => ({
  competence,
  amountCents: c(amount),
  creditCardId: extra.card ?? CARD.id,
  status: 'planned' as const,
  installment: extra.installment ?? true,
});

describe('canhotos presos por cartão', () => {
  it('só meses devedores do próprio cartão, com o vencimento do ciclo', () => {
    const stubs = futureStubsForCard({
      card: CARD,
      transactions: [tx('2026-11', -56125), tx('2026-12', -56125), tx('2026-12', -9999, { card: 'outro' })],
      statementPeriods: [],
      fromCompetence: '2026-10',
      months: 6,
    });
    expect(stubs.map((s) => s.competence)).toEqual(['2026-11', '2026-12']);
    expect(stubs[0]?.dueDate).toBe('2026-11-07');
    expect(stubs[1]?.totalCents).toBe(-56125);
    expect(stubs[0]?.installmentCents).toBe(-56125);
  });

  it('mês com fatura já gravada não vira canhoto preso (a fatura já o mostra)', () => {
    const stubs = futureStubsForCard({
      card: CARD,
      transactions: [tx('2026-10', -1000), tx('2026-11', -2000)],
      statementPeriods: ['2026-10'],
      fromCompetence: '2026-10',
      months: 6,
    });
    expect(stubs.map((s) => s.competence)).toEqual(['2026-11']);
  });

  it('mês só com estorno não é comprometimento', () => {
    const stubs = futureStubsForCard({
      card: CARD,
      transactions: [tx('2026-11', 500, { installment: false })],
      statementPeriods: [],
      fromCompetence: '2026-10',
      months: 3,
    });
    expect(stubs).toEqual([]);
  });
});
