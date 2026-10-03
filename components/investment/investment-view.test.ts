import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import {
  bpToPercentInput,
  feasibleText,
  formatCompactBRL,
  formatMonthsToTarget,
  percentInputToBp,
  yearTickLabel,
} from './display';
import { emptyPlanValues, parsePlanForm, planToValues, valuesEqual } from './form';
import type { InvestmentPlan } from './schemas';

describe('formatMonthsToTarget: nunca NaN, nunca número absurdo', () => {
  it('null (a curva nunca cruza o alvo) = inalcançável', () => {
    expect(formatMonthsToTarget(null)).toEqual({ kind: 'unreachable', text: 'Inalcançável com o aporte atual' });
  });

  it('NaN, Infinity, negativo e fracionário também viram inalcançável', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3, 2.5]) {
      expect(formatMonthsToTarget(bad).kind).toBe('unreachable');
    }
  });

  it('0 meses = meta já atingida', () => {
    expect(formatMonthsToTarget(0)).toEqual({ kind: 'reached', text: 'Meta já atingida' });
  });

  it('acima de 1200 meses = mais de 100 anos; 1200 exatos ainda é tempo', () => {
    expect(formatMonthsToTarget(1201)).toEqual({ kind: 'too-long', text: 'Mais de 100 anos' });
    expect(formatMonthsToTarget(1200)).toEqual({ kind: 'time', text: '100 anos' });
  });

  it('X anos e Y meses, com singular e plural', () => {
    expect(formatMonthsToTarget(29)).toEqual({ kind: 'time', text: '2 anos e 5 meses' });
    expect(formatMonthsToTarget(13)).toEqual({ kind: 'time', text: '1 ano e 1 mês' });
    expect(formatMonthsToTarget(7).text).toBe('7 meses');
    expect(formatMonthsToTarget(24).text).toBe('2 anos');
    expect(formatMonthsToTarget(1).text).toBe('1 mês');
  });
});

describe('percentuais com vírgula, sem float', () => {
  it('bp -> texto de entrada', () => {
    expect(bpToPercentInput(300)).toBe('3');
    expect(bpToPercentInput(350)).toBe('3,5');
    expect(bpToPercentInput(450)).toBe('4,5');
    expect(bpToPercentInput(425)).toBe('4,25');
    expect(bpToPercentInput(-150)).toBe('-1,5');
    expect(bpToPercentInput(5)).toBe('0,05');
    expect(bpToPercentInput(0)).toBe('0');
  });

  it('texto -> bp (vírgula, ponto, % e espaços)', () => {
    expect(percentInputToBp('3', 0, 10_000)).toBe(300);
    expect(percentInputToBp('3,5', 0, 10_000)).toBe(350);
    expect(percentInputToBp('3.5', 0, 10_000)).toBe(350);
    expect(percentInputToBp(' 4,25% ', 0, 10_000)).toBe(425);
    expect(percentInputToBp('0,05', 0, 10_000)).toBe(5);
    expect(percentInputToBp('-1,5', -9_999, 10_000)).toBe(-150);
    expect(percentInputToBp('-0', -9_999, 10_000)).toBe(0);
  });

  it('recusa formato ruim, 3 casas e fora da faixa', () => {
    for (const bad of ['', 'abc', '3,555', '3,', '1e3', '100,01', '--1']) {
      expect(percentInputToBp(bad, -9_999, 10_000)).toBeNull();
    }
    expect(percentInputToBp('0', 1, 10_000)).toBeNull();
    expect(percentInputToBp('-100', -9_999, 10_000)).toBeNull();
  });

  it('é inversa de bpToPercentInput em toda a faixa útil', () => {
    for (const bp of [0, 1, 5, 99, 100, 101, 300, 450, 1234, 10_000, -1, -9_999]) {
      expect(percentInputToBp(bpToPercentInput(bp), -9_999, 10_000)).toBe(bp);
    }
  });
});

