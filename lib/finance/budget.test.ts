import { describe, expect, it } from 'vitest';

import {
  budgetMonthTotals,
  budgetStatus,
  spendOutsideCategories,
  suggestBudgetFromHistory,
  unbudgetedSpend,
} from '@/lib/finance/budget';
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

describe('unbudgetedSpend — gasto em categoria sem orcamento salvo', () => {
  it('mes sem nenhum orcamento: cada categoria com gasto sai com realizado e previsto', () => {
    // mercado: 300,00 + 200,00 realizados = 500,00; previsto 100,00; esperado 600,00.
    // lazer: so previsto de 80,00.
    const rows = unbudgetedSpend({
      budgetedCategoryIds: [],
      spent: [spentEntry('mercado', -30000), spentEntry('mercado', -20000)],
      upcoming: [spentEntry('mercado', -10000), spentEntry('lazer', -8000)],
    });
    expect(rows).toEqual([
      { categoryId: 'mercado', spentCents: 50000, upcomingCents: 10000, expectedCents: 60000 },
      { categoryId: 'lazer', spentCents: 0, upcomingCents: 8000, expectedCents: 8000 },
    ]);
  });

  it('categoria COM orcamento nao sai aqui (ela e linha de budgetStatus), nem com orcamento zero', () => {
    const rows = unbudgetedSpend({
      budgetedCategoryIds: ['mercado', 'zero'],
      spent: [spentEntry('mercado', -100), spentEntry('zero', -200), spentEntry('lazer', -300)],
    });
    expect(rows).toEqual([{ categoryId: 'lazer', spentCents: 300, upcomingCents: 0, expectedCents: 300 }]);
  });

  it('estorno que zera ou supera o gasto nao gera linha (§14), e nao come o previsto', () => {
    // a: -100 + 150 = +50 -> realizado 0, sem previsto: sem linha.
    // b: -100 + 150 = +50 -> realizado 0; previsto 70 fica inteiro.
    const rows = unbudgetedSpend({
      budgetedCategoryIds: [],
      spent: [spentEntry('a', -100), spentEntry('a', 150), spentEntry('b', -100), spentEntry('b', 150)],
      upcoming: [spentEntry('b', -70)],
    });
    expect(rows).toEqual([{ categoryId: 'b', spentCents: 0, upcomingCents: 70, expectedCents: 70 }]);
  });

  it('allowedCategoryIds restringe as categorias; ausente, vale todas', () => {
    const spent = [spentEntry('folha', -100), spentEntry('raiz', -200)];
    expect(unbudgetedSpend({ budgetedCategoryIds: [], spent, allowedCategoryIds: ['folha'] })).toEqual([
      { categoryId: 'folha', spentCents: 100, upcomingCents: 0, expectedCents: 100 },
    ]);
    expect(unbudgetedSpend({ budgetedCategoryIds: [], spent })).toHaveLength(2);
  });

  it('nada gasto: lista vazia', () => {
    expect(unbudgetedSpend({ budgetedCategoryIds: ['a'], spent: [], upcoming: [] })).toEqual([]);
  });
});

describe('spendOutsideCategories — despesa que nenhuma linha do Orcamento mostra', () => {
  const entry = (categoryId: string | null, amountCents: number) => ({ categoryId, amountCents: cents(amountCents) });

  it('soma sem categoria, raiz e natureza nao orcavel; categoria orcavel fica de fora', () => {
    // sem categoria: 500,00 + 300,00 = 800,00; raiz: 100,00; mercado (orcavel) nao entra.
    // previsto: so a raiz, 50,00.
    const result = spendOutsideCategories({
      spent: [entry(null, -50000), entry(null, -30000), entry('raiz', -10000), entry('mercado', -435577)],
      upcoming: [entry('raiz', -5000), entry('mercado', -9999)],
      allowedCategoryIds: ['mercado'],
    });
    expect(result).toEqual({ spentCents: 90000, upcomingCents: 5000, expectedCents: 95000 });
  });

  it('estorno maior que o gasto de UM grupo nao desconta do outro (§14)', () => {
    // sem categoria: -100 + 300 = +200 -> 0; raiz: 400.
    const result = spendOutsideCategories({
      spent: [entry(null, -100), entry(null, 300), entry('raiz', -400)],
      allowedCategoryIds: [],
    });
    expect(result).toEqual({ spentCents: 400, upcomingCents: 0, expectedCents: 400 });
  });

  it('tudo em categoria orcavel, ou nada: zero', () => {
    const zero = { spentCents: 0, upcomingCents: 0, expectedCents: 0 };
    expect(spendOutsideCategories({ spent: [entry('a', -100)], allowedCategoryIds: ['a'] })).toEqual(zero);
    expect(spendOutsideCategories({ spent: [], upcoming: [], allowedCategoryIds: [] })).toEqual(zero);
  });
});

