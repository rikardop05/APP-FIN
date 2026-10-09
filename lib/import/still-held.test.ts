import { describe, expect, it } from 'vitest';

import type { CardCycleConfig } from '@/lib/finance/billing';
import { finalizeImport, type ConfirmedRow } from '@/lib/import/pipeline';
import { summarizeStillHeld } from '@/lib/import/still-held';
import { cents } from '@/lib/money';

const CARD: CardCycleConfig = { closingDay: 10, dueDay: 20 };

function confirmed(overrides: Partial<ConfirmedRow>): ConfirmedRow {
  return {
    index: 0,
    include: true,
    occurredOn: '2026-09-05',
    description: 'LOJA SINTETICA',
    rawDescription: 'LOJA SINTETICA',
    amountCents: cents(-1000),
    categoryId: null,
    memberId: null,
    installment: null,
    ...overrides,
  };
}

function stillHeld(rows: ConfirmedRow[]) {
  return summarizeStillHeld(
    finalizeImport({
      rows,
      sourceId: 'card-1',
      sourceKind: 'credit_card',
      cardCycle: CARD,
      existingHashes: new Set<string>(),
      reportedTotalCents: null,
      statementCompetence: '2026-10',
    }),
  );
}

describe('summarizeStillHeld — "Ainda presos"', () => {
  it('lote sem parcela nao prende nada', () => {
    expect(stillHeld([confirmed({})])).toEqual({ months: [], totalCents: 0, count: 0 });
  });

  it('lote vazio nao prende nada', () => {
    expect(stillHeld([])).toEqual({ months: [], totalCents: 0, count: 0 });
  });

  it('agrupa as parcelas FUTURAS por competencia, com total e linhas de origem', () => {
    const result = stillHeld([
      // 2/4 na fatura de 2026-10: presas 3/4 (2026-11) e 4/4 (2026-12).
      confirmed({ index: 0, description: 'MOVEIS', rawDescription: 'MOVEIS', amountCents: cents(-25000), installment: { current: 2, total: 4 } }),
      // 1/2 na fatura de 2026-10: presa 2/2 (2026-11).
      confirmed({ index: 3, description: 'TENIS', rawDescription: 'TENIS', amountCents: cents(-10000), installment: { current: 1, total: 2 } }),
      // Avulsa: nao prende nada.
      confirmed({ index: 4, description: 'PADARIA', rawDescription: 'PADARIA' }),
    ]);

    expect(result.months).toEqual([
      {
        competence: '2026-11',
        totalCents: -35000,
        items: [
          { sourceIndex: 0, description: 'MOVEIS', installmentNumber: 3, installmentsCount: 4, amountCents: -25000 },
          { sourceIndex: 3, description: 'TENIS', installmentNumber: 2, installmentsCount: 2, amountCents: -10000 },
        ],
      },
      {
        competence: '2026-12',
        totalCents: -25000,
        items: [
          { sourceIndex: 0, description: 'MOVEIS', installmentNumber: 4, installmentsCount: 4, amountCents: -25000 },
        ],
      },
    ]);
    expect(result.totalCents).toBe(-60000);
    expect(result.count).toBe(3);
  });

  it('ultima parcela (4/4) nao prende nada', () => {
    expect(stillHeld([confirmed({ installment: { current: 4, total: 4 } })]).count).toBe(0);
  });

  it('segue o que o usuario mudou: linha desmarcada e linha de valor zero nao prendem', () => {
    const result = stillHeld([
      confirmed({ index: 0, include: false, installment: { current: 1, total: 3 } }),
      confirmed({ index: 1, amountCents: cents(0), installment: { current: 1, total: 12 } }),
    ]);
    expect(result).toEqual({ months: [], totalCents: 0, count: 0 });
  });

  it('duas linhas do MESMO plano no lote projetam uma vez, com a origem na primeira', () => {
    const result = stillHeld([
      confirmed({ index: 0, occurredOn: '2026-09-01', installment: { current: 1, total: 3 } }),
      confirmed({ index: 1, occurredOn: '2026-09-02', installment: { current: 2, total: 3 } }),
    ]);
    expect(result.count).toBe(2);
    expect(result.months.flatMap((month) => month.items.map((item) => item.sourceIndex))).toEqual([0, 0]);
  });
});
