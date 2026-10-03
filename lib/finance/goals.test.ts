import { describe, expect, it } from 'vitest';

import {
  emergencyFundTarget,
  essentialAverageWindow,
  essentialMonthlyAverage,
  goalProgress,
  sortGoals,
} from '@/lib/finance/goals';
import { cents } from '@/lib/money';

const TODAY = '2026-10-02';

function progress(target: number, current: number, targetDate: string | null, today = TODAY) {
  return goalProgress({ targetCents: cents(target), currentCents: cents(current), targetDate, today });
}

describe('goalProgress — valores conferidos à mão', () => {
  it('R$ 10.000 com R$ 2.500 guardados, prazo mar/2027: 25%, faltam R$ 7.500, 5 meses, R$ 1.500/mês', () => {
    // 250000 / 1000000 = 0,25 = 2500 bp. Faltam 750000. Out/2026 -> mar/2027 = 5 meses.
    // 750000 / 5 = 150000 (exato, sem arredondar).
    expect(progress(1_000_000, 250_000, '2027-03-15')).toEqual({
      progressBp: 2500,
      remainingCents: 750_000,
      monthsRemaining: 5,
      requiredMonthlyCents: 150_000,
      onTrack: true,
    });
  });

  it('arredonda o aporte PARA CIMA: R$ 1.000 em 3 meses = R$ 333,34 (3 × 333,34 ≥ 1.000)', () => {
    const result = progress(100_000, 0, '2027-01-31');
    expect(result.monthsRemaining).toBe(3);
    expect(result.requiredMonthlyCents).toBe(33_334);
    expect(33_334 * 3).toBeGreaterThanOrEqual(100_000);
  });

  it('arredonda o progresso para o bp mais próximo: 1/3 = 3333, 2/3 = 6667', () => {
    expect(progress(3, 1, null).progressBp).toBe(3333);
    expect(progress(3, 2, null).progressBp).toBe(6667);
  });

  it('sem prazo: progresso e restante existem; meses, aporte e onTrack são null (nunca 0 de mentira)', () => {
    expect(progress(1_000_000, 250_000, null)).toEqual({
      progressBp: 2500,
      remainingCents: 750_000,
      monthsRemaining: null,
      requiredMonthlyCents: null,
      onTrack: null,
    });
  });

  it('meta superada: 100%, nada falta, aporte 0 (zero verdadeiro) e em dia', () => {
    expect(progress(100_000, 150_000, '2027-03-15')).toEqual({
      progressBp: 10_000,
      remainingCents: 0,
      monthsRemaining: 5,
      requiredMonthlyCents: 0,
      onTrack: true,
    });
  });

  it('saldo negativo: progresso 0% e o restante é alvo + dívida', () => {
    const result = progress(100_000, -50_000, null);
    expect(result.progressBp).toBe(0);
    expect(result.remainingCents).toBe(150_000);
  });

  it('prazo neste mês: 0 meses, o restante inteiro de uma vez, e ainda em dia', () => {
    const result = progress(100_000, 40_000, '2026-10-31');
    expect(result.monthsRemaining).toBe(0);
    expect(result.requiredMonthlyCents).toBe(60_000);
    expect(result.onTrack).toBe(true);
  });

  it('prazo vencido com saldo a completar: 0 meses, restante inteiro, fora do prazo', () => {
    const result = progress(100_000, 40_000, '2026-09-30');
    expect(result.monthsRemaining).toBe(0);
    expect(result.requiredMonthlyCents).toBe(60_000);
    expect(result.onTrack).toBe(false);
  });

  it('prazo vencido mas meta já cumprida: em dia', () => {
    expect(progress(100_000, 100_000, '2026-01-01').onTrack).toBe(true);
  });

  it('recusa alvo zero ou negativo', () => {
    expect(() => progress(0, 0, null)).toThrow(RangeError);
    expect(() => progress(-1, 0, null)).toThrow(RangeError);
  });

  it('não estoura com valores grandes (R$ 90 trilhões)', () => {
    const big = 9_000_000_000_000_000;
    expect(progress(big, big / 2, null).progressBp).toBe(5000);
  });
});

