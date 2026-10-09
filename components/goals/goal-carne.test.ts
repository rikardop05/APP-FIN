import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { goalInstallments, splitInstallments } from './goal-carne';

describe('meta como carnê', () => {
  it('um canhoto por mês, o último no mês da data-alvo', () => {
    const list = goalInstallments({ targetDate: '2027-03-15', months: 3, requiredMonthlyCents: cents(50_000) });
    expect(list.map((item) => [item.number, item.total, item.competence])).toEqual([
      [1, 3, '2027-01'],
      [2, 3, '2027-02'],
      [3, 3, '2027-03'],
    ]);
    expect(list.every((item) => item.amountCents === 50_000)).toBe(true);
  });

  it('atravessa a virada do ano', () => {
    const list = goalInstallments({ targetDate: '2027-02-10', months: 4, requiredMonthlyCents: cents(1) });
    expect(list[0]?.competence).toBe('2026-11');
    expect(list[3]?.competence).toBe('2027-02');
  });

  it('sem meses, sem canhotos', () => {
    expect(goalInstallments({ targetDate: '2027-03-15', months: 0, requiredMonthlyCents: cents(1) })).toEqual([]);
  });

  it('mostra os 4 primeiros e esconde o resto', () => {
    const list = goalInstallments({ targetDate: '2027-12-01', months: 10, requiredMonthlyCents: cents(1) });
    const { visible, hidden } = splitInstallments(list);
    expect(visible).toHaveLength(4);
    expect(hidden).toHaveLength(6);
  });
});