describe('budgetMonthTotals — o total do topo do Orcamento', () => {
  const line = (plannedCents: number, spentCents: number, upcomingCents: number) => ({
    plannedCents: cents(plannedCents),
    spentCents: cents(spentCents),
    upcomingCents: cents(upcomingCents),
  });
  const loose = (spentCents: number, upcomingCents: number) => ({
    spentCents: cents(spentCents),
    upcomingCents: cents(upcomingCents),
  });

  it('soma as linhas com orcamento e calcula uso, folga e cor', () => {
    // orcado 1.000 + 1.000 = 2.000; realizado 500 + 100 = 600; previsto 100 + 100 = 200;
    // esperado 800; folga 1.200; uso 800/2.000 = 40%.
    const totals = budgetMonthTotals({
      rows: [line(100000, 50000, 10000), line(100000, 10000, 10000)],
      unbudgeted: [],
      warnBp: WARN_8000,
    });
    expect(totals.budgeted).toEqual({
      plannedCents: 200000,
      spentCents: 60000,
      upcomingCents: 20000,
      expectedCents: 80000,
      remainingCents: 120000,
      usageBp: 4000,
      light: 'green',
    });
    expect(totals.unbudgeted).toEqual({ spentCents: 0, upcomingCents: 0, expectedCents: 0 });
    expect(totals.outside).toEqual({ spentCents: 0, upcomingCents: 0, expectedCents: 0 });
  });

  it('o gasto fora das categorias passa adiante e NAO entra no uso', () => {
    const outside = { spentCents: cents(80000), upcomingCents: cents(0), expectedCents: cents(80000) };
    const totals = budgetMonthTotals({ rows: [line(100000, 50000, 0)], unbudgeted: [], outside, warnBp: WARN_8000 });
    expect(totals.outside).toEqual(outside);
    expect(totals.budgeted).toMatchObject({ usageBp: 5000, light: 'green' });
  });

  it('SEM orcamento salvo: mostra o gasto, sem cor e sem uso (nunca "estourou")', () => {
    // realizado 5.155,77 = 4.000,00 + 1.155,77; previsto 300,00.
    const totals = budgetMonthTotals({
      rows: [],
      unbudgeted: [loose(400000, 30000), loose(115577, 0)],
      warnBp: WARN_8000,
    });
    expect(totals.unbudgeted).toEqual({ spentCents: 515577, upcomingCents: 30000, expectedCents: 545577 });
    expect(totals.budgeted.light).toBeNull();
    expect(totals.budgeted.usageBp).toBeNull();
    expect(totals.budgeted.plannedCents).toBe(0);
    expect(totals.budgeted.expectedCents).toBe(0);
  });

  it('gasto sem orcamento NAO entra no uso nem na cor do total', () => {
    // orcado 1.000, esperado 500 -> 50% verde, mesmo com 9.000 gastos fora do orcamento.
    const totals = budgetMonthTotals({
      rows: [line(100000, 50000, 0)],
      unbudgeted: [loose(900000, 0)],
      warnBp: WARN_8000,
    });
    expect(totals.budgeted).toMatchObject({ usageBp: 5000, light: 'green', remainingCents: 50000 });
    expect(totals.unbudgeted.expectedCents).toBe(900000);
  });

  it('amarelo a partir do aviso, vermelho acima de 100%', () => {
    const light = (expected: number) =>
      budgetMonthTotals({ rows: [line(1000, 0, expected)], unbudgeted: [], warnBp: WARN_8000 }).budgeted;
    expect(light(799).light).toBe('green');
    expect(light(800).light).toBe('yellow');
    expect(light(1000).light).toBe('yellow');
    expect(light(1001)).toMatchObject({ light: 'red', remainingCents: -1 });
  });

  it('so orcamento ZERO com gasto: vermelho sem percentual (orcamento zero e limite explicito)', () => {
    const totals = budgetMonthTotals({ rows: [line(0, 500, 0)], unbudgeted: [], warnBp: WARN_8000 });
    expect(totals.budgeted).toMatchObject({ usageBp: null, light: 'red', remainingCents: -500 });
  });

  it('nada no mes: tudo zero e sem cor', () => {
    const totals = budgetMonthTotals({ rows: [], unbudgeted: [], warnBp: WARN_8000 });
    expect(totals.budgeted.light).toBeNull();
    expect(totals.unbudgeted.expectedCents).toBe(0);
  });

  it('recusa warnBp fora de 0..10000', () => {
    expect(() => budgetMonthTotals({ rows: [], unbudgeted: [], warnBp: basisPoints(10001) })).toThrow(RangeError);
  });
});
