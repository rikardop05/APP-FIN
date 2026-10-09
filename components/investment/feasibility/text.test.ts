import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import type { InvestmentScenario, InvestmentSurplus } from '../schemas';

import { basisText, feasibilityLine, noScenarioFits, surplusBasisText } from './text';

const surplus = (averageMonthlyCents: number | null): InvestmentSurplus => ({
  averageMonthlyCents: averageMonthlyCents === null ? null : cents(averageMonthlyCents),
  monthsWithData: 3,
  windowFrom: '2026-07',
  windowTo: '2026-09',
});

type Feasibility = NonNullable<InvestmentScenario['feasibility']>;
const feasibility = (patch: Partial<Feasibility>): Feasibility => ({
  basis: { kind: 'horizon', years: 20 },
  requiredCents: cents(100_000),
  gapCents: cents(0),
  feasible: true,
  surplusUsageBp: null,
  ...patch,
});

/** `formatBRL` usa espaço inseparável depois de `R$`; normaliza para comparar. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('basisText — a tela diz contra qual horizonte compara', () => {
  it('prazo do plano e horizonte', () => {
    expect(basisText({ kind: 'targetDate', months: 30 })).toBe('até o prazo do plano (2 anos e 6 meses)');
    expect(basisText({ kind: 'horizon', years: 20 })).toBe('em 20 anos');
  });
});

describe('feasibilityLine — "Cabe na sua sobra?"', () => {
  it('sem histórico de sobra', () => {
    expect(feasibilityLine(null, surplus(null))).toMatchObject({ tone: 'neutral', answer: 'Sem histórico de sobra' });
  });

  it('cabe: mostra o aporte, a sobra e a fração usada', () => {
    const view = feasibilityLine(feasibility({ surplusUsageBp: 6_250 as never }), surplus(160_000));
    expect(view.tone).toBe('ok');
    expect(view.answer).toBe('Sim');
    expect(plain(view.detail)).toBe(
      'O aporte necessário em 20 anos, R$ 1.000,00 por mês, cabe na sua sobra média de R$ 1.600,00 por mês (62,5% dela).',
    );
  });

  it('não cabe: a lacuna em R$ na resposta', () => {
    const view = feasibilityLine(
      feasibility({ basis: { kind: 'targetDate', months: 24 }, requiredCents: cents(300_000), gapCents: cents(50_000), feasible: false, surplusUsageBp: 12_000 as never }),
      surplus(250_000),
    );
    expect(view.tone).toBe('gap');
    expect(plain(view.answer)).toBe('Não: faltam R$ 500,00 por mês');
    expect(plain(view.detail)).toBe(
      'O aporte necessário até o prazo do plano (2 anos) é de R$ 3.000,00 por mês, e sua sobra média é de R$ 2.500,00 por mês.',
    );
  });

  it('não cabe porque não sobrou nada (déficit)', () => {
    const view = feasibilityLine(feasibility({ gapCents: cents(100_000), feasible: false }), surplus(-30_000));
    expect(plain(view.answer)).toBe('Não: faltam R$ 1.000,00 por mês');
    expect(plain(view.detail)).toContain('nos últimos meses não sobrou dinheiro (média de -R$ 300,00 por mês)');
  });

  it('meta que não pede aporte cabe sempre', () => {
    expect(feasibilityLine(feasibility({ requiredCents: cents(0) }), surplus(-1)).detail).toBe(
      'A meta não pede aporte em 20 anos: o patrimônio atual já basta.',
    );
  });
});

describe('alerta do topo e base da sobra', () => {
  const scenario = (value: Feasibility | null) => ({ feasibility: value }) as InvestmentScenario;

  it('alerta só quando há sobra e nenhum cenário cabe', () => {
    const gap = feasibility({ feasible: false, gapCents: cents(1) });
    expect(noScenarioFits([scenario(gap), scenario(gap)], surplus(10))).toBe(true);
    expect(noScenarioFits([scenario(gap), scenario(feasibility({}))], surplus(10))).toBe(false);
    expect(noScenarioFits([scenario(null)], surplus(null))).toBe(false);
    expect(noScenarioFits([], surplus(10))).toBe(false);
  });

  it('de onde vem a média', () => {
    expect(surplusBasisText(surplus(1))).toBe('média de 3 meses com lançamentos, entre julho de 2026 e setembro de 2026');
    expect(surplusBasisText({ ...surplus(1), monthsWithData: 1 })).toContain('média de 1 mês');
  });
});

describe('surplusExcludedText: a tela diz quais meses ficaram fora da média', () => {
  it('sem exclusão (ou campo ausente) não diz nada', async () => {
    const { surplusExcludedText } = await import('./text');
    expect(surplusExcludedText(surplus(10_000))).toBeNull();
    expect(surplusExcludedText({ ...surplus(10_000), excludedMonths: [] })).toBeNull();
  });

  it('nomeia os meses fora, no singular e no plural', async () => {
    const { surplusExcludedText } = await import('./text');
    expect(surplusExcludedText({ ...surplus(10_000), excludedMonths: ['2026-07'] })).toMatch(
      /^Ficou fora da média 1 mês, por não terem receita lançada: /,
    );
    const two = surplusExcludedText({ ...surplus(10_000), excludedMonths: ['2026-07', '2026-08'] });
    expect(two).toMatch(/^Ficaram fora da média 2 meses/);
    expect(two).toMatch(/ e /);
  });
});
