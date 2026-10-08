import { describe, expect, it } from 'vitest';

import { budgetStatus, suggestBudgetFromHistory } from '@/lib/finance/budget';
import { basisPoints, cents } from '@/lib/money';

function budget(categoryId: string, plannedCents: number) {
  return { categoryId, plannedCents: cents(plannedCents) };
}

function spentEntry(categoryId: string, amountCents: number) {
  return { categoryId, amountCents: cents(amountCents) };
}

function hist(competence: string, categoryId: string, amountCents: number) {
  return { competence, categoryId, amountCents: cents(amountCents) };
}

const WARN_8000 = basisPoints(8000);

describe('budgetStatus — os quatro limites exatos do semaforo', () => {
  // Orcamento de R$ 1.000,00 = 100000 centavos, para o gasto cair em bp exatos.
  it('79,99% (7999 bp) e verde', () => {
    // 79990 / 100000 = 0,7999 = 7999 bp < 8000 -> verde.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -79990)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(7999);
    expect(result[0]?.light).toBe('green');
    // 100000 - 79990 = 20010.
    expect(result[0]?.remainingCents).toBe(20010);
  });

  it('80,00% (8000 bp) e amarelo', () => {
    // 80000 / 100000 = 8000 bp, exatamente o warnBp -> amarelo (inclusivo).
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -80000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(8000);
    expect(result[0]?.light).toBe('yellow');
    expect(result[0]?.remainingCents).toBe(20000);
  });

  it('100,00% (10000 bp) e amarelo', () => {
    // 100000 / 100000 = 10000 bp, no teto mas sem estourar -> amarelo.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -100000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(10000);
    expect(result[0]?.light).toBe('yellow');
    expect(result[0]?.remainingCents).toBe(0);
  });

  it('100,01% (10001 bp) e vermelho', () => {
    // 100010 / 100000 = 1,0001 = 10001 bp > 10000 -> vermelho.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -100010)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(10001);
    expect(result[0]?.light).toBe('red');
    expect(result[0]?.remainingCents).toBe(-10);
  });

  it('usageBp arredonda para o bp mais proximo e a cor usa o mesmo inteiro', () => {
    // 15999 / 20000 = 0,79995 = 7999,5 bp -> arredonda para 8000 bp -> amarelo.
    // A cor segue o bp arredondado, o MESMO numero que a tela exibe (80,00%),
    // entao percentual e cor nunca divergem (achado do Corvo).
    const result = budgetStatus({
      budgets: [budget('a', 20000)],
      spent: [spentEntry('a', -15999)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(8000);
    expect(result[0]?.light).toBe('yellow');
  });

  it('usa o warnBp recebido, nao um 80% fixo', () => {
    // warnBp 5000: 4999 bp verde, 5000 bp amarelo.
    const green = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -49990)],
      warnBp: basisPoints(5000),
    });
    expect(green[0]?.usageBp).toBe(4999);
    expect(green[0]?.light).toBe('green');

    const yellow = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -50000)],
      warnBp: basisPoints(5000),
    });
    expect(yellow[0]?.usageBp).toBe(5000);
    expect(yellow[0]?.light).toBe('yellow');
  });
});

