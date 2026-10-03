import { describe, expect, it } from 'vitest';

import { accumulationCurve } from '@/lib/finance/investment';
import { contributionAdherence, portfolioVsProjection, type CurvePoint } from '@/lib/finance/positions';
import { basisPoints, cents } from '@/lib/money';

const c = cents;
const bp = basisPoints;

function month(competence: string, actualCents: number) {
  return { competence, actualCents: c(actualCents) };
}

describe('contributionAdherence', () => {
  it('janela tipica: aderencia por mes, mes corrente fora do resumo, saida ordenada', () => {
    // Planejado 200.000 (R$ 2.000). Entrada fora de ordem de proposito.
    //   2026-07:       0 /  200.000 =    0 bp, abaixo
    //   2026-08: 200.000 / 200.000 = 10.000 bp, nao abaixo (igual nao e abaixo)
    //   2026-09: 150.000 / 200.000 =  7.500 bp, abaixo
    //   2026-10:  50.000 / 200.000 =  2.500 bp, abaixo, EM ANDAMENTO
    // Resumo (so fechados, 3 meses): (0 + 200.000 + 150.000) / (200.000 * 3)
    //   = 350.000 / 600.000 = 0,58333 = 5.833,33 bp -> 5.833; abaixo: 07 e 09 = 2.
    const result = contributionAdherence({
      months: [month('2026-09', 150_000), month('2026-10', 50_000), month('2026-07', 0), month('2026-08', 200_000)],
      plannedMonthlyCents: c(200_000),
      currentCompetence: '2026-10',
    });
    expect(result.months).toEqual([
      { competence: '2026-07', actualCents: 0, plannedCents: 200_000, adherenceBp: 0, belowPlan: true, inProgress: false },
      { competence: '2026-08', actualCents: 200_000, plannedCents: 200_000, adherenceBp: 10_000, belowPlan: false, inProgress: false },
      { competence: '2026-09', actualCents: 150_000, plannedCents: 200_000, adherenceBp: 7_500, belowPlan: true, inProgress: false },
      { competence: '2026-10', actualCents: 50_000, plannedCents: 200_000, adherenceBp: 2_500, belowPlan: true, inProgress: true },
    ]);
    expect(result.summary).toEqual({ closedMonths: 3, averageAdherenceBp: 5_833, monthsBelowPlan: 2 });
  });

  it('aporte acima do planejado passa de 10.000 bp', () => {
    // 300.000 / 200.000 = 1,5 = 15.000 bp.
    const result = contributionAdherence({
      months: [month('2026-09', 300_000)],
      plannedMonthlyCents: c(200_000),
      currentCompetence: '2026-10',
    });
    expect(result.months[0]?.adherenceBp).toBe(15_000);
    expect(result.months[0]?.belowPlan).toBe(false);
    expect(result.summary).toEqual({ closedMonths: 1, averageAdherenceBp: 15_000, monthsBelowPlan: 0 });
  });

  it('razao que nao fecha: bp mais proximo; meio bp se afasta do zero', () => {
    // 1/3 = 3.333,33 -> 3.333; 2/3 = 6.666,67 -> 6.667.
    const thirds = contributionAdherence({
      months: [month('2026-08', 1), month('2026-09', 2)],
      plannedMonthlyCents: c(3),
      currentCompetence: '2026-10',
    });
    expect(thirds.months.map((m) => m.adherenceBp)).toEqual([3_333, 6_667]);
    // Resumo: (1 + 2) / (3 * 2) = 0,5 = 5.000 bp.
    expect(thirds.summary.averageAdherenceBp).toBe(5_000);
    // 1 * 10.000 / 20.000 = 0,5 bp -> 1 (e nao 0).
    const half = contributionAdherence({
      months: [month('2026-09', 1)],
      plannedMonthlyCents: c(20_000),
      currentCompetence: '2026-10',
    });
    expect(half.months[0]?.adherenceBp).toBe(1);
  });

  it('planejado 0: aderencia null, nunca abaixo, media null', () => {
    const result = contributionAdherence({
      months: [month('2026-09', 100), month('2026-10', 0)],
      plannedMonthlyCents: c(0),
      currentCompetence: '2026-10',
    });
    expect(result.months.map((m) => [m.adherenceBp, m.belowPlan])).toEqual([
      [null, false],
      [null, false],
    ]);
    expect(result.summary).toEqual({ closedMonths: 1, averageAdherenceBp: null, monthsBelowPlan: 0 });
  });

  it('so o mes corrente (ou nada): resumo sem meses fechados, media null', () => {
    const onlyCurrent = contributionAdherence({
      months: [month('2026-10', 100_000)],
      plannedMonthlyCents: c(200_000),
      currentCompetence: '2026-10',
    });
    expect(onlyCurrent.summary).toEqual({ closedMonths: 0, averageAdherenceBp: null, monthsBelowPlan: 0 });
    const empty = contributionAdherence({ months: [], plannedMonthlyCents: c(200_000), currentCompetence: '2026-10' });
    expect(empty).toEqual({ months: [], summary: { closedMonths: 0, averageAdherenceBp: null, monthsBelowPlan: 0 } });
  });

  it('janela D5 cruzando o ano: 12 fechados + corrente', () => {
    // 2025-10 .. 2026-09 fechados, todos com 100.000 contra 200.000 (5.000 bp), e 2026-10 em andamento.
    // Resumo: 12 * 100.000 / (200.000 * 12) = 5.000 bp; 12 abaixo.
    const competences = [
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ];
    const result = contributionAdherence({
      months: competences.map((comp) => month(comp, 100_000)),
      plannedMonthlyCents: c(200_000),
      currentCompetence: '2026-10',
    });
    expect(result.months.map((m) => m.competence)).toEqual(competences);
    expect(result.summary).toEqual({ closedMonths: 12, averageAdherenceBp: 5_000, monthsBelowPlan: 12 });
  });

  it('entrada invalida lanca', () => {
    const base = { plannedMonthlyCents: c(200_000), currentCompetence: '2026-10' };
    // Sinal do banco esquecido: aporte negativo.
    expect(() => contributionAdherence({ ...base, months: [month('2026-09', -150_000)] })).toThrow(RangeError);
    expect(() =>
      contributionAdherence({ ...base, plannedMonthlyCents: c(-1), months: [month('2026-09', 1)] }),
    ).toThrow(RangeError);
    // Mes posterior ao corrente.
    expect(() => contributionAdherence({ ...base, months: [month('2026-11', 1)] })).toThrow(
      'Competencia 2026-11 e posterior ao mes corrente 2026-10.',
    );
    expect(() =>
      contributionAdherence({ ...base, months: [month('2026-09', 1), month('2026-09', 2)] }),
    ).toThrow('Competencia repetida na janela de aportes: 2026-09.');
    expect(() => contributionAdherence({ ...base, months: [month('2026-9', 1)] })).toThrow(RangeError);
  });

  it('mes corrente malformado lanca mesmo com a janela vazia (laudo Corvo B2)', () => {
    expect(() =>
      contributionAdherence({ months: [], plannedMonthlyCents: c(200_000), currentCompetence: '2026-13' }),
    ).toThrow(RangeError);
    // Lado valido da fronteira: 2026-12 com janela vazia passa.
    expect(
      contributionAdherence({ months: [], plannedMonthlyCents: c(200_000), currentCompetence: '2026-12' }).summary,
    ).toEqual({ closedMonths: 0, averageAdherenceBp: null, monthsBelowPlan: 0 });
  });
});

