import { describe, expect, it } from 'vitest';

import { formatMonthsToTarget, scenarioVerdict } from './display';

describe('scenarioVerdict: carimbo só no cenário de referência', () => {
  it('o Médio leva carimbo: verde se alcança, vermelho se não', () => {
    expect(scenarioVerdict('moderate', true)).toEqual({ mode: 'stamp', tone: 'ok', text: 'Alcança' });
    expect(scenarioVerdict('moderate', false)).toEqual({ mode: 'stamp', tone: 'danger', text: 'Não alcança' });
  });

  it('Conservador e Otimista dizem o veredito num Badge com ícone, e "não alcança" é atenção, nunca perigo', () => {
    for (const label of ['conservative', 'optimistic'] as const) {
      expect(scenarioVerdict(label, true)).toEqual({ mode: 'badge', tone: 'success', text: 'Alcança' });
      expect(scenarioVerdict(label, false)).toEqual({ mode: 'badge', tone: 'warning', text: 'Não alcança' });
    }
  });
});

describe('formatMonthsToTarget: o prazo por extenso', () => {
  it('786 meses = 65 anos e 6 meses; singular e plural; só anos; só meses', () => {
    expect(formatMonthsToTarget(786).text).toBe('65 anos e 6 meses');
    expect(formatMonthsToTarget(13).text).toBe('1 ano e 1 mês');
    expect(formatMonthsToTarget(24).text).toBe('2 anos');
    expect(formatMonthsToTarget(5).text).toBe('5 meses');
  });
});
