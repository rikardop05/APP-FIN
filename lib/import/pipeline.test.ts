import { describe, expect, it } from 'vitest';

import type { Competence } from '@/lib/date';
import type { CardCycleConfig } from '@/lib/finance/billing';
import type { Rule } from '@/lib/finance/categorization';
import { dedupeHash } from '@/lib/finance/dedupe';
import {
  buildImportPreview,
  finalizeImport,
  matchRuleForAmount,
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

function preview(
  rows: ParsedRow[],
  overrides?: {
    rules?: Rule[];
    existingHashes?: Set<string>;
    cardCycle?: CardCycleConfig | null;
    sourceKind?: 'credit_card' | 'account';
    statementCompetence?: Competence | null;
  },
) {
  return buildImportPreview({
    parse: parseResult(rows),
    sourceId: SOURCE_ID,
    sourceKind: overrides?.sourceKind ?? 'credit_card',
    cardCycle: overrides?.cardCycle === undefined ? CARD : overrides.cardCycle,
    rules: overrides?.rules ?? [],
    existingHashes: overrides?.existingHashes ?? new Set<string>(),
    today: '2026-09-20',
    statementCompetence: overrides?.statementCompetence ?? null,
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
    statementCompetence: null,
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

describe('buildImportPreview — pagamento da fatura anterior (gate T-116)', () => {
  const pagamento = parsed({
    occurredOn: '2026-09-07',
    rawDescription: 'Pagamento em 07 ago',
    amountCents: cents(120896),
    creditCardPayment: true,
  });

  it('no cartao, marca a linha como credit_card_payment e a mantem na contagem', () => {
    const result = preview([
      pagamento,
      parsed({ occurredOn: '2026-09-10', rawDescription: 'PADARIA ANONIMA', amountCents: cents(-1000) }),
    ]);

    expect(result.rows[0]?.state).toBe('credit_card_payment');
    expect(result.rows[1]?.state).toBe('new');
    // Nao e duplicata: entra em rowsNew e a invariante do §15 segue valendo.
    expect(result.summary.rowsNew + result.summary.rowsDuplicated).toBe(
      result.summary.rowsRead,
    );
    expect(result.summary.rowsNew).toBe(2);
  });

  it('na CONTA, a mesma linha e lancamento normal — nao e desmarcada', () => {
    // Numa conta, a linha de pagamento e onde a RF-CC-04 manda registra-la:
    // pre-desmarcar aqui excluiria do unico lugar a que ela pertence.
    const result = preview(
      [
        pagamento,
        parsed({ occurredOn: '2026-09-10', rawDescription: 'PADARIA ANONIMA', amountCents: cents(-1000) }),
      ],
      { sourceKind: 'account' },
    );

    expect(result.rows[0]?.state).toBe('new');
    expect(result.summary.rowsNew + result.summary.rowsDuplicated).toBe(
      result.summary.rowsRead,
    );
    expect(result.summary.rowsNew).toBe(2);
  });

  it('na conta, uma parcelada marcada segue o caminho normal de parcela', () => {
    const result = preview(
      [
        parsed({
          occurredOn: '2026-09-07',
          rawDescription: 'Pagamento em 07 ago 03/10',
          amountCents: cents(120896),
          creditCardPayment: true,
        }),
      ],
      { sourceKind: 'account' },
    );

    expect(result.rows[0]?.state).toBe('installment_part');
  });
});

describe('competencia da fatura e projecao de parcelas (decisao do Ricardo)', () => {
  // Santander fecha antes do dia 11 (por isso a compra de 11/10 cai na fatura de
  // novembro) — reproduz o caso real da parcela 11/12.
  const CARD_SANTANDER: CardCycleConfig = { closingDay: 10, dueDay: 20 };
  const parcela = parsed({
    occurredOn: '2025-10-11',
    rawDescription: 'CARTAO DE TODOS Parcela 11/12',
    amountCents: cents(-260),
  });

  it('a linha de cartao recebe a competencia da FATURA, nao a da compra', () => {
    const result = preview([parcela], {
      statementCompetence: '2026-09',
      cardCycle: CARD_SANTANDER,
    });

    expect(result.rows[0]?.occurredOn).toBe('2025-10-11');
    expect(result.rows[0]?.competence).toBe('2026-09');
    expect(result.rows[0]?.installment).toEqual({ current: 11, total: 12 });
  });

  it('sem competencia da fatura, segue derivando de occurredOn (fallback)', () => {
    const result = preview([parcela], { cardCycle: CARD_SANTANDER });
    expect(result.rows[0]?.competence).toBe('2025-11');
  });

  it('na conta, a competencia continua vindo da data (campo ignorado)', () => {
    const result = preview([parcela], {
      sourceKind: 'account',
      statementCompetence: '2026-09',
      cardCycle: CARD_SANTANDER,
    });
    expect(result.rows[0]?.competence).toBe('2025-10');
  });

  it('projecao: 11/12 em 2026-09 sobra so a 12a, em 2026-10', () => {
    const result = finalize(
      [
        confirmed({
          occurredOn: '2025-10-11',
          description: 'CARTAO DE TODOS',
          rawDescription: 'CARTAO DE TODOS Parcela 11/12',
          amountCents: cents(-260),
          installment: { current: 11, total: 12 },
        }),
      ],
      { statementCompetence: '2026-09', cardCycle: CARD_SANTANDER },
    );

    expect(result.installmentPlans).toEqual([
      {
        ref: 1,
        description: 'CARTAO DE TODOS',
        totalCents: cents(-3120),
        installmentsCount: 12,
        firstCompetence: '2025-11',
        categoryId: null,
      },
    ]);
    expect(result.transactions).toHaveLength(2);

    const confirmedTx = result.transactions.find(
      (transaction) => transaction.installmentNumber === 11,
    );
    expect(confirmedTx).toMatchObject({
      competence: '2026-09',
      occurredOn: '2025-10-11',
      cashDate: '2026-09-20',
    });

    const projected = result.transactions.find(
      (transaction) => transaction.installmentNumber === 12,
    );
    expect(projected?.competence).toBe('2026-10');
    expect(projected?.cashDate).toBe('2026-10-20');
  });
});

describe('buildImportPreview — data do documento (base do aviso da tela)', () => {
  it('carrega documentDate do parser ate o preview, com o kind', () => {
    const result = buildImportPreview({
      parse: {
        rows: [parsed({})],
        diagnostics: [],
        reportedTotalCents: null,
        documentDate: { date: '2026-07-20', kind: 'due_date' },
      },
      sourceId: SOURCE_ID,
      sourceKind: 'credit_card',
      cardCycle: CARD,
      rules: [],
      existingHashes: new Set<string>(),
      today: '2026-09-30',
      statementCompetence: null,
    });

    expect(result.documentDate).toEqual({ date: '2026-07-20', kind: 'due_date' });
  });

  it('sem data no documento, o preview devolve null', () => {
    expect(preview([parsed({})]).documentDate).toBeNull();
  });
});

describe('buildImportPreview — total impresso (vai ate o commit)', () => {
  it('carrega reportedTotalCents do parser ate o preview', () => {
    const result = buildImportPreview({
      parse: { rows: [parsed({})], diagnostics: [], reportedTotalCents: cents(-1000) },
      sourceId: SOURCE_ID,
      sourceKind: 'credit_card',
      cardCycle: CARD,
      rules: [],
      existingHashes: new Set<string>(),
      today: '2026-09-30',
      statementCompetence: null,
    });

    expect(result.reportedTotalCents).toBe(-1000);
  });

  it('sem total impresso (texto colado), o preview devolve null', () => {
    expect(preview([parsed({})]).reportedTotalCents).toBeNull();
  });
});

describe('linha de valor zero e informativa (decisao 8)', () => {
  const anuidade = parsed({
    rawDescription: 'ANUIDADE DIFERENCIADA',
    amountCents: cents(0),
    installment: { current: 1, total: 12 },
    informational: true,
  });

  it('no preview, nao conta plano nem vira estado de parcela: e a linha informativa', () => {
    const result = preview([anuidade]);
    expect(result.rows[0]?.state).toBe('informational');
    expect(result.summary.installmentPlansDetected).toBe(0);
  });

  it('no preview, mantem a parcela lida: se o usuario corrigir o valor, o plano nao se perde', () => {
    const result = preview([anuidade]);
    expect(result.rows[0]?.installment).toEqual({ current: 1, total: 12 });

    const corrigida = finalize([
      confirmed({ amountCents: cents(-4000), installment: { current: 1, total: 12 } }),
    ]);
    expect(corrigida.installmentPlans).toHaveLength(1);
    expect(corrigida.installmentPlans[0]?.installmentsCount).toBe(12);
  });

  it('no preview, segue na contagem (invariante do §15) mas nao pede categoria', () => {
    const result = preview([anuidade, parsed({})]);
    expect(result.summary.rowsNew + result.summary.rowsDuplicated).toBe(
      result.summary.rowsRead,
    );
    expect(result.summary.uncategorizedCount).toBe(1);
  });

  it('no finalize, valor CONFIRMADO zero nao vira lancamento nem plano', () => {
    const result = finalize([
      confirmed({ index: 0, amountCents: cents(0), installment: { current: 1, total: 12 } }),
      confirmed({ index: 1, rawDescription: 'LOJA', description: 'LOJA' }),
    ]);
    expect(result.installmentPlans).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions.every((t) => t.amountCents !== 0)).toBe(true);
    expect(result.skipped).toEqual([{ index: 0, reason: 'informational' }]);
    expect(result.totals.includedCents).toBe(-1000);
  });

  it('o que conta e o valor confirmado: zero editado para um valor entra', () => {
    const result = finalize([confirmed({ amountCents: cents(-500) })]);
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it('linha desmarcada pelo usuario continua excluded_by_user, mesmo sendo zero', () => {
    const result = finalize([confirmed({ include: false, amountCents: cents(0) })]);
    expect(result.skipped).toEqual([{ index: 0, reason: 'excluded_by_user' }]);
  });

  it('decisao 9a intacta: duas linhas identicas com valor, a segunda e duplicata', () => {
    const result = finalize([confirmed({ index: 0 }), confirmed({ index: 1 })]);
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toEqual([{ index: 1, reason: 'duplicate' }]);
  });
});

describe('buildImportPreview — membro pelo final do cartao (decisao 20)', () => {
  const MEMBRO_A = '11111111-1111-4111-8111-111111111111';
  const MEMBRO_B = '22222222-2222-4222-8222-222222222222';
  const holders = new Map([['4239', MEMBRO_A], ['2387', MEMBRO_B]]);

  function previewWith(rows: ParsedRow[], rules: Rule[] = []) {
    return buildImportPreview({
      parse: parseResult(rows),
      sourceId: SOURCE_ID,
      sourceKind: 'credit_card',
      cardCycle: CARD,
      rules,
      existingHashes: new Set<string>(),
      today: '2026-09-20',
      statementCompetence: null,
      cardHolders: holders,
    });
  }

  it('preenche suggestedMemberId pelo final mapeado', () => {
    const result = previewWith([
      parsed({ cardLast4: '4239' }),
      parsed({ cardLast4: '2387', rawDescription: 'FARMACIA' }),
    ]);
    expect(result.rows.map((row) => row.suggestedMemberId)).toEqual([MEMBRO_A, MEMBRO_B]);
  });

  it('final sem mapeamento, ou linha sem final, fica sem membro', () => {
    const result = previewWith([parsed({ cardLast4: '9999' }), parsed({ rawDescription: 'X' })]);
    expect(result.rows.map((row) => row.suggestedMemberId)).toEqual([null, null]);
  });

  it('regra com membro explicito vence o cartao; regra sem membro deixa o cartao preencher', () => {
    const comMembro: Rule = {
      id: 'r1', matchType: 'contains', pattern: 'PADARIA', categoryId: 'cat-1',
      memberId: MEMBRO_B, priority: 1, active: true,
    };
    const semMembro: Rule = { ...comMembro, id: 'r2', pattern: 'FARMACIA', memberId: null };
    const result = previewWith(
      [
        parsed({ cardLast4: '4239', rawDescription: 'PADARIA ANONIMA' }),
        parsed({ cardLast4: '4239', rawDescription: 'FARMACIA ANONIMA' }),
      ],
      [comMembro, semMembro],
    );
    expect(result.rows[0]?.suggestedMemberId).toBe(MEMBRO_B);
    expect(result.rows[1]?.suggestedMemberId).toBe(MEMBRO_A);
    expect(result.rows[1]?.suggestedCategoryId).toBe('cat-1');
  });

  it('sem mapa (opcional), nada muda', () => {
    const result = preview([parsed({ cardLast4: '4239' })]);
    expect(result.rows[0]?.suggestedMemberId).toBeNull();
  });
});

describe('buildImportPreview — cardHolders so vale em cartao (revisao do Corvo, f57fd92)', () => {
  it('numa CONTA o mapa e ignorado, mesmo que o chamador o passe', () => {
    const result = buildImportPreview({
      parse: parseResult([parsed({ cardLast4: '4239' })]),
      sourceId: SOURCE_ID,
      sourceKind: 'account',
      cardCycle: null,
      rules: [],
      existingHashes: new Set<string>(),
      today: '2026-09-20',
      statementCompetence: null,
      cardHolders: new Map([['4239', '11111111-1111-4111-8111-111111111111']]),
    });
    expect(result.rows[0]?.suggestedMemberId).toBeNull();
  });
});

describe('buildImportPreview — natureza da categoria x sinal da linha', () => {
  const base = { matchType: 'contains' as const, memberId: null, active: true };
  const salario: Rule = { ...base, id: 'r-salario', pattern: 'PIX', categoryId: 'cat-salario', priority: 1, categoryNature: 'income' };
  const mercado: Rule = { ...base, id: 'r-mercado', pattern: 'PIX', categoryId: 'cat-mercado', priority: 2, categoryNature: 'essential' };

  it('despesa pula a regra de categoria de receita e cai na proxima', () => {
    const result = preview([parsed({ rawDescription: 'PIX ENVIADO', amountCents: cents(-5000) })], { rules: [salario, mercado] });
    expect(result.rows[0]?.suggestedCategoryId).toBe('cat-mercado');
  });

  it('receita pula a regra de categoria de despesa', () => {
    const result = preview([parsed({ rawDescription: 'PIX RECEBIDO', amountCents: cents(5000) })], { rules: [mercado, { ...salario, priority: 3 }] });
    expect(result.rows[0]?.suggestedCategoryId).toBe('cat-salario');
  });

  it('sem regra compativel, fica sem sugestao (e sem membro da regra)', () => {
    const result = preview([parsed({ rawDescription: 'PIX ENVIADO', amountCents: cents(-5000) })], { rules: [{ ...salario, memberId: 'm-1' }] });
    expect(result.rows[0]?.suggestedCategoryId).toBeNull();
    expect(result.rows[0]?.suggestedMemberId).toBeNull();
  });

  it('regra sem natureza conhecida continua valendo (sem conferencia)', () => {
    const { categoryNature: _ignored, ...semNatureza } = salario;
    const result = preview([parsed({ rawDescription: 'PIX ENVIADO', amountCents: cents(-5000) })], { rules: [semNatureza] });
    expect(result.rows[0]?.suggestedCategoryId).toBe('cat-salario');
  });

  it('valor nao lido ou zero: sinal desconhecido, sem conferencia', () => {
    const result = preview(
      [
        parsed({ rawDescription: 'PIX X', amountCents: null }),
        parsed({ rawDescription: 'PIX Y', amountCents: cents(0) }),
      ],
      { rules: [salario] },
    );
    expect(result.rows.map((row) => row.suggestedCategoryId)).toEqual(['cat-salario', 'cat-salario']);
  });
});

describe('matchRuleForAmount', () => {
  const base = { matchType: 'contains' as const, memberId: null, active: true };
  const salario: Rule = { ...base, id: 'a', pattern: 'PIX', categoryId: 'c-in', priority: 1, categoryNature: 'income' };
  const mercado: Rule = { ...base, id: 'b', pattern: 'PIX', categoryId: 'c-out', priority: 2, categoryNature: 'non_essential' };

  it('escolhe pela prioridade entre as compativeis com o sinal', () => {
    expect(matchRuleForAmount([salario, mercado], 'PIX', cents(-1))?.id).toBe('b');
    expect(matchRuleForAmount([salario, mercado], 'PIX', cents(1))?.id).toBe('a');
  });

  it('sem regra que case devolve null', () => {
    expect(matchRuleForAmount([salario], 'OUTRA COISA', cents(-1))).toBeNull();
  });
});
