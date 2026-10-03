import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import {
  bpToPercentInput,
  confirmationText,
  saveButtonHint,
  visibleConfirmation,
  feasibleText,
  formatCompactBRL,
  formatMonthsToTarget,
  percentInputToBp,
  yearTickLabel,
} from './display';
import { buildCreateBody, buildUpdateBody, emptyPlanValues, parsePlanForm, planToValues, valuesEqual } from './form';
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

describe('corpo do PUT a partir do formulário (bug do salvar do Ricardo)', () => {
  // O plano EXATO que ele criou: renda R$ 2.000, patrimônio ZERO, aporte R$ 500, sem prazo.
  const ricardo: InvestmentPlan = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Meu plano',
    desiredMonthlyIncomeCents: cents(200_000),
    currentPortfolioCents: cents(0),
    currentMonthlyContributionCents: cents(50_000),
    inflationBp: 450 as never,
    incomeTaxBp: 1500 as never,
    targetDate: null,
  };
  const ricardoScenarios = [
    { label: 'conservative' as const, realReturnBp: 300 as never, withdrawalBp: 300 as never },
    { label: 'moderate' as const, realReturnBp: 500 as never, withdrawalBp: 400 as never },
    { label: 'optimistic' as const, realReturnBp: 700 as never, withdrawalBp: 500 as never },
  ];

  it('plano sem prazo e patrimônio zero gera o corpo completo (targetDate null, não string vazia)', () => {
    const values = planToValues(ricardo, ricardoScenarios);
    values.contribution = 'R$ 600,00';
    expect(buildUpdateBody(values)).toEqual({
      ok: true,
      body: {
        name: 'Meu plano',
        desiredMonthlyIncomeCents: 200_000,
        currentPortfolioCents: 0,
        currentMonthlyContributionCents: 60_000,
        inflationBp: 450,
        incomeTaxBp: 1500,
        targetDate: null,
        scenarios: [
          { label: 'conservative', realReturnBp: 300, withdrawalBp: 300 },
          { label: 'moderate', realReturnBp: 500, withdrawalBp: 400 },
          { label: 'optimistic', realReturnBp: 700, withdrawalBp: 500 },
        ],
      },
    });
  });

  it('o corpo tem os 3 cenários, cada rótulo uma vez, e nenhum campo com NaN', () => {
    const result = buildUpdateBody(planToValues(ricardo, ricardoScenarios));
    if (!result.ok) throw new Error('esperava ok');
    expect(new Set(result.body.scenarios.map((s) => s.label)).size).toBe(3);
    expect(JSON.stringify(result.body)).not.toMatch(/NaN|undefined/);
  });

  it('criar usa só o plano (sem cenários)', () => {
    const values = planToValues(ricardo, ricardoScenarios);
    const result = buildCreateBody(values);
    expect(result.ok && 'scenarios' in result.body).toBe(false);
  });

  it('inválido: devolve as mensagens com o rótulo do campo, em ordem de tela, e o campo a focar', () => {
    const values = planToValues(ricardo, ricardoScenarios);
    values.scenarios.optimistic.returnPct = '7,555';
    values.contribution = 'quinhentos';
    values.tax = '150';
    const result = buildUpdateBody(values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.messages).toEqual([
      'Aporte mensal atual: Informe o aporte mensal (zero ou mais).',
      'Imposto sobre o rendimento: Informe o imposto entre 0 e 100 %.',
      'Otimista: retorno real: Retorno real entre -99,99 % e 100 % ao ano.',
    ]);
    expect(result.focusId).toBe('plan-contribution');
  });

  it('erro só em "Outras premissas" (grupo recolhido) também aponta o campo certo', () => {
    const values = planToValues(ricardo, ricardoScenarios);
    values.inflation = 'abc';
    const result = buildUpdateBody(values);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.focusId).toBe('plan-inflation');
      expect(result.messages[0]).toMatch(/^Inflação esperada ao ano:/);
    }
  });

  it('erro de cenário aponta o input do cenário (ret-/wd-)', () => {
    const values = planToValues(ricardo, ricardoScenarios);
    values.scenarios.moderate.withdrawalPct = '0';
    const result = buildUpdateBody(values);
    if (result.ok) throw new Error('esperava erro');
    expect(result.focusId).toBe('wd-moderate');
  });

  it('digitações comuns do aporte e dos percentuais passam', () => {
    for (const money of ['600', '600,00', 'R$ 600', 'R$ 600,00', '1.000,50', '0']) {
      const values = planToValues(ricardo, ricardoScenarios);
      values.contribution = money;
      expect(buildUpdateBody(values).ok, money).toBe(true);
    }
    for (const pct of ['5', '5,5', '5.5', '5,50', '5 %', ' 5% ']) {
      const values = planToValues(ricardo, ricardoScenarios);
      values.scenarios.moderate.returnPct = pct;
      expect(buildUpdateBody(values).ok, pct).toBe(true);
    }
  });
});

describe('confirmação e dica do botão salvar', () => {
  it('textos curtos de criar e salvar', () => {
    expect(confirmationText('created')).toBe('Plano criado.');
    expect(confirmationText('saved')).toBe('Alterações salvas.');
  });

  it('botão cinza por falta de mudança explica o motivo; com mudança ou enviando, nada', () => {
    expect(saveButtonHint({ dirty: false, saving: false })).toBe('Nada para salvar: altere algum valor acima.');
    expect(saveButtonHint({ dirty: true, saving: false })).toBeNull();
    expect(saveButtonHint({ dirty: false, saving: true })).toBeNull();
    expect(saveButtonHint({ dirty: true, saving: true })).toBeNull();
  });

  it('a confirmação some quando a pessoa edita (dirty) e não existe sem evento', () => {
    expect(visibleConfirmation('created', false)).toBe('Plano criado.');
    expect(visibleConfirmation('saved', false)).toBe('Alterações salvas.');
    expect(visibleConfirmation('saved', true)).toBeNull();
    expect(visibleConfirmation(null, false)).toBeNull();
  });
});
