import { describe, expect, it } from 'vitest';

import type { CardCycleConfig } from '@/lib/finance/billing';
import type { Rule } from '@/lib/finance/categorization';
import { dedupeHash } from '@/lib/finance/dedupe';
import {
  buildImportPreview,
  finalizeImport,
  type ConfirmedRow,
  type FinalizeInput,
} from '@/lib/import/pipeline';
import type { ParsedRow, ParseResult } from '@/lib/import/types';
import { cents, type Cents } from '@/lib/money';

const CARD: CardCycleConfig = { closingDay: 15, dueDay: 25 };
const SOURCE_ID = 'source-1';

function parsed(overrides: Partial<ParsedRow>): ParsedRow {
  return {
    occurredOn: '2026-09-10',
    rawDescription: 'PADARIA ANONIMA',
    amountCents: cents(-1000),
    fitId: null,
    installment: null,
    ...overrides,
  };
}

function parseResult(rows: ParsedRow[]): ParseResult {
  return { rows, diagnostics: [], reportedTotalCents: null };
}

function preview(rows: ParsedRow[], overrides?: {
  rules?: Rule[];
  existingHashes?: Set<string>;
  cardCycle?: CardCycleConfig | null;
  sourceKind?: 'credit_card' | 'account';
}) {
  return buildImportPreview({
    parse: parseResult(rows),
    sourceId: SOURCE_ID,
    sourceKind: overrides?.sourceKind ?? 'credit_card',
    cardCycle: overrides?.cardCycle === undefined ? CARD : overrides.cardCycle,
    rules: overrides?.rules ?? [],
    existingHashes: overrides?.existingHashes ?? new Set<string>(),
    today: '2026-09-20',
  });
}

function confirmed(overrides: Partial<ConfirmedRow>): ConfirmedRow {
  return {
    index: 0,
    include: true,
    occurredOn: '2026-09-10',
    description: 'PADARIA ANONIMA',
    rawDescription: 'PADARIA ANONIMA',
    amountCents: cents(-1000),
    categoryId: null,
    memberId: null,
    installment: null,
    ...overrides,
  };
}

function finalize(rows: ConfirmedRow[], overrides?: Partial<FinalizeInput>) {
  return finalizeImport({
    rows,
    sourceId: SOURCE_ID,
    sourceKind: 'credit_card',
    cardCycle: CARD,
    existingHashes: new Set<string>(),
    reportedTotalCents: null,
    ...overrides,
  });
}

describe('buildImportPreview — aceite 1: summary exato', () => {
  it('1 duplicata + 1 parcelada em 10x + 3 novas produz o summary esperado', () => {
    const duplicada = parsed({
      occurredOn: '2026-09-12',
      rawDescription: 'DUPLICADA ANONIMA',
      amountCents: cents(-5000),
    });
    const existingHashes = new Set([
      dedupeHash({
        sourceId: SOURCE_ID,
        occurredOn: '2026-09-12',
        amountCents: cents(-5000),
        rawDescription: 'DUPLICADA ANONIMA',
      }),
    ]);

    const result = preview(
      [
        parsed({ occurredOn: '2026-09-10', rawDescription: 'NOVA UM', amountCents: cents(-1000) }),
        parsed({ occurredOn: '2026-09-11', rawDescription: 'NOVA DOIS', amountCents: cents(-2000) }),
        parsed({ occurredOn: '2026-09-13', rawDescription: 'NOVA TRES', amountCents: cents(-3000) }),
        parsed({
          occurredOn: '2026-09-10',
          rawDescription: 'MAGAZINE PARCELA 03/10',
          amountCents: cents(-25000),
        }),
        duplicada,
      ],
      { existingHashes },
    );

    expect(result.summary).toEqual({
      rowsRead: 5,
      rowsNew: 4,
      rowsDuplicated: 1,
      installmentPlansDetected: 1,
      totalCents: cents(-31000),
      uncategorizedCount: 4,
    });
    expect(result.rows.map((row) => row.state)).toEqual([
      'new',
      'new',
      'new',
      'installment_part',
      'duplicate',
    ]);
  });

  it('invariante: rowsNew + rowsDuplicated === rowsRead em qualquer lote', () => {
    const dup = parsed({
      occurredOn: '2026-09-12',
      rawDescription: 'DUPLICADA ANONIMA',
      amountCents: cents(-5000),
    });
    const dupHash = dedupeHash({
      sourceId: SOURCE_ID,
      occurredOn: '2026-09-12',
      amountCents: cents(-5000),
      rawDescription: 'DUPLICADA ANONIMA',
    });

    const batches: { rows: ParsedRow[]; existingHashes: Set<string> }[] = [
      { rows: [], existingHashes: new Set<string>() },
      { rows: [parsed({})], existingHashes: new Set<string>() },
      {
        rows: [parsed({}), parsed({ occurredOn: '2026-09-11' })],
        existingHashes: new Set<string>(),
      },
      {
        rows: [
          dup,
          parsed({ occurredOn: '2026-09-13' }),
          parsed({ rawDescription: 'MAGAZINE PARCELA 1 DE 3', amountCents: cents(-9000) }),
          parsed({ occurredOn: null, amountCents: cents(-100) }),
        ],
        existingHashes: new Set([dupHash]),
      },
      { rows: [dup, dup, parsed({})], existingHashes: new Set([dupHash]) },
    ];

    for (const batch of batches) {
      const result = preview(batch.rows, { existingHashes: batch.existingHashes });
      expect(
        result.summary.rowsNew + result.summary.rowsDuplicated,
      ).toBe(result.summary.rowsRead);
    }
  });
});