describe('emergencyFundTarget', () => {
  it('6 meses × R$ 4.500,00 = R$ 27.000,00', () => {
    expect(emergencyFundTarget({ monthlyEssentialAverageCents: cents(450_000), months: 6 })).toBe(
      2_700_000,
    );
  });

  it('média zero dá alvo zero (valor verdadeiro, não ausência)', () => {
    expect(emergencyFundTarget({ monthlyEssentialAverageCents: cents(0), months: 6 })).toBe(0);
  });

  it('recusa meses < 1, não inteiro, ou média negativa', () => {
    expect(() => emergencyFundTarget({ monthlyEssentialAverageCents: cents(1), months: 0 })).toThrow(RangeError);
    expect(() => emergencyFundTarget({ monthlyEssentialAverageCents: cents(1), months: 1.5 })).toThrow(RangeError);
    expect(() => emergencyFundTarget({ monthlyEssentialAverageCents: cents(-1), months: 6 })).toThrow(RangeError);
  });
});

describe('média essencial', () => {
  it('janela: os 3 meses fechados antes do mês corrente', () => {
    expect(essentialAverageWindow('2026-10-02')).toEqual({ from: '2026-07', to: '2026-09' });
    expect(essentialAverageWindow('2026-01-15')).toEqual({ from: '2025-10', to: '2025-12' });
  });

  it('média de 3 meses: (1.000,00 + 2.000,00 + 1.000,01) / 3 = 1.333,34', () => {
    // 100000 + 200000 + 100001 = 400001; / 3 = 133333,67 -> 133334.
    const result = essentialMonthlyAverage([
      { competence: '2026-07', expenseNetCents: cents(-100_000) },
      { competence: '2026-08', expenseNetCents: cents(-200_000) },
      { competence: '2026-09', expenseNetCents: cents(-100_001) },
    ]);
    expect(result).toBe(133_334);
  });

  it('meio centavo sobe: (1 + 2) / 2 = 2', () => {
    expect(
      essentialMonthlyAverage([
        { competence: '2026-08', expenseNetCents: cents(-1) },
        { competence: '2026-09', expenseNetCents: cents(-2) },
      ]),
    ).toBe(2);
  });

  it('mês só com estorno vale 0, não negativo (CONTRACTS §14)', () => {
    expect(
      essentialMonthlyAverage([
        { competence: '2026-08', expenseNetCents: cents(-30_000) },
        { competence: '2026-09', expenseNetCents: cents(5_000) },
      ]),
    ).toBe(15_000);
  });

  it('um único mês com lançamento: a média é a dele, não um terço', () => {
    expect(
      essentialMonthlyAverage([{ competence: '2026-09', expenseNetCents: cents(-90_000) }]),
    ).toBe(90_000);
  });

  it('sem nenhum mês com lançamento: null (sem histórico), não zero', () => {
    expect(essentialMonthlyAverage([])).toBeNull();
  });

  it('mês com lançamento mas sem despesa essencial: média 0 (verdadeira)', () => {
    expect(essentialMonthlyAverage([{ competence: '2026-09', expenseNetCents: cents(0) }])).toBe(0);
  });
});

describe('sortGoals', () => {
  const goal = (
    name: string,
    status: string,
    priority: number,
    targetDate: string | null = null,
  ) => ({ name, status, priority, targetDate });

  it('ativas antes de pausadas antes de atingidas; prioridade crescente dentro do grupo', () => {
    const sorted = sortGoals([
      goal('atingida', 'achieved', 1),
      goal('pausada', 'paused', 1),
      goal('ativa 200', 'active', 200),
      goal('ativa 10', 'active', 10),
    ]);
    expect(sorted.map((g) => g.name)).toEqual(['ativa 10', 'ativa 200', 'pausada', 'atingida']);
  });

  it('empate de prioridade: prazo mais próximo primeiro, sem prazo por último, depois nome', () => {
    const sorted = sortGoals([
      goal('sem prazo', 'active', 100),
      goal('B tarde', 'active', 100, '2028-01-01'),
      goal('A cedo', 'active', 100, '2027-01-01'),
      goal('Z', 'active', 100),
    ]);
    expect(sorted.map((g) => g.name)).toEqual(['A cedo', 'B tarde', 'sem prazo', 'Z']);
  });

  it('não altera o array recebido', () => {
    const input = [goal('b', 'active', 2), goal('a', 'active', 1)];
    sortGoals(input);
    expect(input.map((g) => g.name)).toEqual(['b', 'a']);
  });
});
