import { describe, expect, it } from 'vitest';

import { basisPoints, cents } from '@/lib/money';

import { LIGHT_VIEW, competenceLabel, competenceTitle, EXPECTED_LABEL, expectedUsageText, remainingText } from './labels';

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

describe('título do mês no Orçamento (competência por extenso, "de" em minúscula)', () => {
  it('capitaliza só a primeira letra: "Outubro de 2026", nunca "Outubro De 2026"', () => {
    expect(competenceTitle('2026-10')).toBe('Outubro de 2026');
    expect(competenceTitle('2027-01')).toBe('Janeiro de 2027');
    expect(competenceTitle('2026-03')).toBe('Março de 2026');
  });

  it('o rótulo corrido continua em minúscula (usado no meio de frase)', () => {
    expect(competenceLabel('2026-10')).toBe('outubro de 2026');
  });
});

describe('semáforo do Orçamento usa os tokens plenos de estado', () => {
  it('cada cor da barra é um token que existe (verde, âmbar, carimbo), sem sobra de dígito', () => {
    expect(LIGHT_VIEW.green.bar).toBe('bg-success');
    expect(LIGHT_VIEW.yellow.bar).toBe('bg-warning');
    expect(LIGHT_VIEW.red.bar).toBe('bg-destructive');
  });
});
