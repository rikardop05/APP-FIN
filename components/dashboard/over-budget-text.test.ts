import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { OVER_BUDGET_INTRO, OVER_BUDGET_TITLE, overBudgetLine } from './over-budget-text';

/** `formatBRL` usa espaço inseparável depois de `R$`; normaliza para comparar. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('textos dos orçamentos estourados no painel (decisão 10b: o vermelho mede realizado + previsto)', () => {
  it('o título inclui o que ainda vai estourar', () => {
    expect(OVER_BUDGET_TITLE).toBe('Orçamentos estourados ou a caminho');
  });

  it('a explicação diz o que a cor mede', () => {
    expect(OVER_BUDGET_INTRO).toBe(
      'Categorias em vermelho na tela de Orçamento: o realizado mais o previsto a realizar do mês passa do orçado.',
    );
  });

  it('a linha nomeia o total como "esperado", não como "previsto" (a parcela planned)', () => {
    expect(plain(overBudgetLine(cents(110000), cents(100000)))).toBe(
      'R$ 1.100,00 esperados no mês (realizado + previsto) de R$ 1.000,00 orçados',
    );
  });
});
