import { describe, expect, it } from 'vitest';

import {
  expandRecurrence,
  type PlannedOccurrence,
  type RecurrenceInput,
} from '@/lib/finance/recurrence';
import { addCents, basisPoints, cents } from '@/lib/money';

/** Base mensal sem reajuste, sobrescrita em cada caso. */
function input(overrides: Partial<RecurrenceInput>): RecurrenceInput {
  return {
    expectedCents: cents(-150000),
    dueDay: 5,
    frequency: 'monthly',
    startsOn: '2026-03-05',
    endsOn: null,
    annualAdjustmentBp: null,
    ...overrides,
  };
}

function amounts(occ: PlannedOccurrence[]): number[] {
  return occ.map((o) => o.amountCents);
}

describe('expandRecurrence — cadencia mensal e dia 31', () => {
  it('mensal gera uma ocorrencia por competencia da janela, com o mesmo valor', () => {
    const occ = expandRecurrence(
      input({ expectedCents: cents(-150000), dueDay: 5, startsOn: '2026-03-05' }),
      { from: '2026-03', months: 3 },
    );

    expect(occ.map((o) => o.competence)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(occ.map((o) => o.date)).toEqual([
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
    ]);
    // Despesa de R$ 1.500,00, sem reajuste: repete o valor.
    expect(amounts(occ)).toEqual([-150000, -150000, -150000]);
  });

  it('dia 31 cai em 28 em fevereiro e VOLTA a 31 em marco (nao gruda no 28)', () => {
    // 2026 nao e bissexto -> fevereiro tem 28 dias. A ancora e o dia 31 pedido,
    // recalculada a cada mes: fev=28, mar=31, abr=30.
    const occ = expandRecurrence(
      input({ expectedCents: cents(-5000), dueDay: 31, startsOn: '2026-01-31' }),
      { from: '2026-01', months: 4 },
    );

    expect(occ.map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('dia 31 em fevereiro bissexto cai em 29', () => {
    // 2024 e bissexto (divisivel por 4, nao por 100) -> 29/02/2024.
    const occ = expandRecurrence(
      input({ expectedCents: cents(-5000), dueDay: 31, startsOn: '2024-01-31' }),
      { from: '2024-01', months: 3 },
    );

    expect(occ.map((o) => o.date)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
  });

  it('a primeira ocorrencia e o primeiro dueDay em startsOn ou depois', () => {
    // startsOn 31/03, dueDay 15: a de marco (15/03) e anterior ao inicio e nao
    // entra; a serie comeca em 15/04 e segue mensal.
    const occ = expandRecurrence(
      input({ dueDay: 15, startsOn: '2026-03-31' }),
      { from: '2026-03', months: 3 },
    );

    expect(occ.map((o) => o.date)).toEqual(['2026-04-15', '2026-05-15']);
  });

  it('cadencia bimestral e ancorada na competencia de startsOn', () => {
    // startsOn 10/03, dueDay 5, bimestral: mar (05/03) e anterior ao inicio.
    // Ancorada em marco -> mai, jul, set (passo 2 a partir de marco).
    const occ = expandRecurrence(
      input({ dueDay: 5, frequency: 'bimonthly', startsOn: '2026-03-10' }),
      { from: '2026-03', months: 7 },
    );

    expect(occ.map((o) => o.competence)).toEqual(['2026-05', '2026-07', '2026-09']);
    expect(occ.map((o) => o.date)).toEqual([
      '2026-05-05',
      '2026-07-05',
      '2026-09-05',
    ]);
  });

  it('trimestral gera uma ocorrencia a cada 3 competencias', () => {
    const occ = expandRecurrence(
      input({ dueDay: 15, frequency: 'quarterly', startsOn: '2026-01-15' }),
      { from: '2026-01', months: 12 },
    );

    expect(occ.map((o) => o.competence)).toEqual([
      '2026-01',
      '2026-04',
      '2026-07',
      '2026-10',
    ]);
  });
});

describe('expandRecurrence — one_off', () => {
  it('gera exatamente UMA ocorrencia, na competencia eventual', () => {
    const occ = expandRecurrence(
      input({
        expectedCents: cents(350000),
        dueDay: 20,
        frequency: 'one_off',
        startsOn: '2026-03-01',
        oneOffCompetence: '2026-12',
      }),
      { from: '2026-01', months: 12 },
    );

    expect(occ).toHaveLength(1);
    expect(occ[0]?.competence).toBe('2026-12');
    expect(occ[0]?.date).toBe('2026-12-20');
    // Receita eventual (13o): positiva, sem reajuste.
    expect(occ[0]?.amountCents).toBe(350000);
  });

  it('sem oneOffCompetence: primeiro dueDay em startsOn ou depois (mesmo piso da recorrencia)', () => {
    // startsOn 15/07, dueDay 10: 10/07 cai antes do inicio, entao a ocorrencia
    // e 10/08 — a mesma regra da recorrencia, sem caso especial (CONTRACTS §8).
    const occ = expandRecurrence(
      input({
        dueDay: 10,
        frequency: 'one_off',
        startsOn: '2026-07-15',
      }),
      { from: '2026-07', months: 3 },
    );

    expect(occ).toHaveLength(1);
    expect(occ[0]?.competence).toBe('2026-08');
    expect(occ[0]?.date).toBe('2026-08-10');
  });

  it('sem oneOffCompetence: dueDay em startsOn ou depois cai no proprio mes', () => {
    const occ = expandRecurrence(
      input({
        dueDay: 10,
        frequency: 'one_off',
        startsOn: '2026-07-05',
      }),
      { from: '2026-07', months: 3 },
    );

    expect(occ).toHaveLength(1);
    expect(occ[0]?.competence).toBe('2026-07');
    expect(occ[0]?.date).toBe('2026-07-10');
  });

  it('sem oneOffCompetence: se a ocorrencia cai fora da janela, devolve vazio', () => {
    // A ocorrencia e 10/08; janela so de julho.
    const occ = expandRecurrence(
      input({ dueDay: 10, frequency: 'one_off', startsOn: '2026-07-15' }),
      { from: '2026-07', months: 1 },
    );
    expect(occ).toEqual([]);
  });

  it('oneOffCompetence preenchido FIXA a competencia, mesmo anterior a startsOn', () => {
    // O campo explicito manda no mes; o dia continua sendo o dueDay clampado.
    const occ = expandRecurrence(
      input({
        dueDay: 10,
        frequency: 'one_off',
        startsOn: '2026-07-15',
        oneOffCompetence: '2026-03',
      }),
      { from: '2026-01', months: 6 },
    );

    expect(occ).toHaveLength(1);
    expect(occ[0]?.competence).toBe('2026-03');
    expect(occ[0]?.date).toBe('2026-03-10');
  });

  it('fora da janela devolve lista vazia', () => {
    const occ = expandRecurrence(
      input({ frequency: 'one_off', oneOffCompetence: '2026-12' }),
      { from: '2027-01', months: 3 },
    );
    expect(occ).toEqual([]);
  });

  it('one_off nao recebe reajuste anual', () => {
    const occ = expandRecurrence(
      input({
        expectedCents: cents(-100000),
        frequency: 'one_off',
        oneOffCompetence: '2028-06',
        annualAdjustmentBp: basisPoints(1200),
      }),
      { from: '2028-01', months: 12 },
    );
    expect(occ).toHaveLength(1);
    expect(occ[0]?.amountCents).toBe(-100000);
  });
});

describe('expandRecurrence — endsOn (vigencia)', () => {
  it('para na primeira ocorrencia posterior a endsOn', () => {
    // Serie mensal a partir de jan/2026. endsOn 31/03/2026: abril (05/04) ja
    // passou da vigencia.
    const occ = expandRecurrence(
      input({ dueDay: 5, startsOn: '2026-01-05', endsOn: '2026-03-31' }),
      { from: '2026-01', months: 6 },
    );

    expect(occ.map((o) => o.date)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
  });

  it('endsOn no meio do mes corta a ocorrencia daquele mes', () => {
    // endsOn 04/03/2026: a ocorrencia de marco e 05/03, posterior -> nao entra.
    const occ = expandRecurrence(
      input({ dueDay: 5, startsOn: '2026-01-05', endsOn: '2026-03-04' }),
      { from: '2026-01', months: 6 },
    );

    expect(occ.map((o) => o.date)).toEqual(['2026-01-05', '2026-02-05']);
  });
});

describe('expandRecurrence — reajuste anual no aniversario', () => {
  it('mensal: reajusta na competencia do aniversario, composto ano a ano', () => {
    // R$ 1.000,00 de despesa, reajuste 12% (1200 bp), inicio 05/03/2026.
    // -100000 * 1,12 = -112000 (mar/2027, 1 aniversario)
    // -112000 * 1,12 = -125440 (mar/2028, 2 aniversarios)
    const occ = expandRecurrence(
      input({
        expectedCents: cents(-100000),
        dueDay: 5,
        startsOn: '2026-03-05',
        annualAdjustmentBp: basisPoints(1200),
      }),
      { from: '2026-03', months: 25 },
    );

    expect(occ).toHaveLength(25);
    const byCompetence = new Map(occ.map((o) => [o.competence, o.amountCents]));
    expect(byCompetence.get('2026-03')).toBe(-100000);
    expect(byCompetence.get('2027-02')).toBe(-100000);
    expect(byCompetence.get('2027-03')).toBe(-112000);
    expect(byCompetence.get('2028-02')).toBe(-112000);
    expect(byCompetence.get('2028-03')).toBe(-125440);
  });

  it('anual: o reajuste incide ja na primeira ocorrencia apos o aniversario', () => {
    // Receita anual de R$ 2.000,00, 10% (1000 bp), inicio 10/03/2026, dueDay 5.
    // 05/03/2026 e antes do inicio -> fora. Ocorrencias:
    //   2027-03-05: 200000 * 1,10 = 220000
    //   2028-03-05: 220000 * 1,10 = 242000
    //   2029-03-05: 242000 * 1,10 = 266200
    const occ = expandRecurrence(
      input({
        expectedCents: cents(200000),
        dueDay: 5,
        frequency: 'annual',
        startsOn: '2026-03-10',
        annualAdjustmentBp: basisPoints(1000),
      }),
      { from: '2026-01', months: 40 },
    );

    expect(occ.map((o) => o.date)).toEqual([
      '2027-03-05',
      '2028-03-05',
      '2029-03-05',
    ]);
    expect(amounts(occ)).toEqual([220000, 242000, 266200]);
  });

  it('semestral: o 1o reajuste so na ocorrencia que completa 12 meses', () => {
    // R$ 1.000,00, 10% (1000 bp), inicio 10/01/2026, dueDay 10, semestral.
    // jan/2026 e jul/2026: 0 aniversarios -> 100000.
    // jan/2027 e jul/2027: 1 aniversario  -> 110000.
    // jan/2028: 2 aniversarios           -> 121000.
    const occ = expandRecurrence(
      input({
        expectedCents: cents(100000),
        dueDay: 10,
        frequency: 'semiannual',
        startsOn: '2026-01-10',
        annualAdjustmentBp: basisPoints(1000),
      }),
      { from: '2026-01', months: 25 },
    );

    expect(occ.map((o) => o.competence)).toEqual([
      '2026-01',
      '2026-07',
      '2027-01',
      '2027-07',
      '2028-01',
    ]);
    expect(amounts(occ)).toEqual([100000, 100000, 110000, 110000, 121000]);
  });

  it('reajuste nulo mantem o valor constante por varios anos', () => {
    const occ = expandRecurrence(
      input({ expectedCents: cents(-4200), dueDay: 5, startsOn: '2026-03-05' }),
      { from: '2026-03', months: 25 },
    );
    expect(occ).toHaveLength(25);
    expect(occ.every((o) => o.amountCents === -4200)).toBe(true);
  });

  it('o valor reajustado fecha com a conta a mao (soma dos incrementos)', () => {
    // Confere a composicao do reajuste explicitamente:
    // ano 1: -100000 + applyRate(-100000, 1200) = -100000 + (-12000) = -112000.
    const occ = expandRecurrence(
      input({
        expectedCents: cents(-100000),
        dueDay: 5,
        startsOn: '2026-03-05',
        annualAdjustmentBp: basisPoints(1200),
      }),
      { from: '2027-03', months: 1 },
    );
    expect(occ[0]?.amountCents).toBe(addCents(cents(-100000), cents(-12000)));
  });

  it('reajuste negativo reduz o valor e mantem o sinal', () => {
    // "Reajuste" de -10% (bp -1000) sobre R$ 1.000,00 de despesa:
    // -100000 + applyRate(-100000, -1000) = -100000 + 10000 = -90000 (mar/2027).
    const occ = expandRecurrence(
      input({
        expectedCents: cents(-100000),
        dueDay: 5,
        startsOn: '2026-03-05',
        annualAdjustmentBp: basisPoints(-1000),
      }),
      { from: '2027-03', months: 1 },
    );
    expect(occ[0]?.amountCents).toBe(-90000);
  });
});

describe('expandRecurrence — janela e validacao', () => {
  it('janela anterior ao inicio devolve lista vazia', () => {
    const occ = expandRecurrence(
      input({ dueDay: 10, startsOn: '2026-06-10' }),
      { from: '2026-01', months: 3 },
    );
    expect(occ).toEqual([]);
  });

  it('janela de zero meses devolve lista vazia, inclusive para one_off', () => {
    expect(
      expandRecurrence(input({}), { from: '2026-03', months: 0 }),
    ).toEqual([]);
    expect(
      expandRecurrence(
        input({ frequency: 'one_off', oneOffCompetence: '2026-03' }),
        { from: '2026-03', months: 0 },
      ),
    ).toEqual([]);
  });

  it('recorta a serie pelas duas pontas da janela', () => {
    // Serie mensal de jan/2026; janela abr..jun -> so as tres do meio.
    const occ = expandRecurrence(
      input({ dueDay: 5, startsOn: '2026-01-05' }),
      { from: '2026-04', months: 3 },
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ]);
  });

  it('recusa dueDay fora de 1 a 31', () => {
    expect(() =>
      expandRecurrence(input({ dueDay: 0 }), { from: '2026-03', months: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      expandRecurrence(input({ dueDay: 32 }), { from: '2026-03', months: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      expandRecurrence(input({ dueDay: 2.5 }), { from: '2026-03', months: 1 }),
    ).toThrow(RangeError);
  });

  it('recusa window.months negativo ou fracionario', () => {
    expect(() =>
      expandRecurrence(input({}), { from: '2026-03', months: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      expandRecurrence(input({}), { from: '2026-03', months: 1.5 }),
    ).toThrow(RangeError);
  });

  it('recusa competencia de janela invalida', () => {
    expect(() =>
      expandRecurrence(input({}), { from: '2026-13', months: 1 }),
    ).toThrow(RangeError);
  });

  it('valida startsOn mesmo quando oneOffCompetence esta presente', () => {
    expect(() =>
      expandRecurrence(
        input({
          frequency: 'one_off',
          startsOn: '2026-13-01',
          oneOffCompetence: '2026-12',
        }),
        { from: '2026-01', months: 12 },
      ),
    ).toThrow(RangeError);
  });
});
