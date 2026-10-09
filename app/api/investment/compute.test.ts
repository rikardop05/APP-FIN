import { describe, expect, it } from 'vitest';

import { basisPoints, cents } from '@/lib/money';

import { computeScenarios, scenarioFeasibility, targetDateMonths } from './compute';

const c = cents;

describe('targetDateMonths — meses da competência de hoje até a do prazo', () => {
  it('sem prazo: null', () => {
    expect(targetDateMonths(null, '2026-10')).toBeNull();
  });

  it('o dia não importa: conta competências', () => {
    expect(targetDateMonths('2028-10-01', '2026-10')).toBe(24);
    expect(targetDateMonths('2028-10-31', '2026-10')).toBe(24);
    expect(targetDateMonths('2026-11-15', '2026-10')).toBe(1);
  });

  it('prazo no mês corrente ou já passado: null (não há mês de aporte pela frente)', () => {
    expect(targetDateMonths('2026-10-31', '2026-10')).toBeNull();
    expect(targetDateMonths('2025-01-01', '2026-10')).toBeNull();
  });

  it('1200 meses ainda vale; 1201 passa do teto do motor: null', () => {
    expect(targetDateMonths('2126-10-01', '2026-10')).toBe(1200);
    expect(targetDateMonths('2126-11-01', '2026-10')).toBeNull();
  });
});

describe('scenarioFeasibility — RF-INV-05 contra o prazo, senão o maior horizonte', () => {
  const horizons = [
    { years: 5, contributionCents: c(400_000) },
    { years: 20, contributionCents: c(100_000) },
    { years: 10, contributionCents: c(200_000) },
  ];

  it('sem sobra conhecida: null', () => {
    expect(scenarioFeasibility(null, horizons, null)).toBeNull();
  });

  it('sem prazo: compara com o MAIOR horizonte (20 anos), não com o primeiro da lista', () => {
    // Exigido 100.000, sobra 80.000: faltam 20.000; 100.000/80.000 = 12.500 bp.
    expect(scenarioFeasibility(null, horizons, c(80_000))).toEqual({
      basis: { kind: 'horizon', years: 20 },
      requiredCents: 100_000,
      gapCents: 20_000,
      feasible: false,
      surplusUsageBp: 12_500,
    });
  });

  it('com prazo: compara com o aporte até o prazo', () => {
    const deadline = { months: 24, contributionCents: c(300_000) };
    // Sobra menor: faltam 300.000 - 250.000 = 50.000; uso 12.000 bp.
    expect(scenarioFeasibility(deadline, horizons, c(250_000))).toEqual({
      basis: { kind: 'targetDate', months: 24 },
      requiredCents: 300_000,
      gapCents: 50_000,
      feasible: false,
      surplusUsageBp: 12_000,
    });
    // Sobra igual: cabe, 100 %.
    expect(scenarioFeasibility(deadline, horizons, c(300_000))).toMatchObject({ gapCents: 0, feasible: true, surplusUsageBp: 10_000 });
    // Sobra maior: cabe, 300.000/400.000 = 7.500 bp.
    expect(scenarioFeasibility(deadline, horizons, c(400_000))).toMatchObject({ gapCents: 0, feasible: true, surplusUsageBp: 7_500 });
  });

  it('sobra zero ou negativa: falta o aporte inteiro, uso null', () => {
    expect(scenarioFeasibility(null, horizons, c(0))).toMatchObject({ gapCents: 100_000, feasible: false, surplusUsageBp: null });
    expect(scenarioFeasibility(null, horizons, c(-30_000))).toMatchObject({ gapCents: 100_000, feasible: false, surplusUsageBp: null });
  });

  it('sem prazo e sem horizonte: nada a comparar', () => {
    expect(scenarioFeasibility(null, [], c(100))).toBeNull();
  });
});

describe('computeScenarios — requiredForTargetDate e feasibility por cenário', () => {
  const plan = {
    desiredMonthlyIncomeCents: c(1_000_000),
    currentPortfolioCents: c(5_000_000),
    currentMonthlyContributionCents: c(200_000),
    targetDate: '2046-10-01',
  };
  const moderate = [{ label: 'moderate' as const, realReturnBp: basisPoints(500), withdrawalBp: basisPoints(400) }];

  it('prazo de 240 meses = o horizonte de 20 anos (706.581, tabela do gate T-301)', () => {
    const [view] = computeScenarios(plan, moderate, '2026-10', [5, 10, 15, 20], c(800_000));
    expect(view?.requiredForTargetDate).toEqual({ months: 240, contributionCents: 706_581 });
    // 706.581 <= 800.000: cabe; 706.581 / 800.000 = 0,88322625 = 8.832,26 bp -> 8.832.
    expect(view?.feasibility).toEqual({
      basis: { kind: 'targetDate', months: 240 },
      requiredCents: 706_581,
      gapCents: 0,
      feasible: true,
      surplusUsageBp: 8_832,
    });
  });

  it('prazo de 120 meses = o horizonte de 10 anos (1.890.708); sem prazo usa 20 anos', () => {
    const [withDeadline] = computeScenarios({ ...plan, targetDate: '2036-10-20' }, moderate, '2026-10', [5, 10, 15, 20], c(800_000));
    expect(withDeadline?.requiredForTargetDate).toEqual({ months: 120, contributionCents: 1_890_708 });
    expect(withDeadline?.feasibility).toMatchObject({ gapCents: 1_090_708, feasible: false });

    const [noDeadline] = computeScenarios({ ...plan, targetDate: null }, moderate, '2026-10', [5, 10, 15, 20], c(800_000));
    expect(noDeadline?.requiredForTargetDate).toBeNull();
    expect(noDeadline?.feasibility?.basis).toEqual({ kind: 'horizon', years: 20 });
    expect(noDeadline?.feasibility?.requiredCents).toBe(706_581);
  });

  it('prazo vencido: requiredForTargetDate null e compara com 20 anos; sem sobra: feasibility null', () => {
    const [past] = computeScenarios({ ...plan, targetDate: '2026-01-01' }, moderate, '2026-10', [5, 10, 15, 20], c(800_000));
    expect(past?.requiredForTargetDate).toBeNull();
    expect(past?.feasibility?.basis).toEqual({ kind: 'horizon', years: 20 });
    const [noSurplus] = computeScenarios(plan, moderate, '2026-10', [5, 10, 15, 20], null);
    expect(noSurplus?.feasibility).toBeNull();
  });
});
