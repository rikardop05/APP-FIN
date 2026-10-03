import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { buildPassiveIncomeState, type PassiveIncomeSource } from './passive-income';

const point = (month: number, portfolio: number) => ({
  month,
  competenceOffset: month,
  competence: '2026-10',
  portfolioCents: cents(portfolio),
  passiveIncomeCents: cents(0),
});

function scenario(label: 'conservative' | 'moderate' | 'optimistic', target: number, months: number | null) {
  return {
    label,
    result: { targetPortfolioCents: cents(target), monthsWithCurrentContribution: months },
    curve: [point(0, 5_000_000), point(240, 100_000_000)],
  };
}

const source = (overrides: Partial<PassiveIncomeSource> = {}): PassiveIncomeSource => ({
  horizonsYears: [5, 10, 15, 20],
  plan: { name: 'Aposentadoria', desiredMonthlyIncomeCents: cents(500_000), currentPortfolioCents: cents(5_000_000) },
  // Fora de ordem de propósito: o card ordena conservador, médio, otimista.
  scenarios: [
    scenario('optimistic', 120_000_000, 194),
    scenario('conservative', 200_000_000, 379),
    scenario('moderate', 150_000_000, 258),
  ],
  ...overrides,
});

describe('buildPassiveIncomeState', () => {
  it('sem plano: none (o card vira convite)', () => {
    expect(buildPassiveIncomeState(source({ plan: null, scenarios: [] }), '2026-10-02')).toEqual({ kind: 'none' });
  });

  it('com plano: ordena os cenários e calcula o progresso pelo motor de metas', () => {
    const state = buildPassiveIncomeState(source(), '2026-10-02');
    expect(state.kind).toBe('ok');
    if (state.kind !== 'ok') return;
    expect(state.scenarios.map((row) => row.label)).toEqual(['conservative', 'moderate', 'optimistic']);
    // R$ 50.000 / R$ 2.000.000 = 2,5% (250 bp); / 1.500.000 = 3,33% (333); / 1.200.000 = 4,17% (417).
    expect(state.scenarios.map((row) => row.progressBp)).toEqual([250, 333, 417]);
    expect(state.currentPortfolioCents).toBe(5_000_000);
    expect(state.moderateTargetCents).toBe(150_000_000);
    expect(state.horizonYears).toBe(20);
    expect(state.curves.map((curve) => curve.label)).toEqual(['conservative', 'moderate', 'optimistic']);
  });

  it('o tempo vem da mesma regra do planejador: 379 meses = 31 anos e 7 meses', () => {
    const state = buildPassiveIncomeState(source(), '2026-10-02');
    if (state.kind !== 'ok') throw new Error('esperava ok');
    expect(state.scenarios[0]?.timeText).toBe('31 anos e 7 meses');
  });

  it('inalcançável (null) e acima de 100 anos viram texto, nunca número absurdo', () => {
    const state = buildPassiveIncomeState(
      source({ scenarios: [scenario('conservative', 200_000_000, null), scenario('moderate', 150_000_000, 1500)] }),
      '2026-10-02',
    );
    if (state.kind !== 'ok') throw new Error('esperava ok');
    expect(state.scenarios.map((row) => row.timeText)).toEqual(['Inalcançável com o aporte atual', 'Mais de 100 anos']);
  });

  it('patrimônio já acima do alvo: progresso limitado a 100%', () => {
    const state = buildPassiveIncomeState(
      source({
        plan: { name: 'x', desiredMonthlyIncomeCents: cents(1), currentPortfolioCents: cents(500_000_000) },
      }),
      '2026-10-02',
    );
    if (state.kind !== 'ok') throw new Error('esperava ok');
    expect(state.scenarios.every((row) => row.progressBp === 10_000)).toBe(true);
  });

  it('renda desejada zero (alvo 0): progresso null, sem lançar', () => {
    const state = buildPassiveIncomeState(
      source({ scenarios: [scenario('moderate', 0, 0)] }),
      '2026-10-02',
    );
    if (state.kind !== 'ok') throw new Error('esperava ok');
    expect(state.scenarios[0]?.progressBp).toBeNull();
  });

  it('sem o cenário médio: moderateTargetCents é null (sem linha de referência)', () => {
    const state = buildPassiveIncomeState(source({ scenarios: [scenario('conservative', 200_000_000, 379)] }), '2026-10-02');
    if (state.kind !== 'ok') throw new Error('esperava ok');
    expect(state.moderateTargetCents).toBeNull();
  });
});