describe('budgetStatus — sinal e agregacao de spent (§14)', () => {
  it('agrega varios lancamentos da mesma categoria (despesa negativa)', () => {
    // -50000 + -30000 = -80000 -> spent 80000, usage 8000 -> amarelo.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -50000), spentEntry('a', -30000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.spentCents).toBe(80000);
    expect(result[0]?.usageBp).toBe(8000);
    expect(result[0]?.light).toBe('yellow');
  });

  it('estorno reduz o gasto do mes', () => {
    // -100000 + 40000 (estorno) = -60000 -> spent 60000, usage 6000 -> verde.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -100000), spentEntry('a', 40000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.spentCents).toBe(60000);
    expect(result[0]?.usageBp).toBe(6000);
    expect(result[0]?.light).toBe('green');
  });

  it('estorno que supera o gasto nao vira despesa negativa', () => {
    // -10000 + 30000 = +20000 -> max(0, -20000) = 0 -> spent 0, verde.
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -10000), spentEntry('a', 30000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.spentCents).toBe(0);
    expect(result[0]?.usageBp).toBe(0);
    expect(result[0]?.light).toBe('green');
    expect(result[0]?.remainingCents).toBe(100000);
  });

  it('categoria que so aparece em spent, sem orcamento, nao gera linha', () => {
    const result = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -1000), spentEntry('b', -9999)],
      warnBp: WARN_8000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.categoryId).toBe('a');
  });

  it('devolve uma linha por orcamento, na ordem recebida', () => {
    const result = budgetStatus({
      budgets: [budget('z', 100000), budget('a', 50000)],
      spent: [],
      warnBp: WARN_8000,
    });
    expect(result.map((row) => row.categoryId)).toEqual(['z', 'a']);
  });

  it('arredonda usageBp para o bp mais proximo', () => {
    // 100 / 300 = 33,333...% = 3333,33 bp -> 3333.
    const result = budgetStatus({
      budgets: [budget('a', 300)],
      spent: [spentEntry('a', -100)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBe(3333);
  });
});

describe('budgetStatus — orcamento zero', () => {
  it('orcamento zero sem gasto: usageBp null e verde', () => {
    const result = budgetStatus({
      budgets: [budget('a', 0)],
      spent: [],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBeNull();
    expect(result[0]?.spentCents).toBe(0);
    expect(result[0]?.remainingCents).toBe(0);
    expect(result[0]?.light).toBe('green');
  });

  it('orcamento zero com gasto: usageBp null e vermelho (nao esconde o estouro)', () => {
    // Sem orcamento definido, mas gastou 5000: o tipo nao tem "sem semaforo",
    // e verde aqui esconderia o gasto. Vermelho.
    const result = budgetStatus({
      budgets: [budget('a', 0)],
      spent: [spentEntry('a', -5000)],
      warnBp: WARN_8000,
    });
    expect(result[0]?.usageBp).toBeNull();
    expect(result[0]?.spentCents).toBe(5000);
    expect(result[0]?.remainingCents).toBe(-5000);
    expect(result[0]?.light).toBe('red');
  });
});

describe('budgetStatus — validacao', () => {
  it('recusa warnBp fora de 0..10000', () => {
    expect(() =>
      budgetStatus({ budgets: [], spent: [], warnBp: basisPoints(-1) }),
    ).toThrow(RangeError);
    expect(() =>
      budgetStatus({ budgets: [], spent: [], warnBp: basisPoints(10001) }),
    ).toThrow(RangeError);
  });

  it('recusa plannedCents negativo', () => {
    expect(() =>
      budgetStatus({
        budgets: [budget('a', -1)],
        spent: [],
        warnBp: WARN_8000,
      }),
    ).toThrow(RangeError);
  });
});

describe('suggestBudgetFromHistory', () => {
  it('media dos ultimos 3 meses, ancorada na maior competencia', () => {
    // 'a' em jan/fev/mar (-30000 cada): soma -90000 -> 90000 / 3 = 30000.
    // 'b' so em marco (-6000): 6000 / 3 = 2000 (fev e jan vazios contam zero).
    const result = suggestBudgetFromHistory(
      [
        hist('2026-01', 'a', -30000),
        hist('2026-02', 'a', -30000),
        hist('2026-03', 'a', -30000),
        hist('2026-03', 'b', -6000),
      ],
      { months: 3 },
    );
    expect(result).toEqual([
      { categoryId: 'a', suggestedCents: 30000 },
      { categoryId: 'b', suggestedCents: 2000 },
    ]);
  });

  it('months 1 repete o mes mais recente', () => {
    const result = suggestBudgetFromHistory(
      [hist('2026-02', 'a', -11111), hist('2026-03', 'a', -22222)],
      { months: 1 },
    );
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 22222 }]);
  });

  it('mes sem lancamento conta como zero na media', () => {
    // 'a' em jan e mar, nada em fev: -60000 / 3 = 20000 (nao 30000).
    const result = suggestBudgetFromHistory(
      [hist('2026-01', 'a', -30000), hist('2026-03', 'a', -30000)],
      { months: 3 },
    );
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 20000 }]);
  });

  it('categoria com gasto so fora da janela nao aparece', () => {
    // 'c' em dez/2025 esta 3 meses antes de marco -> fora da janela de 3.
    const result = suggestBudgetFromHistory(
      [hist('2025-12', 'c', -9999), hist('2026-03', 'a', -30000)],
      { months: 3 },
    );
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 10000 }]);
  });

  it('estorno que supera o gasto na janela zera a sugestao (§14)', () => {
    // -10000 + 30000 = +20000 -> max(0, -20000) = 0 -> sugestao 0.
    const result = suggestBudgetFromHistory(
      [hist('2026-03', 'a', -10000), hist('2026-03', 'a', 30000)],
      { months: 1 },
    );
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 0 }]);
  });

  it('arredonda a media para o centavo mais proximo', () => {
    // 10000 / 3 = 3333,33 -> 3333; 10001 / 3 = 3333,67 -> 3334.
    expect(
      suggestBudgetFromHistory([hist('2026-03', 'a', -10000)], { months: 3 }),
    ).toEqual([{ categoryId: 'a', suggestedCents: 3333 }]);
    expect(
      suggestBudgetFromHistory([hist('2026-03', 'a', -10001)], { months: 3 }),
    ).toEqual([{ categoryId: 'a', suggestedCents: 3334 }]);
  });

  it('historico vazio devolve lista vazia', () => {
    expect(suggestBudgetFromHistory([], { months: 3 })).toEqual([]);
  });

  it('recusa months menor que 1 ou fracionario', () => {
    expect(() =>
      suggestBudgetFromHistory([hist('2026-03', 'a', -1)], { months: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      suggestBudgetFromHistory([hist('2026-03', 'a', -1)], { months: -3 }),
    ).toThrow(RangeError);
    expect(() =>
      suggestBudgetFromHistory([hist('2026-03', 'a', -1)], { months: 1.5 }),
    ).toThrow(RangeError);
  });

  it('recusa competencia invalida no historico', () => {
    expect(() =>
      suggestBudgetFromHistory([hist('2026-13', 'a', -1)], { months: 1 }),
    ).toThrow(RangeError);
  });
});

