import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { RECONCILE_EXPLANATION, reconcileQuestion } from './reconcile-question';

/** `formatBRL` usa espaço inseparável depois de `R$`; normaliza para comparar. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('pergunta do lançamento manual que cumpre uma previsão (decisão 16a)', () => {
  it('nomeia a previsão, a data e o valor previsto, sem sinal', () => {
    expect(
      plain(reconcileQuestion({ plannedId: 'x', description: 'Conta de luz', occurredOn: '2026-11-05', amountCents: cents(-18000) })),
    ).toBe('Este lançamento cumpre a previsão “Conta de luz” de 05/11/2026, de R$ 180,00?');
    expect(
      plain(reconcileQuestion({ plannedId: 'y', description: 'Salário', occurredOn: '2026-11-05', amountCents: cents(740000) })),
    ).toBe('Este lançamento cumpre a previsão “Salário” de 05/11/2026, de R$ 7.400,00?');
  });

  it('a explicação diz o que muda e que recusar grava normal', () => {
    expect(RECONCILE_EXPLANATION).toBe(
      'Se sim, a previsão sai do orçamento, do painel e do fluxo, e o valor conta uma vez só. Se não, o lançamento é gravado à parte e a previsão continua em aberto.',
    );
  });
});
