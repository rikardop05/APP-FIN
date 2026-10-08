import { describe, expect, it } from 'vitest';

import { basisPoints, cents } from '@/lib/money';

import { EXPECTED_LABEL, expectedUsageText, remainingText } from './labels';

/** `formatBRL` usa espaço inseparável depois de `R$`; normaliza para comparar. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('rótulos do que a cor mede (decisão 10b: realizado + previsto)', () => {
  it('o nome da medida diz as duas parcelas', () => {
    expect(EXPECTED_LABEL).toBe('Realizado + previsto');
  });

  it('uso: o percentual do orçamento que o mês deve consumir', () => {
    expect(expectedUsageText(basisPoints(9500))).toBe('Realizado + previsto: 95,00% do orçamento');
    expect(expectedUsageText(null)).toBe('Realizado + previsto: sem valor orçado');
  });

  it('folga contando o previsto, ou quanto vai passar', () => {
    expect(plain(remainingText(cents(5000)))).toBe('Restam R$ 50,00 contando o previsto');
    expect(plain(remainingText(cents(0)))).toBe('Restam R$ 0,00 contando o previsto');
    expect(plain(remainingText(cents(-20000)))).toBe('Passa R$ 200,00 do orçamento contando o previsto');
  });
});