/** Curva escrita a mao: competencias consecutivas a partir de `from`. */
function curve(from: string, values: number[]): CurvePoint[] {
  const [year, mon] = from.split('-').map(Number) as [number, number];
  return values.map((value, n) => {
    const index = year * 12 + (mon - 1) + n;
    const competence = `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
    return { month: n, competenceOffset: n, competence, portfolioCents: c(value), passiveIncomeCents: c(0) };
  });
}

describe('portfolioVsProjection', () => {
  const curves = [
    { label: 'moderate' as const, points: curve('2026-10', [5_000_000, 5_200_000, 5_400_000]) },
    { label: 'optimistic' as const, points: curve('2026-10', [5_000_000, 5_300_000, 5_600_000]) },
  ];

  it('antes do plano, comparado e depois da curva; saida ordenada por data', () => {
    const result = portfolioVsProjection({
      snapshots: [
        { asOf: '2027-01-10', portfolioCents: c(5_700_000) },
        { asOf: '2026-11-15', portfolioCents: c(5_250_000) },
        { asOf: '2026-09-30', portfolioCents: c(4_900_000) },
        { asOf: '2026-10-01', portfolioCents: c(5_000_000) },
      ],
      curves,
      planStartCompetence: '2026-10',
    });
    const none = (label: 'moderate' | 'optimistic') => ({ label, projectedCents: null, diffCents: null, diffBp: null });
    expect(result).toEqual([
      // 2026-09 < inicio do plano 2026-10: mostrado, sem comparacao.
      { asOf: '2026-09-30', competence: '2026-09', portfolioCents: 4_900_000, status: 'before_plan', byScenario: [none('moderate'), none('optimistic')] },
      // Offset 0: 5.000.000 - 5.000.000 = 0 nos dois.
      {
        asOf: '2026-10-01', competence: '2026-10', portfolioCents: 5_000_000, status: 'compared',
        byScenario: [
          { label: 'moderate', projectedCents: 5_000_000, diffCents: 0, diffBp: 0 },
          { label: 'optimistic', projectedCents: 5_000_000, diffCents: 0, diffBp: 0 },
        ],
      },
      // Offset 1 (fim de 2026-11), registro do dia 15:
      //   moderate:   5.250.000 - 5.200.000 = +50.000; 50.000 * 10.000 / 5.200.000 = 96,15 -> 96
      //   optimistic: 5.250.000 - 5.300.000 = -50.000; -50.000 * 10.000 / 5.300.000 = -94,34 -> -94
      {
        asOf: '2026-11-15', competence: '2026-11', portfolioCents: 5_250_000, status: 'compared',
        byScenario: [
          { label: 'moderate', projectedCents: 5_200_000, diffCents: 50_000, diffBp: 96 },
          { label: 'optimistic', projectedCents: 5_300_000, diffCents: -50_000, diffBp: -94 },
        ],
      },
      // 2027-01 = offset 3, a curva vai ate o offset 2 (2026-12).
      { asOf: '2027-01-10', competence: '2027-01', portfolioCents: 5_700_000, status: 'beyond_curve', byScenario: [none('moderate'), none('optimistic')] },
    ]);
  });

  it('ultimo ponto da curva ainda e comparado (fronteira do beyond_curve)', () => {
    // 2026-12 = offset 2, ultimo ponto: 5.400.000 - 5.400.000 = 0.
    const [row] = portfolioVsProjection({
      snapshots: [{ asOf: '2026-12-31', portfolioCents: c(5_400_000) }],
      curves,
      planStartCompetence: '2026-10',
    });
    expect(row?.status).toBe('compared');
    expect(row?.byScenario[0]).toEqual({ label: 'moderate', projectedCents: 5_400_000, diffCents: 0, diffBp: 0 });
  });

  it('dois registros no mesmo mes: ordem pelo dia, os dois contra o fim do mes', () => {
    const result = portfolioVsProjection({
      snapshots: [
        { asOf: '2026-11-28', portfolioCents: c(5_200_000) },
        { asOf: '2026-11-03', portfolioCents: c(5_100_000) },
      ],
      curves: [curves[0] as (typeof curves)[number]],
      planStartCompetence: '2026-10',
    });
    // Dia 3: 5.100.000 - 5.200.000 = -100.000; -100.000 * 10.000 / 5.200.000 = -192,31 -> -192.
    // Dia 28: 0.
    expect(result.map((r) => [r.asOf, r.byScenario[0]?.diffCents, r.byScenario[0]?.diffBp])).toEqual([
      ['2026-11-03', -100_000, -192],
      ['2026-11-28', 0, 0],
    ]);
  });

  it('meio bp negativo se afasta do zero; projetado 0 da diffBp null', () => {
    // Projetado 20.000, real 19.999: -1 * 10.000 / 20.000 = -0,5 -> -1.
    const [tie] = portfolioVsProjection({
      snapshots: [{ asOf: '2026-10-15', portfolioCents: c(19_999) }],
      curves: [{ label: 'moderate', points: curve('2026-10', [20_000]) }],
      planStartCompetence: '2026-10',
    });
    expect(tie?.byScenario[0]).toEqual({ label: 'moderate', projectedCents: 20_000, diffCents: -1, diffBp: -1 });
    // Plano comecou do zero: projetado 0, diferenca = o real, razao sem sentido.
    const [zero] = portfolioVsProjection({
      snapshots: [{ asOf: '2026-10-15', portfolioCents: c(1_000) }],
      curves: [{ label: 'moderate', points: curve('2026-10', [0]) }],
      planStartCompetence: '2026-10',
    });
    expect(zero?.byScenario[0]).toEqual({ label: 'moderate', projectedCents: 0, diffCents: 1_000, diffBp: null });
  });

  it('com a saida real de accumulationCurve', () => {
    // Taxa 0: 100.000 + 10.000 * n -> 2026-10: 100.000, 2026-11: 110.000, 2026-12: 120.000.
    // Registro em 2026-12: 115.000 - 120.000 = -5.000; -5.000 * 10.000 / 120.000 = -416,67 -> -417.
    const points = accumulationCurve({
      p0: c(100_000),
      monthlyContribution: c(10_000),
      annualBp: bp(0),
      months: 2,
      withdrawalBp: bp(400),
      fromCompetence: '2026-10',
    });
    const [row] = portfolioVsProjection({
      snapshots: [{ asOf: '2026-12-20', portfolioCents: c(115_000) }],
      curves: [{ label: 'conservative', points }],
      planStartCompetence: '2026-10',
    });
    expect(row?.byScenario).toEqual([{ label: 'conservative', projectedCents: 120_000, diffCents: -5_000, diffBp: -417 }]);
  });

  it('ponto de curva negativo lanca: nao vira diffBp de sinal trocado (laudo Corvo B1)', () => {
    // Sem a guarda: (5.000 - (-10.000)) * 10.000 / -10.000 = -15.000 bp, "atras" estando a frente.
    expect(() =>
      portfolioVsProjection({
        snapshots: [{ asOf: '2026-10-15', portfolioCents: c(5_000) }],
        curves: [{ label: 'moderate', points: curve('2026-10', [-10_000]) }],
        planStartCompetence: '2026-10',
      }),
    ).toThrow('Curva moderate com patrimonio projetado negativo em 2026-10: -10000 centavos.');
    // A guarda vale mesmo sem registro algum (a curva e validada antes).
    expect(() =>
      portfolioVsProjection({
        snapshots: [],
        curves: [{ label: 'moderate', points: curve('2026-10', [0, -1]) }],
        planStartCompetence: '2026-10',
      }),
    ).toThrow(RangeError);
    // Lado valido: ponto 0 e aceito (ja coberto em "projetado 0 da diffBp null").
  });

  it('sem curva nenhuma lanca, em vez de marcar tudo como beyond_curve (laudo Corvo B3)', () => {
    expect(() =>
      portfolioVsProjection({
        snapshots: [{ asOf: '2026-10-15', portfolioCents: c(1) }],
        curves: [],
        planStartCompetence: '2026-10',
      }),
    ).toThrow('Nenhuma curva de cenario: o plano precisa de pelo menos um cenario.');
  });

  it('sem registros devolve lista vazia', () => {
    expect(portfolioVsProjection({ snapshots: [], curves, planStartCompetence: '2026-10' })).toEqual([]);
  });

  it('entrada invalida lanca', () => {
    const snap = [{ asOf: '2026-10-15', portfolioCents: c(1) }];
    // Curva que nao comeca no inicio do plano (D3).
    expect(() =>
      portfolioVsProjection({ snapshots: snap, curves: [{ label: 'moderate', points: curve('2026-11', [1]) }], planStartCompetence: '2026-10' }),
    ).toThrow('Curva moderate deve comecar em 2026-10; comeca em 2026-11.');
    expect(() =>
      portfolioVsProjection({ snapshots: snap, curves: [{ label: 'moderate', points: [] }], planStartCompetence: '2026-10' }),
    ).toThrow(RangeError);
    // Curvas de comprimentos diferentes.
    expect(() =>
      portfolioVsProjection({
        snapshots: snap,
        curves: [
          { label: 'moderate', points: curve('2026-10', [1, 2]) },
          { label: 'optimistic', points: curve('2026-10', [1]) },
        ],
        planStartCompetence: '2026-10',
      }),
    ).toThrow(RangeError);
    // Label repetido.
    expect(() =>
      portfolioVsProjection({
        snapshots: snap,
        curves: [
          { label: 'moderate', points: curve('2026-10', [1]) },
          { label: 'moderate', points: curve('2026-10', [1]) },
        ],
        planStartCompetence: '2026-10',
      }),
    ).toThrow(RangeError);
    // Data repetida e posicao negativa.
    expect(() =>
      portfolioVsProjection({ snapshots: [...snap, ...snap], curves, planStartCompetence: '2026-10' }),
    ).toThrow('Posicao repetida na data 2026-10-15.');
    expect(() =>
      portfolioVsProjection({ snapshots: [{ asOf: '2026-10-15', portfolioCents: c(-1) }], curves, planStartCompetence: '2026-10' }),
    ).toThrow(RangeError);
    // Curva com buraco: o ponto 1 deveria ser 2026-11.
    const broken = curve('2026-10', [1, 2]);
    const gap = [broken[0] as CurvePoint, { ...(broken[1] as CurvePoint), competence: '2026-12' }];
    expect(() =>
      portfolioVsProjection({
        snapshots: [{ asOf: '2026-11-15', portfolioCents: c(1) }],
        curves: [{ label: 'moderate', points: gap }],
        planStartCompetence: '2026-10',
      }),
    ).toThrow(RangeError);
    // Data invalida.
    expect(() =>
      portfolioVsProjection({ snapshots: [{ asOf: '2026-13-01', portfolioCents: c(1) }], curves, planStartCompetence: '2026-10' }),
    ).toThrow(RangeError);
  });
});