describe('buildImportPreview — aceite 2: desempate parcela x data', () => {
  it('03/10 numa linha de 2026-10-03 e DATA, nao parcela', () => {
    const result = preview([
      parsed({
        occurredOn: '2026-10-03',
        rawDescription: 'PADARIA 03/10',
        amountCents: cents(-500),
      }),
    ]);

    expect(result.rows[0]?.installment).toBeNull();
    expect(result.rows[0]?.description).toBe('PADARIA 03/10');
    expect(result.rows[0]?.state).toBe('new');
  });

  it('a mesma descricao numa linha de outra data continua sendo parcela', () => {
    const result = preview([
      parsed({
        occurredOn: '2026-09-15',
        rawDescription: 'PADARIA 03/10',
        amountCents: cents(-500),
      }),
    ]);

    expect(result.rows[0]?.installment).toEqual({ current: 3, total: 10 });
    expect(result.rows[0]?.description).toBe('PADARIA');
    expect(result.rows[0]?.state).toBe('installment_part');
  });

  it('primeira parcela vira installment_first', () => {
    const result = preview([
      parsed({ rawDescription: 'MAGAZINE PARCELA 1 DE 10', amountCents: cents(-1000) }),
    ]);
    expect(result.rows[0]?.state).toBe('installment_first');
  });
});

describe('buildImportPreview — competencia, categorizacao e incompletas', () => {
  it('cartao usa o ciclo da fatura; conta usa o mes do fato', () => {
    const card = preview([parsed({ occurredOn: '2026-09-20' })]);
    expect(card.rows[0]?.competence).toBe('2026-10');

    const account = preview([parsed({ occurredOn: '2026-09-20' })], {
      sourceKind: 'account',
    });
    expect(account.rows[0]?.competence).toBe('2026-09');
  });

  it('sugere categoria e responsavel pela regra', () => {
    const rules: Rule[] = [
      {
        id: 'r1',
        pattern: 'padaria',
        matchType: 'contains',
        categoryId: 'cat-padaria',
        memberId: 'mem-1',
        priority: 100,
        active: true,
      },
    ];
    const result = preview([parsed({ rawDescription: 'PADARIA DO ZE' })], { rules });

    expect(result.rows[0]?.suggestedCategoryId).toBe('cat-padaria');
    expect(result.rows[0]?.suggestedMemberId).toBe('mem-1');
    expect(result.summary.uncategorizedCount).toBe(0);
  });

  it('linha incompleta nao some: volta com null no campo que faltou', () => {
    const result = preview([
      parsed({ occurredOn: null, rawDescription: 'SEM DATA', amountCents: cents(-500) }),
      parsed({ occurredOn: '2026-09-10', rawDescription: 'SEM VALOR', amountCents: null }),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      occurredOn: null,
      competence: null,
      dedupeHash: null,
      amountCents: cents(-500),
      state: 'new',
    });
    expect(result.rows[1]).toMatchObject({
      occurredOn: '2026-09-10',
      competence: '2026-09',
      dedupeHash: null,
      amountCents: null,
    });
    // A incompleta entra em uncategorized, mas nao soma no total do lote.
    expect(result.summary.uncategorizedCount).toBe(2);
    expect(result.summary.totalCents).toBe(cents(-500));
  });
});

