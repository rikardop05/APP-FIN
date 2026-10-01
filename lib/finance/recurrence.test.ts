import { describe, expect, it } from 'vitest';

import {
  expandRecurrence,
  replanRecurrence,
  type PlannedOccurrence,
  type RecurrenceInput,
  type StoredPlannedRow,
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

describe('replanRecurrence — o que se preserva e o que se regenera', () => {
  // Hoje e 10/out/2026. A regra nova e a de sempre, mensal dia 5.
  const TODAY = '2026-10-10';
  const WINDOW = { from: '2026-10', months: 4 }; // out..jan
  const stored = (id: string, date: string, conciliated = false): StoredPlannedRow => ({
    id,
    date,
    conciliated,
  });
  const replan = (
    existing: StoredPlannedRow[],
    rule: RecurrenceInput | null = input({ startsOn: '2026-09-01' }),
    today = TODAY,
  ) => replanRecurrence({ rule, existing, window: WINDOW, today });

  it('garantia 1: apagadas e preservadas são disjuntas e a união é exatamente o existente', () => {
    const existing = [
      stored('vencida', '2026-10-05'),
      stored('futura', '2026-11-05'),
      stored('conciliada-futura', '2026-12-05', true),
      stored('conciliada-vencida', '2026-09-05', true),
    ];
    const { deleteIds, preservedIds } = replan(existing);
    expect(deleteIds.filter((id) => preservedIds.includes(id))).toEqual([]);
    expect([...deleteIds, ...preservedIds].sort()).toEqual(existing.map((r) => r.id).sort());
    expect(deleteIds).toEqual(['futura']);
  });

  it('garantia 2: conciliada nunca é apagada, nem quando a data é futura', () => {
    const { deleteIds, preservedIds } = replan([stored('c', '2027-03-05', true)]);
    expect(deleteIds).toEqual([]);
    expect(preservedIds).toEqual(['c']);
  });

  it('garantia 3: vencida e não conciliada nunca é apagada (é a pendência do painel)', () => {
    const { deleteIds, preservedIds } = replan([stored('v', '2026-10-05'), stored('v2', '2026-09-28')]);
    expect(deleteIds).toEqual([]);
    expect(preservedIds).toEqual(['v', 'v2']);
  });

  it('garantia 4: linha de hoje, não conciliada, NÃO está vencida: é apagada', () => {
    const { deleteIds } = replan([stored('hoje', TODAY), stored('ontem', '2026-10-09')]);
    expect(deleteIds).toEqual(['hoje']);
  });

  it('garantia 5: toda ocorrência inserida tem date >= today e vem de expandRecurrence na mesma janela', () => {
    const rule = input({ startsOn: '2026-09-01' });
    const { insert } = replan([], rule);
    expect(insert.every((o) => o.date >= TODAY)).toBe(true);
    // 05/10 já passou: a competência de outubro NÃO é regenerada (vencida fica com o valor antigo).
    expect(insert.map((o) => o.date)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(insert).toEqual(expandRecurrence(rule, WINDOW).filter((o) => o.date >= TODAY));
  });

  it('o corte é a DATA, não a competência: dueDay 20 em 10/out ainda entra no mês corrente', () => {
    const { insert } = replan([], input({ dueDay: 20, startsOn: '2026-09-01' }));
    expect(insert[0]).toMatchObject({ competence: '2026-10', date: '2026-10-20' });
  });

  it('garantia 6: regra sem ocorrências futuras devolve insert vazio sem lançar, e apaga as futuras', () => {
    const encerrada = input({ startsOn: '2026-01-01', endsOn: '2026-10-09' });
    const r1 = replan([stored('f', '2026-11-05')], encerrada);
    expect(r1.insert).toEqual([]);
    expect(r1.deleteIds).toEqual(['f']);
    // `rule: null` é a desativação: mesmo caminho, nada a inserir.
    const r2 = replan([stored('f', '2026-11-05'), stored('v', '2026-10-05')], null);
    expect(r2.insert).toEqual([]);
    expect(r2.deleteIds).toEqual(['f']);
    expect(r2.preservedIds).toEqual(['v']);
  });

  it('garantia 7: today inválido, date inválida e id repetido lançam (sem fallback)', () => {
    expect(() => replan([], input({}), '2026-02-30')).toThrow();
    expect(() => replan([], input({}), 'amanhã')).toThrow();
    expect(() => replan([stored('x', '2026-13-01')])).toThrow();
    expect(() => replan([stored('a', '2026-11-05'), stored('a', '2026-12-05')])).toThrow(RangeError);
  });

  it('valor muda de 180 para 220: o futuro sai no valor novo, a vencida fica como está', () => {
    const rule = input({ expectedCents: cents(-22000), startsOn: '2026-09-01' });
    const { deleteIds, preservedIds, insert } = replan(
      [stored('out', '2026-10-05'), stored('nov', '2026-11-05')],
      rule,
    );
    expect(preservedIds).toEqual(['out']);
    expect(deleteIds).toEqual(['nov']);
    expect(amounts(insert)).toEqual([-22000, -22000, -22000]);
  });

  it('frequência mensal -> trimestral: apaga o futuro do ritmo antigo e gera só o do novo', () => {
    const rule = input({ frequency: 'quarterly', startsOn: '2026-09-01' });
    const existing = [stored('nov', '2026-11-05'), stored('dez', '2026-12-05'), stored('jan', '2027-01-05')];
    const { deleteIds, insert } = replan(existing, rule);
    expect(deleteIds).toEqual(['nov', 'dez', 'jan']);
    // Âncora na competência de startsOn (set): set, dez, mar... Em 10/out só dez entra.
    expect(insert.map((o) => o.date)).toEqual(['2026-12-05']);
  });

  it('endsOn encurtado: o futuro além do fim some, o que cabe antes fica regenerado', () => {
    const rule = input({ startsOn: '2026-09-01', endsOn: '2026-11-30' });
    const { insert } = replan([stored('dez', '2026-12-05'), stored('nov', '2026-11-05')], rule);
    expect(insert.map((o) => o.date)).toEqual(['2026-11-05']);
  });

  it('reajuste anual mudando: o futuro regenerado respeita o aniversário novo', () => {
    const rule = input({
      expectedCents: cents(-10000),
      startsOn: '2025-12-01',
      annualAdjustmentBp: basisPoints(1000),
    });
    const { insert } = replanRecurrence({
      rule,
      existing: [],
      window: { from: '2026-10', months: 4 },
      today: TODAY,
    });
    // nov/2026 ainda é o 1º ano; dez/2026 é o aniversário (12 meses desde dez/2025).
    expect(amounts(insert)).toEqual([-10000, -11000, -11000]);
  });

  it('dueDay muda dentro do mesmo mês: a nova de 20/out entra (a ocupação é decidida pelo chamador)', () => {
    const { deleteIds, preservedIds, insert } = replan(
      [stored('antiga-5-out', '2026-10-05')],
      input({ dueDay: 20, startsOn: '2026-09-01' }),
    );
    expect(preservedIds).toEqual(['antiga-5-out']);
    expect(deleteIds).toEqual([]);
    // Esta função devolve a de 20/out; quem sabe que out já tem ocorrência é `dropOccupied`.
    expect(insert[0]?.date).toBe('2026-10-20');
  });

  it('today no último dia do mês: a ocorrência de hoje conta, a do mês seguinte também', () => {
    const { insert } = replanRecurrence({
      rule: input({ dueDay: 31, startsOn: '2026-09-01' }),
      existing: [],
      window: { from: '2026-10', months: 2 },
      today: '2026-10-31',
    });
    expect(insert.map((o) => o.date)).toEqual(['2026-10-31', '2026-11-30']);
  });

  it('é pura: não altera a lista recebida', () => {
    const existing = [stored('a', '2026-11-05')];
    const snapshot = JSON.stringify(existing);
    replan(existing);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});
