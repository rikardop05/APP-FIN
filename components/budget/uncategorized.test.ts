import { describe, expect, it } from 'vitest';

import { summarizeUncategorized, uncategorizedTitle, uncategorizedVerb } from './uncategorized';

const row = (competence: string, kind: string, amountCents: number) => ({ competence, kind, amountCents });

describe('despesas sem categoria fora do orçamento', () => {
  it('soma só despesas da competência, em magnitude', () => {
    const summary = summarizeUncategorized(
      [
        row('2026-10', 'expense', -11630),
        row('2026-10', 'expense', -17822),
        row('2026-10', 'income', 740000),
        row('2026-09', 'expense', -99999),
        row('2026-10', 'transfer', -5000),
      ],
      '2026-10',
    );
    expect(summary.count).toBe(2);
    expect(summary.totalCents).toBe(29452);
  });
  it('estorno abate a saída, com piso em zero', () => {
    expect(summarizeUncategorized([row('2026-10', 'expense', -10000), row('2026-10', 'expense', 2500)], '2026-10').totalCents).toBe(7500);
    expect(summarizeUncategorized([row('2026-10', 'expense', 5000)], '2026-10').totalCents).toBe(0);
  });
  it('sem nenhuma, zero', () => {
    expect(summarizeUncategorized([], '2026-10')).toEqual({ count: 0, totalCents: 0 });
  });
  it('o texto concorda no plural', () => {
    expect(uncategorizedTitle(1)).toBe('1 lançamento sem categoria');
    expect(uncategorizedTitle(6)).toBe('6 lançamentos sem categoria');
    expect(uncategorizedVerb(1)).toBe('não entra no orçamento');
    expect(uncategorizedVerb(6)).toBe('não entram no orçamento');
  });
});