describe('finalizeImport — aceite 3: invariantes do §16', () => {
  it('editar a data muda a competencia E o hash', () => {
    const base = finalize([confirmed({ occurredOn: '2026-09-10' })]);
    const edited = finalize([confirmed({ occurredOn: '2026-09-20' })]);

    expect(base.transactions[0]?.competence).toBe('2026-09');
    expect(edited.transactions[0]?.competence).toBe('2026-10');
    expect(base.transactions[0]?.dedupeHash).not.toBe(
      edited.transactions[0]?.dedupeHash,
    );
  });

  it('editar o valor muda o hash E o total do lote', () => {
    const base = finalize([confirmed({ amountCents: cents(-1000) })]);
    const edited = finalize([confirmed({ amountCents: cents(-2000) })]);

    expect(base.transactions[0]?.dedupeHash).not.toBe(
      edited.transactions[0]?.dedupeHash,
    );
    expect(base.totals.includedCents).toBe(cents(-1000));
    expect(edited.totals.includedCents).toBe(cents(-2000));
  });

  it('excluir uma linha a remove de transactions e a lista em skipped', () => {
    const result = finalize([
      confirmed({ index: 0 }),
      confirmed({ index: 1, include: false }),
    ]);

    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toEqual([{ index: 1, reason: 'excluded_by_user' }]);
  });

  it('linha duplicada vai para skipped, salvo forceDuplicate', () => {
    const hash = dedupeHash({
      sourceId: SOURCE_ID,
      occurredOn: '2026-09-10',
      amountCents: cents(-1000),
      rawDescription: 'PADARIA ANONIMA',
    });
    const existingHashes = new Set([hash]);

    const skipped = finalize([confirmed({ index: 0 })], { existingHashes });
    expect(skipped.transactions).toEqual([]);
    expect(skipped.skipped).toEqual([{ index: 0, reason: 'duplicate' }]);

    const forced = finalize([confirmed({ index: 0, forceDuplicate: true })], {
      existingHashes,
    });
    expect(forced.transactions).toHaveLength(1);
  });
});

describe('finalizeImport — planos de parcela e totais', () => {
  it('cria o plano e projeta as parcelas futuras como transacoes filhas', () => {
    const result = finalize([
      confirmed({
        occurredOn: '2026-09-10',
        description: 'MAGAZINE',
        rawDescription: 'MAGAZINE PARCELA 03/10',
        amountCents: cents(-25000),
        installment: { current: 3, total: 10 },
      }),
    ]);

    expect(result.installmentPlans).toEqual([
      {
        ref: 1,
        description: 'MAGAZINE',
        totalCents: cents(-250000),
        installmentsCount: 10,
        firstCompetence: '2026-07',
        categoryId: null,
      },
    ]);

    // A parcela confirmada (3) + as futuras (4..10).
    expect(result.transactions).toHaveLength(8);
    const current = result.transactions.find((t) => t.installmentNumber === 3);
    expect(current).toMatchObject({
      competence: '2026-09',
      cashDate: '2026-09-25',
      installmentPlanRef: 1,
      amountCents: cents(-25000),
    });
    const future = result.transactions.filter((t) => t.installmentNumber !== 3);
    expect(future.map((t) => t.competence)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
    // So a linha confirmada soma no total do lote.
    expect(result.totals.includedCents).toBe(cents(-25000));
  });

  it('confere o total do lote contra o total informado', () => {
    const match = finalize([confirmed({ amountCents: cents(-1000) })], {
      reportedTotalCents: cents(-1000),
    });
    expect(match.totals).toEqual({
      includedCents: cents(-1000),
      reportedCents: cents(-1000),
      differenceCents: cents(0),
      matches: true,
    });

    const diverge = finalize([confirmed({ amountCents: cents(-1000) })], {
      reportedTotalCents: cents(-800),
    });
    expect(diverge.totals.matches).toBe(false);
    expect(diverge.totals.differenceCents).toBe(cents(-200));
  });

  it('sem total informado, a diferenca e null (nao ha o que conferir)', () => {
    const result = finalize([confirmed({})], { reportedTotalCents: null });
    expect(result.totals.differenceCents).toBeNull();
    expect(result.totals.matches).toBeNull();
  });

  it('conta usa a propria data como saida de caixa', () => {
    const result = finalize([confirmed({ occurredOn: '2026-09-10' })], {
      sourceKind: 'account',
      cardCycle: null,
    });
    expect(result.transactions[0]?.cashDate).toBe('2026-09-10');
    expect(result.transactions[0]?.competence).toBe('2026-09');
  });
});

describe('finalizeImport — roda sem tocar banco', () => {
  it('e uma funcao pura: mesma entrada, mesma saida', () => {
    const row = confirmed({ amountCents: cents(-1000) as Cents });
    const a = finalize([row]);
    const b = finalize([row]);
    expect(a).toEqual(b);
  });
});