describe('formatCompactBRL e rótulos', () => {
  it('compacta para o eixo', () => {
    expect(formatCompactBRL(cents(8_000))).toBe('R$ 80');
    expect(formatCompactBRL(cents(35_000_000))).toBe('R$ 350 mil');
    expect(formatCompactBRL(cents(120_000_000))).toBe('R$ 1,2 mi');
    expect(formatCompactBRL(cents(100_000_000))).toBe('R$ 1 mi');
    expect(formatCompactBRL(cents(0))).toBe('R$ 0');
  });

  it('eixo X em anos', () => {
    expect(yearTickLabel(0)).toBe('hoje');
    expect(yearTickLabel(12)).toBe('1 ano');
    expect(yearTickLabel(60)).toBe('5 anos');
  });

  it('viável: o texto diz o horizonte', () => {
    expect(feasibleText(true, 20)).toBe('Sim: o aporte atual chega ao alvo em até 20 anos.');
    expect(feasibleText(false, 20)).toBe('Não: com o aporte atual o alvo passa de 20 anos.');
  });
});

describe('formulário do plano', () => {
  const plan: InvestmentPlan = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aposentadoria',
    desiredMonthlyIncomeCents: cents(500_000),
    currentPortfolioCents: cents(10_000_000),
    currentMonthlyContributionCents: cents(200_000),
    inflationBp: 450 as never,
    incomeTaxBp: 1500 as never,
    targetDate: '2046-01-01',
  };
  const scenarios = [
    { label: 'conservative' as const, realReturnBp: 300 as never, withdrawalBp: 300 as never },
    { label: 'moderate' as const, realReturnBp: 500 as never, withdrawalBp: 400 as never },
    { label: 'optimistic' as const, realReturnBp: 700 as never, withdrawalBp: 500 as never },
  ];

  it('plano -> formulário -> corpo devolve os mesmos números', () => {
    const result = parsePlanForm(planToValues(plan, scenarios));
    expect(result).toEqual({
      ok: true,
      plan: {
        name: 'Aposentadoria',
        desiredMonthlyIncomeCents: 500_000,
        currentPortfolioCents: 10_000_000,
        currentMonthlyContributionCents: 200_000,
        inflationBp: 450,
        incomeTaxBp: 1500,
        targetDate: '2046-01-01',
      },
      scenarios: [
        { label: 'conservative', realReturnBp: 300, withdrawalBp: 300 },
        { label: 'moderate', realReturnBp: 500, withdrawalBp: 400 },
        { label: 'optimistic', realReturnBp: 700, withdrawalBp: 500 },
      ],
    });
  });

  it('formulário vazio de criar: defaults do modelo de dados e renda ainda sem valor (erro)', () => {
    const values = emptyPlanValues();
    expect(values.scenarios.moderate).toEqual({ returnPct: '5', withdrawalPct: '4' });
    const result = parsePlanForm(values);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['desiredIncome']);
  });

  it('recusa retirada zero, retorno fora da faixa e dinheiro negativo, cada erro no seu campo', () => {
    const values = planToValues(plan, scenarios);
    values.scenarios.moderate.withdrawalPct = '0';
    values.scenarios.optimistic.returnPct = '101';
    values.portfolio = '-5';
    const result = parsePlanForm(values);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['moderate.withdrawal', 'optimistic.return', 'portfolio']);
    }
  });

  it('sem prazo: targetDate null', () => {
    const values = planToValues({ ...plan, targetDate: null }, scenarios);
    const result = parsePlanForm(values);
    expect(result.ok && result.plan.targetDate).toBeNull();
  });

  it('valuesEqual detecta edição (botão salvar só habilita com mudança)', () => {
    const a = planToValues(plan, scenarios);
    const b = planToValues(plan, scenarios);
    expect(valuesEqual(a, b)).toBe(true);
    b.scenarios.conservative.returnPct = '2,5';
    expect(valuesEqual(a, b)).toBe(false);
  });
});