describe('suggestBudgetFromHistory — opts.anchor (a janela ancora no que o chamador diz)', () => {
  it('SEM anchor, repetir o mes anterior repete o de DOIS meses atras quando o anterior esteve vazio (o defeito)', () => {
    // Orcamento de outubro; setembro (o mes anterior) nao teve gasto; agosto teve 90.000.
    const result = suggestBudgetFromHistory([hist('2026-08', 'a', -90000)], { months: 1 });
    // Comportamento antigo, preservado como default: ancora na propria historia.
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 90000 }]);
  });

  it('COM anchor no mes anterior vazio, "repetir o mes anterior" nao sugere nada', () => {
    const result = suggestBudgetFromHistory([hist('2026-08', 'a', -90000)], {
      months: 1,
      anchor: '2026-09',
    });
    expect(result).toEqual([]);
  });

  it('com anchor, a media de 3 meses divide por 3 mesmo com o mes mais recente vazio', () => {
    // Janela jul..set. Gasto so em julho: 90.000 / 3 = 30.000, e nao 90.000 / 1.
    const result = suggestBudgetFromHistory([hist('2026-07', 'a', -90000)], {
      months: 3,
      anchor: '2026-09',
    });
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 30000 }]);
  });

  it('ignora lancamento posterior ao anchor (o mes que esta sendo orcado nao entra)', () => {
    const result = suggestBudgetFromHistory(
      [hist('2026-09', 'a', -50000), hist('2026-10', 'a', -999999)],
      { months: 1, anchor: '2026-09' },
    );
    expect(result).toEqual([{ categoryId: 'a', suggestedCents: 50000 }]);
  });

  it('anchor igual a maior competencia do historico da o mesmo resultado do default', () => {
    const history = [hist('2026-08', 'a', -30000), hist('2026-09', 'a', -60000)];
    expect(suggestBudgetFromHistory(history, { months: 2, anchor: '2026-09' })).toEqual(
      suggestBudgetFromHistory(history, { months: 2 }),
    );
  });

  it('anchor invalido lanca (sem fallback)', () => {
    expect(() =>
      suggestBudgetFromHistory([hist('2026-09', 'a', -100)], { months: 1, anchor: '2026-13' }),
    ).toThrow();
  });
});

describe('budgetStatus — semaforo sobre o TOTAL ESPERADO (decisao 10b, 2026-10-07)', () => {
  it('o caso do Ricardo: gastou 100, vem 800, orcamento 1.000 -> 90% amarelo, folga de 100', () => {
    // realizado 10.000 + previsto 80.000 = esperado 90.000; 90.000 / 100.000 = 9.000 bp.
    const [row] = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -10000)],
      upcoming: [spentEntry('a', -80000)],
      warnBp: WARN_8000,
    });
    expect(row).toEqual({
      categoryId: 'a',
      plannedCents: 100000,
      spentCents: 10000,
      upcomingCents: 80000,
      expectedCents: 90000,
      remainingCents: 10000,
      usageBp: 9000,
      light: 'yellow',
    });
  });

  it('dia 1 com recorrente acima do orcamento: nada realizado e ja vermelho', () => {
    // 0 + 120.000 = 120.000 / 100.000 = 12.000 bp > 10.000.
    const [row] = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [],
      upcoming: [spentEntry('a', -120000)],
      warnBp: WARN_8000,
    });
    expect(row).toMatchObject({ spentCents: 0, upcomingCents: 120000, expectedCents: 120000, usageBp: 12000, light: 'red', remainingCents: -20000 });
  });

  it('sem `upcoming`: esperado = realizado (quem nao manda previsto ve o comportamento antigo)', () => {
    const [row] = budgetStatus({ budgets: [budget('a', 100000)], spent: [spentEntry('a', -80000)], warnBp: WARN_8000 });
    expect(row).toMatchObject({ spentCents: 80000, upcomingCents: 0, expectedCents: 80000, usageBp: 8000, light: 'yellow' });
  });

  it('cada parcela passa por max(0, -soma) separada: estorno no realizado nao come o previsto', () => {
    // Realizado liquido +5.000 (estorno maior que o gasto) -> 0; previsto 30.000 -> esperado 30.000.
    const [row] = budgetStatus({
      budgets: [budget('a', 100000)],
      spent: [spentEntry('a', -1000), spentEntry('a', 6000)],
      upcoming: [spentEntry('a', -30000)],
      warnBp: WARN_8000,
    });
    expect(row).toMatchObject({ spentCents: 0, upcomingCents: 30000, expectedCents: 30000, usageBp: 3000 });
  });

  it('orcamento zero com so previsto: usageBp null e vermelho (o mes vai estourar)', () => {
    const [row] = budgetStatus({ budgets: [budget('a', 0)], spent: [], upcoming: [spentEntry('a', -500)], warnBp: WARN_8000 });
    expect(row).toMatchObject({ usageBp: null, expectedCents: 500, light: 'red', remainingCents: -500 });
  });
});
