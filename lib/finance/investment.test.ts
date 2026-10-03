import { describe, expect, it } from 'vitest';

import {
  accumulationCurve,
  contributionFeasibility,
  DEFAULT_HORIZONS_YEARS,
  futureValue,
  monthlyRate,
  monthsToTarget,
  projectedMonthlyIncome,
  requiredContribution,
  scenarioTable,
  targetPortfolio,
  type ScenarioParams,
} from '@/lib/finance/investment';
import { basisPoints, cents } from '@/lib/money';

/**
 * Como os valores esperados foram obtidos — NENHUM veio da saida deste modulo.
 *
 * - Casos de mao: escolhidos para a conta fechar no papel. Tres familias:
 *   `r = 0` (inteiros puros: P0 + A*n); `r = 40.950.000 bp`, isto e
 *   1 + r = 4096 = 2^12, de modo que i = 2^1 - 1 = 1 (100 % a.m.) e
 *   (1 + i)^n = 2^n; e n multiplo de 12, em que (1 + i)^n = (1 + r)^(n/12)
 *   e a capitalizacao anual direta (1,12^1 = 1,12).
 * - Casos realistas (5 %, 20 anos): a conta esta escrita no comentario com os
 *   fatores intermediarios, conferidos num oraculo independente em Python
 *   `decimal` com 50 digitos (ln/exp do proprio Decimal), sem ler este codigo.
 */

const bp = basisPoints;
const c = cents;

/** 1 + r = 4096 = 2^12  =>  i = 4096^(1/12) - 1 = 2 - 1 = 1 (100 % a.m.). */
const DOUBLING_MONTHLY = bp(40_950_000);

describe('monthlyRate — raiz 12, nunca /12', () => {
  it('taxa zero da zero', () => {
    expect(monthlyRate(bp(0))).toBe(0);
  });

  it('1 + r = 2^12 da exatamente 100 % ao mes', () => {
    // (1 + 409,5)^(1/12) - 1 = 4096^(1/12) - 1 = 2 - 1 = 1.
    expect(monthlyRate(DOUBLING_MONTHLY)).toBeCloseTo(1, 12);
  });

  it('5 % a.a. da 0,40741237836 % a.m., e NAO 0,41666 % (r/12)', () => {
    // i = 1,05^(1/12) - 1 = e^(ln 1,05 / 12) - 1
    //   ln 1,05 = 0,048790164169432; / 12 = 0,004065847014119
    //   e^0,004065847014119 = 1,004074123783648 -> i = 0,004074123783648
    // Prova de volta: 1,004074123783648^12 = e^(12 * 0,004065847014119) = e^0,048790164 = 1,05.
    // r/12 = 0,05/12 = 0,004166666666667 — diferente na 4a casa.
    const i = monthlyRate(bp(500));
    expect(i).toBeCloseTo(0.004074123783648, 14);
    expect((1 + i) ** 12).toBeCloseTo(1.05, 13);
    expect(Math.abs(i - 0.05 / 12)).toBeGreaterThan(0.00009);
  });

  it('12 % a.a. da 0,9488792935 % a.m., e NAO 1 %', () => {
    // i = 1,12^(1/12) - 1: ln 1,12 = 0,113328685307003; / 12 = 0,009444057108917
    //   e^0,009444057108917 = 1,009488792934583 -> i = 0,009488792934583.
    expect(monthlyRate(bp(1200))).toBeCloseTo(0.009488792934583, 14);
  });

  it('retorno real negativo da taxa mensal negativa', () => {
    // -50 % a.a.: 0,5^(1/12) - 1 = e^(-0,693147180559945/12) - 1
    //   = e^(-0,057762265046662) - 1 = 0,943874312681693 - 1 = -0,056125687318307.
    expect(monthlyRate(bp(-5000))).toBeCloseTo(-0.056125687318307, 14);
  });

  it('retorno de -100 % ou pior lanca: (1 + r) <= 0 nao tem raiz 12 real', () => {
    expect(() => monthlyRate(bp(-10_000))).toThrow(RangeError);
    expect(() => monthlyRate(bp(-12_000))).toThrow(RangeError);
  });
});

describe('targetPortfolio — (R * 12) / w', () => {
  it('defaults de DATA-MODEL para R$ 10.000/mes', () => {
    // R = 1.000.000 c. R*12 = 12.000.000 c (R$ 120.000/ano).
    //   w = 3 %: 12.000.000 / 0,03 = 400.000.000 c (R$ 4.000.000)
    //   w = 4 %: 12.000.000 / 0,04 = 300.000.000 c (R$ 3.000.000)
    //   w = 5 %: 12.000.000 / 0,05 = 240.000.000 c (R$ 2.400.000)
    expect(targetPortfolio(c(1_000_000), bp(300))).toBe(400_000_000);
    expect(targetPortfolio(c(1_000_000), bp(400))).toBe(300_000_000);
    expect(targetPortfolio(c(1_000_000), bp(500))).toBe(240_000_000);
  });

  it('divisao que nao fecha arredonda para o centavo mais proximo', () => {
    // R = 100 c, w = 7 %: 1.200 / 0,07 = 17.142,857... -> 17.143.
    expect(targetPortfolio(c(100), bp(700))).toBe(17_143);
  });

  it('meio centavo exato se afasta do zero', () => {
    // R = 1 c, w = 384 bp: 12 / 0,0384 = 312,5 -> 313 (e nao 312).
    expect(targetPortfolio(c(1), bp(384))).toBe(313);
  });

  it('empate que o float errava: decidido em inteiro (laudo A2)', () => {
    // R = 187 c, w = 1.408 bp: 187 * 12 * 10.000 / 1.408 = 22.440.000 / 1.408 = 15.937,5
    //   (1.408 * 15.937 = 22.439.296; resto 704 = 1.408 / 2: meio exato) -> 15.938.
    // Com `0,1408` em float o quociente caia em 15.937,4999... e saia 15.937.
    expect(targetPortfolio(c(187), bp(1408))).toBe(15_938);
  });

  it('renda desejada negativa lanca; o lado valido da fronteira nao muda', () => {
    expect(() => targetPortfolio(c(-1), bp(400))).toThrow(
      'Renda desejada nao pode ser negativo; recebido: -1 centavos.',
    );
    // Renda negativa lanca antes de olhar w: nao vira null.
    expect(() => targetPortfolio(c(-1), bp(0))).toThrow(RangeError);
    // Renda 0 da alvo 0; renda valida com w <= 0 continua null.
    expect(targetPortfolio(c(0), bp(400))).toBe(0);
    expect(targetPortfolio(c(1), bp(0))).toBeNull();
  });

  it('renda desejada zero da alvo zero', () => {
    expect(targetPortfolio(c(0), bp(400))).toBe(0);
  });

  it('withdrawalBp <= 0 devolve null (alvo infinito), nunca Infinity', () => {
    expect(targetPortfolio(c(1_000_000), bp(0))).toBeNull();
    expect(targetPortfolio(c(1_000_000), bp(-100))).toBeNull();
  });
});

describe('futureValue — P0*(1+i)^n + A*((1+i)^n - 1)/i', () => {
  it('taxa zero: P0 + A*n', () => {
    // 100.000 + 2.000 * 12 = 124.000.
    expect(futureValue(c(100_000), c(2_000), bp(0), 12)).toBe(124_000);
  });

  it('taxa zero e aporte zero: o patrimonio fica parado', () => {
    expect(futureValue(c(100_000), c(0), bp(0), 240)).toBe(100_000);
  });

  it('prazo zero devolve P0 (nenhum aporte ainda entrou)', () => {
    expect(futureValue(c(5_000_000), c(200_000), bp(500), 0)).toBe(5_000_000);
  });

  it('i = 1: confere com a iteracao mes a mes, aporte no fim do mes', () => {
    // Formula: g = 2^3 = 8. 100*8 + 10*(8 - 1)/1 = 800 + 70 = 870.
    // Iteracao: m1 = 100*2 + 10 = 210; m2 = 210*2 + 10 = 430; m3 = 430*2 + 10 = 870.
    expect(futureValue(c(100), c(10), DOUBLING_MONTHLY, 1)).toBe(210);
    expect(futureValue(c(100), c(10), DOUBLING_MONTHLY, 2)).toBe(430);
    expect(futureValue(c(100), c(10), DOUBLING_MONTHLY, 3)).toBe(870);
  });

  it('aporte zero, 12 meses a 12 %: capitalizacao anual exata', () => {
    // g = 1,12^(12/12) = 1,12. 1.000.000 * 1,12 = 1.120.000.
    expect(futureValue(c(1_000_000), c(0), bp(1200), 12)).toBe(1_120_000);
  });

  it('12 meses a 12 % com aporte: fator de anuidade 12,6465', () => {
    // (g - 1)/i = 0,12 / 0,009488792934583 = 12,646497908353.
    // 1.000.000 * 1,12 + 100.000 * 12,646497908353 = 1.120.000 + 1.264.649,79 = 2.384.649,79
    //   -> 2.384.650.
    // (Com r/12 = 1 % seria 1.000.000*1,01^12 + 100.000*12,6825 = 2.395.075: R$ 104 a mais.)
    expect(futureValue(c(1_000_000), c(100_000), bp(1200), 12)).toBe(2_384_650);
  });

  it('caso realista: R$ 50.000 + R$ 2.000/mes a 5 % real por 20 anos', () => {
    // g = 1,05^20 = 2,653297705144420
    // (g - 1)/i = 1,653297705144420 / 0,004074123783648 = 405,804485317803
    // FV = 5.000.000 * 2,653297705144420 + 200.000 * 405,804485317803
    //    = 13.266.488,525722 + 81.160.897,063561 = 94.427.385,589283 -> 94.427.386.
    expect(futureValue(c(5_000_000), c(200_000), bp(500), 240)).toBe(94_427_386);
  });

  it('retorno real negativo corroi o patrimonio', () => {
    // -2 % a.a., 12 meses: g = 0,98. 1.000.000 * 0,98 = 980.000.
    expect(futureValue(c(1_000_000), c(0), bp(-200), 12)).toBe(980_000);
  });

  it('meio centavo exato se afasta do zero', () => {
    // r = 50 %, 12 meses: g = 1,5^1 = 1,5.
    //   P0 = 1 -> 1,5 -> 2;  P0 = 3 -> 4,5 -> 5 (bancario daria 4).
    expect(futureValue(c(1), c(0), bp(5000), 12)).toBe(2);
    expect(futureValue(c(3), c(0), bp(5000), 12)).toBe(5);
  });

  it('prazo fracionario ou negativo lanca', () => {
    expect(() => futureValue(c(1), c(1), bp(500), 1.5)).toThrow(RangeError);
    expect(() => futureValue(c(1), c(1), bp(500), -1)).toThrow(RangeError);
  });

  it('prazo ate 1.200 meses (100 anos) passa; acima lanca com mensagem clara (laudo A3)', () => {
    // Taxa zero para a conta fechar: 0 + 1 * 1.200 = 1.200.
    expect(futureValue(c(0), c(1), bp(0), 1_200)).toBe(1_200);
    expect(() => futureValue(c(0), c(1), bp(0), 1_201)).toThrow(
      'Prazo em meses de 1201 meses passa do limite de 1200 meses (100 anos).',
    );
    // O caso do laudo: 1,07^(1.000.000/12) estourava para Infinity e lancava com "NaN".
    expect(() => futureValue(c(100), c(0), bp(700), 1_000_000)).toThrow(/limite de 1200 meses/);
  });

  it('patrimonio ou aporte negativo lanca (laudo A1 e A5)', () => {
    expect(() => futureValue(c(-100), c(0), bp(500), 12)).toThrow(RangeError);
    expect(() => futureValue(c(5_000_000), c(-100_000), bp(500), 12)).toThrow(
      'Aporte mensal nao pode ser negativo; recebido: -100000 centavos.',
    );
  });
});

describe('monthsToTarget — menor mes inteiro com FV >= alvo', () => {
  it('meta ja atingida: 0 meses', () => {
    expect(monthsToTarget(c(100_000), c(100_000), c(0), bp(500))).toBe(0);
    expect(monthsToTarget(c(100_000), c(150_000), c(0), bp(0))).toBe(0);
  });

  it('taxa zero, divisao exata: (T - P0)/A', () => {
    // (99.000 - 0) / 3.000 = 33 meses exatos. FV(33) = 99.000.
    expect(monthsToTarget(c(99_000), c(0), c(3_000), bp(0))).toBe(33);
  });

  it('taxa zero, divisao que nao fecha arredonda para CIMA', () => {
    // 100.000 / 3.000 = 33,33. FV(33) = 99.000 < 100.000; FV(34) = 102.000 -> 34.
    expect(monthsToTarget(c(100_000), c(0), c(3_000), bp(0))).toBe(34);
  });

  it('i = 1: formula fecha em 3 meses exatos', () => {
    // ln((870*1 + 10)/(100*1 + 10)) / ln 2 = ln(880/110) / ln 2 = ln 8 / ln 2 = 3.
    // FV(3) = 870 (ver futureValue). Alvo 870 -> 3; 871 -> 4 (FV(4) = 1.750).
    expect(monthsToTarget(c(870), c(100), c(10), DOUBLING_MONTHLY)).toBe(3);
    expect(monthsToTarget(c(871), c(100), c(10), DOUBLING_MONTHLY)).toBe(4);
    expect(monthsToTarget(c(869), c(100), c(10), DOUBLING_MONTHLY)).toBe(3);
  });

  it('aporte zero: tempo para dobrar a 12 % a.a.', () => {
    // n = ln(2) / ln(1 + i) = ln 2 / (ln 1,12 / 12) = 0,693147180560 / 0,009444057109
    //   = 73,395 -> 74 meses. Conferido: 1,12^(73/12) = 1,9926 < 2; 1,12^(74/12) = 2,0115.
    expect(monthsToTarget(c(2_000_000), c(1_000_000), c(0), bp(1200))).toBe(74);
  });

  it('caso realista: R$ 3 mi com R$ 50 mil + R$ 2 mil/mes a 5 %', () => {
    // T*i + A = 300.000.000 * 0,004074123784 + 200.000 = 1.222.237,135 + 200.000 = 1.422.237,135
    // P0*i + A = 5.000.000 * 0,004074123784 + 200.000 = 20.370,619 + 200.000 = 220.370,619
    // n = ln(1.422.237,135 / 220.370,619) / ln(1,05)/12 = ln(6,453839) / 0,004065847014
    //   = 1,864675 / 0,004065847014 = 458,62 -> 459 meses (38 anos e 3 meses).
    expect(monthsToTarget(c(300_000_000), c(5_000_000), c(200_000), bp(500))).toBe(459);
  });

  it('taxa zero e aporte zero, abaixo da meta: null', () => {
    expect(monthsToTarget(c(100_000), c(50_000), c(0), bp(0))).toBeNull();
  });

  it('patrimonio zero, aporte zero, taxa positiva: null (P0*i + A = 0)', () => {
    expect(monthsToTarget(c(100_000), c(0), c(0), bp(500))).toBeNull();
  });

  it('aporte negativo lanca: saque nao e aporte (laudo A1)', () => {
    // Antes da revisao isto dava null (A + P0*i < 0). Agora a entrada nem e aceita.
    expect(() => monthsToTarget(c(2_000_000), c(1_000_000), c(-5_000), bp(500))).toThrow(
      RangeError,
    );
  });

  it('resposta astronomica e devolvida como e: sem teto, a tela decide (laudo A4)', () => {
    // Taxa zero, A = 1 c, alvo 1.000.000.000 c: (1e9 - 0) / 1 = 1.000.000.000 meses exatos.
    expect(monthsToTarget(c(1_000_000_000), c(0), c(1), bp(0))).toBe(1_000_000_000);
  });

  it('retorno negativo: assintota -A/i decide', () => {
    // r = -50 %: i = -0,056125687318. Assintota -A/i = 1.000 / 0,056125687318 = 17.817,15 c.
    // Alvo 100.000 acima da assintota: null.
    expect(monthsToTarget(c(100_000), c(0), c(1_000), bp(-5000))).toBeNull();
    // Alvo 10.000 abaixo: n = ln((10.000*i + 1.000)/1.000) / ln(1 + i)
    //   = ln(1 - 0,561256873) / (ln 0,5 / 12) = ln(0,438743127) / -0,057762265
    //   = -0,823841 / -0,057762265 = 14,26 -> 15. (FV(14) = 9.880,51; FV(15) = 10.325,96.)
    expect(monthsToTarget(c(10_000), c(0), c(1_000), bp(-5000))).toBe(15);
  });

  it('o mes devolvido alcanca a meta e o anterior nao', () => {
    const n = monthsToTarget(c(300_000_000), c(5_000_000), c(200_000), bp(500));
    expect(n).not.toBeNull();
    const months = n ?? 0;
    expect(futureValue(c(5_000_000), c(200_000), bp(500), months)).toBeGreaterThanOrEqual(300_000_000);
    expect(futureValue(c(5_000_000), c(200_000), bp(500), months - 1)).toBeLessThan(300_000_000);
  });

  it('alvo ou patrimonio negativo lanca', () => {
    expect(() => monthsToTarget(c(-1), c(0), c(1), bp(500))).toThrow(RangeError);
    expect(() => monthsToTarget(c(1), c(-1), c(1), bp(500))).toThrow(RangeError);
  });
});

describe('requiredContribution — (T - P0*(1+i)^n) * i / ((1+i)^n - 1)', () => {
  it('patrimonio atual ja maior que a meta: 0', () => {
    expect(requiredContribution(c(100_000), c(200_000), bp(500), 60)).toBe(0);
  });

  it('patrimonio atual chega sozinho, rendendo, dentro do prazo: 0', () => {
    // 1.000.000 * 1,12 = 1.120.000 >= 1.100.000 em 12 meses: nao precisa aportar.
    expect(requiredContribution(c(1_100_000), c(1_000_000), bp(1200), 12)).toBe(0);
    // Exatamente na fronteira: 1.120.000 >= 1.120.000.
    expect(requiredContribution(c(1_120_000), c(1_000_000), bp(1200), 12)).toBe(0);
  });

  it('taxa zero, divisao exata: (T - P0)/n', () => {
    // (130.000 - 10.000) / 12 = 10.000.
    expect(requiredContribution(c(130_000), c(10_000), bp(0), 12)).toBe(10_000);
  });

  it('taxa zero, parcela que nao divide exato arredonda para CIMA', () => {
    // 100.000 / 3 = 33.333,33. 33.333 * 3 = 99.999 < 100.000; 33.334 * 3 = 100.002 -> 33.334.
    expect(requiredContribution(c(100_000), c(0), bp(0), 3)).toBe(33_334);
  });

  it('i = 1: aporte exato de 10', () => {
    // (870 - 100*8) * 1 / (8 - 1) = 70 / 7 = 10.
    expect(requiredContribution(c(870), c(100), DOUBLING_MONTHLY, 3)).toBe(10);
    // Um centavo a mais de meta ja exige 11: 100*8 + 10*7 = 870 < 871.
    expect(requiredContribution(c(871), c(100), DOUBLING_MONTHLY, 3)).toBe(11);
  });

  it('12 meses a 12 %', () => {
    // (2.000.000 - 1.000.000*1,12) * i / (1,12 - 1) = 880.000 * 0,009488792934583 / 0,12
    //   = 880.000 / 12,646497908353 = 69.584,48 -> 69.585 (para cima).
    expect(requiredContribution(c(2_000_000), c(1_000_000), bp(1200), 12)).toBe(69_585);
  });

  it('caso realista: R$ 3 mi em 20 anos a 5 %, partindo de R$ 50 mil', () => {
    // P0*g = 5.000.000 * 2,653297705144 = 13.266.488,526
    // (T - P0*g) / ((g - 1)/i) = 286.733.511,474 / 405,804485318 = 706.580,44 -> 706.581.
    expect(requiredContribution(c(300_000_000), c(5_000_000), bp(500), 240)).toBe(706_581);
  });

  it('o aporte devolvido alcanca a meta e um centavo a menos nao', () => {
    const a = requiredContribution(c(300_000_000), c(5_000_000), bp(500), 240);
    expect(futureValue(c(5_000_000), a, bp(500), 240)).toBeGreaterThanOrEqual(300_000_000);
    // Um centavo a menos de aporte, 240 vezes, tira ~405 c do FV: fica abaixo.
    expect(futureValue(c(5_000_000), c(a - 1), bp(500), 240)).toBeLessThan(300_000_000);
  });

  it('retorno negativo continua tendo resposta', () => {
    // -2 % a.a., 12 meses, P0 = 0: (g - 1)/i com g = 0,98 e
    //   i = 0,98^(1/12) - 1 = -0,001682143 -> (-0,02)/(-0,001682143) = 11,889599.
    //   120.000 / 11,889599 = 10.092,86 -> 10.093 (mais que os 10.000 da taxa zero).
    const a = requiredContribution(c(120_000), c(0), bp(-200), 12);
    expect(a).toBe(10_093);
    expect(futureValue(c(0), a, bp(-200), 12)).toBeGreaterThanOrEqual(120_000);
    expect(futureValue(c(0), c(a - 1), bp(-200), 12)).toBeLessThan(120_000);
  });

  it('prazo zero lanca: nao ha aporte que mude o patrimonio de hoje', () => {
    expect(() => requiredContribution(c(100), c(0), bp(500), 0)).toThrow(RangeError);
  });

  it('prazo de 1.200 meses passa; 1.201 lanca (laudo A3)', () => {
    // Taxa zero: 1.200.000 / 1.200 = 1.000.
    expect(requiredContribution(c(1_200_000), c(0), bp(0), 1_200)).toBe(1_000);
    expect(() => requiredContribution(c(1_200_000), c(0), bp(0), 1_201)).toThrow(
      /limite de 1200 meses \(100 anos\)/,
    );
  });

  it('patrimonio negativo lanca (laudo A5)', () => {
    expect(() => requiredContribution(c(100), c(-1), bp(500), 12)).toThrow(RangeError);
  });
});

describe('projectedMonthlyIncome — FV * w / 12', () => {
  it('o alvo do cenario medio paga exatamente a renda desejada', () => {
    // 300.000.000 * 0,04 / 12 = 12.000.000 / 12 = 1.000.000.
    expect(projectedMonthlyIncome(c(300_000_000), bp(400))).toBe(1_000_000);
  });

  it('meio centavo exato se afasta do zero', () => {
    // 60.000 * 0,0001 / 12 = 6 / 12 = 0,5 -> 1.
    expect(projectedMonthlyIncome(c(60_000), bp(1))).toBe(1);
  });

  it('empate que o float errava: decidido em inteiro (laudo A2)', () => {
    // 50.000 * 6 / 120.000 = 300.000 / 120.000 = 2,5 -> 3. O float dava 2.
    expect(projectedMonthlyIncome(c(50_000), bp(6))).toBe(3);
  });

  it('patrimonio negativo lanca (laudo A5)', () => {
    expect(() => projectedMonthlyIncome(c(-1), bp(400))).toThrow(RangeError);
  });

  it('retirada negativa lanca; retirada 0 continua valida e da renda 0', () => {
    expect(() => projectedMonthlyIncome(c(1_000_000), bp(-1))).toThrow(
      'Taxa de retirada nao pode ser negativa; recebido: -1 bp.',
    );
    expect(projectedMonthlyIncome(c(1_000_000), bp(0))).toBe(0);
    // 1 bp, o menor positivo: 1.200.000 * 1 / 120.000 = 10.
    expect(projectedMonthlyIncome(c(1_200_000), bp(1))).toBe(10);
  });

  it('nao fecha: centavo mais proximo', () => {
    // 94.427.386 * 0,04 / 12 = 3.777.095,44 / 12 = 314.757,95 -> 314.758.
    expect(projectedMonthlyIncome(c(94_427_386), bp(400))).toBe(314_758);
  });

  it('retirada zero ou patrimonio zero: renda zero', () => {
    expect(projectedMonthlyIncome(c(300_000_000), bp(0))).toBe(0);
    expect(projectedMonthlyIncome(c(0), bp(400))).toBe(0);
  });
});

describe('accumulationCurve', () => {
  it('ponto 0 e a ancora com P0; cada ponto e o FV fechado; competencia cruza o ano', () => {
    // i = 1, P0 = 100, A = 10: 100, 210, 430, 870 (ver futureValue).
    // Renda com w = 12 % a.a. = 1 % a.m.: 1; 2,1 -> 2; 4,3 -> 4; 8,7 -> 9.
    const curve = accumulationCurve({
      p0: c(100),
      monthlyContribution: c(10),
      annualBp: DOUBLING_MONTHLY,
      months: 3,
      withdrawalBp: bp(1200),
      fromCompetence: '2026-11',
    });
    expect(curve).toEqual([
      { month: 0, competenceOffset: 0, competence: '2026-11', portfolioCents: 100, passiveIncomeCents: 1 },
      { month: 1, competenceOffset: 1, competence: '2026-12', portfolioCents: 210, passiveIncomeCents: 2 },
      { month: 2, competenceOffset: 2, competence: '2027-01', portfolioCents: 430, passiveIncomeCents: 4 },
      { month: 3, competenceOffset: 3, competence: '2027-02', portfolioCents: 870, passiveIncomeCents: 9 },
    ]);
  });

  it('months = 0 devolve so a ancora', () => {
    const curve = accumulationCurve({
      p0: c(5_000_000),
      monthlyContribution: c(200_000),
      annualBp: bp(500),
      months: 0,
      withdrawalBp: bp(400),
      fromCompetence: '2026-10',
    });
    expect(curve).toEqual([
      { month: 0, competenceOffset: 0, competence: '2026-10', portfolioCents: 5_000_000, passiveIncomeCents: 16_667 },
    ]);
    // 5.000.000 * 0,04 / 12 = 16.666,67 -> 16.667.
  });

  it('240 meses: o ultimo ponto e o FV fechado de 20 anos, sem erro acumulado', () => {
    // Ver o caso realista de futureValue: 94.427.386, renda 314.758.
    const curve = accumulationCurve({
      p0: c(5_000_000),
      monthlyContribution: c(200_000),
      annualBp: bp(500),
      months: 240,
      withdrawalBp: bp(400),
      fromCompetence: '2026-10',
    });
    expect(curve).toHaveLength(241);
    const last = curve[240];
    expect(last?.competence).toBe('2046-10');
    expect(last?.portfolioCents).toBe(94_427_386);
    expect(last?.passiveIncomeCents).toBe(314_758);
  });

  it('taxa zero e aporte zero: linha reta em P0', () => {
    const curve = accumulationCurve({
      p0: c(1_000),
      monthlyContribution: c(0),
      annualBp: bp(0),
      months: 2,
      withdrawalBp: bp(400),
      fromCompetence: '2026-01',
    });
    expect(curve.map((point) => point.portfolioCents)).toEqual([1_000, 1_000, 1_000]);
  });

  it('months negativo ou acima de 1.200 lanca antes do laco; 1.200 passa', () => {
    const base = {
      p0: c(0),
      monthlyContribution: c(0),
      annualBp: bp(0),
      withdrawalBp: bp(400),
      fromCompetence: '2026-01',
    };
    expect(() => accumulationCurve({ ...base, months: -1 })).toThrow(RangeError);
    expect(() => accumulationCurve({ ...base, months: 1_201 })).toThrow(/limite de 1200 meses/);
    // 1.200 meses = 1.201 pontos; o ultimo e 2026-01 + 1.200 meses = 2126-01.
    const curve = accumulationCurve({ ...base, months: 1_200 });
    expect(curve).toHaveLength(1_201);
    expect(curve[1_200]?.competence).toBe('2126-01');
  });

  it('patrimonio ou aporte negativo lanca (laudo A1 e A5)', () => {
    const base = {
      annualBp: bp(500),
      months: 12,
      withdrawalBp: bp(400),
      fromCompetence: '2026-01',
    };
    expect(() =>
      accumulationCurve({ ...base, p0: c(-1), monthlyContribution: c(0) }),
    ).toThrow(RangeError);
    expect(() =>
      accumulationCurve({ ...base, p0: c(5_000_000), monthlyContribution: c(-100_000) }),
    ).toThrow(RangeError);
  });
});

describe('scenarioTable', () => {
  const ZERO_RETURN: ScenarioParams[] = [
    { label: 'conservative', realReturnBp: bp(0), withdrawalBp: bp(600) },
    { label: 'moderate', realReturnBp: bp(0), withdrawalBp: bp(1200) },
  ];

  it('conta inteira a mao com retorno zero', () => {
    // R = 10.000 c.
    // conservative, w = 6 %: alvo = 120.000 / 0,06 = 2.000.000.
    //   meses com A = 10.000: (2.000.000 - 400.000)/10.000 = 160.
    //   5 anos: 1.600.000 / 60 = 26.666,67 -> 26.667. 10 anos: 1.600.000/120 = 13.333,33 -> 13.334.
    //   renda no maior horizonte (120 m): FV = 400.000 + 10.000*120 = 1.600.000;
    //     1.600.000 * 0,06 / 12 = 8.000. feasible: 160 > 120 -> false.
    // moderate, w = 12 %: alvo = 120.000 / 0,12 = 1.000.000.
    //   meses: 600.000/10.000 = 60. 5 anos: 600.000/60 = 10.000. 10 anos: 5.000.
    //   renda: 1.600.000 * 0,12 / 12 = 16.000. feasible: 60 <= 120 -> true.
    const table = scenarioTable({
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(400_000),
      currentMonthlyContribution: c(10_000),
      scenarios: ZERO_RETURN,
      horizonsYears: [5, 10],
      fromCompetence: '2026-10',
    });
    expect(table).toEqual([
      {
        label: 'conservative',
        targetPortfolioCents: 2_000_000,
        monthsWithCurrentContribution: 160,
        requiredByHorizon: [
          { years: 5, contributionCents: 26_667 },
          { years: 10, contributionCents: 13_334 },
        ],
        projectedIncomeWithCurrentPlanCents: 8_000,
        feasible: false,
      },
      {
        label: 'moderate',
        targetPortfolioCents: 1_000_000,
        monthsWithCurrentContribution: 60,
        requiredByHorizon: [
          { years: 5, contributionCents: 10_000 },
          { years: 10, contributionCents: 5_000 },
        ],
        projectedIncomeWithCurrentPlanCents: 16_000,
        feasible: true,
      },
    ]);
  });

  it('caso do gate (R$ 10 mil, R$ 50 mil, R$ 2 mil, defaults de DATA-MODEL)', () => {
    // Conferido no oraculo Python `decimal` (ver .notas/t301-tabela-cenarios.md).
    // conservative 300/300: alvo 4.000.000,00; n = 698,52 -> 699.
    //   5a: 6.104.022,27 -> 6.104.023; 10a: 2.820.265,81 -> 2.820.266;
    //   15a: 1.733.606,73 -> 1.733.607; 20a: 1.196.157,65 -> 1.196.158.
    //   FV(240) = 5e6*1,03^20 + 2e5*(1,03^20 - 1)/i = 74.401.444,93 -> 74.401.445;
    //   renda = 74.401.445 * 0,03/12 = 186.003,61 -> 186.004.
    // moderate 500/400: alvo 3.000.000,00; n = 458,62 -> 459;
    //   706.580,44 -> 706.581 em 20a (ver requiredContribution); renda 314.758.
    // optimistic 700/500: alvo 2.400.000,00; n = 340,53 -> 341;
    //   20a: 434.750,27 -> 434.751; FV(240) = 120.855.697,63 -> 120.855.698;
    //   renda = 120.855.698 * 0,05/12 = 503.565,41 -> 503.565.
    const table = scenarioTable({
      desiredMonthlyIncome: c(1_000_000),
      currentPortfolio: c(5_000_000),
      currentMonthlyContribution: c(200_000),
      scenarios: [
        { label: 'conservative', realReturnBp: bp(300), withdrawalBp: bp(300) },
        { label: 'moderate', realReturnBp: bp(500), withdrawalBp: bp(400) },
        { label: 'optimistic', realReturnBp: bp(700), withdrawalBp: bp(500) },
      ],
      horizonsYears: [...DEFAULT_HORIZONS_YEARS],
      fromCompetence: '2026-10',
    });
    expect(table.map((row) => [row.label, row.targetPortfolioCents, row.monthsWithCurrentContribution])).toEqual([
      ['conservative', 400_000_000, 699],
      ['moderate', 300_000_000, 459],
      ['optimistic', 240_000_000, 341],
    ]);
    expect(table.map((row) => row.requiredByHorizon.map((h) => h.contributionCents))).toEqual([
      [6_104_023, 2_820_266, 1_733_607, 1_196_158],
      [4_329_781, 1_890_708, 1_093_575, 706_581],
      [3_272_484, 1_345_583, 727_102, 434_751],
    ]);
    expect(table.map((row) => row.projectedIncomeWithCurrentPlanCents)).toEqual([186_004, 314_758, 503_565]);
    expect(table.map((row) => row.feasible)).toEqual([false, false, false]);
  });

  it('meta ja atingida: 0 meses, aporte 0 em todo horizonte, viavel', () => {
    // alvo moderate = 1.000.000 (acima); P0 = 1.000.000 ja basta.
    const [row] = scenarioTable({
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(1_000_000),
      currentMonthlyContribution: c(0),
      scenarios: [ZERO_RETURN[1] as ScenarioParams],
      horizonsYears: [5],
      fromCompetence: '2026-10',
    });
    expect(row?.monthsWithCurrentContribution).toBe(0);
    expect(row?.requiredByHorizon).toEqual([{ years: 5, contributionCents: 0 }]);
    expect(row?.feasible).toBe(true);
  });

  it('meta inalcancavel com o aporte atual: null e inviavel, nunca NaN', () => {
    const [row] = scenarioTable({
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(0),
      currentMonthlyContribution: c(0),
      scenarios: [{ label: 'moderate', realReturnBp: bp(500), withdrawalBp: bp(400) }],
      horizonsYears: [5],
      fromCompetence: '2026-10',
    });
    expect(row?.monthsWithCurrentContribution).toBeNull();
    expect(row?.feasible).toBe(false);
    expect(row?.projectedIncomeWithCurrentPlanCents).toBe(0);
  });

  it('sem horizontes: renda de hoje e viavel so se ja atingiu', () => {
    // P0 = 400.000, w = 12 %: renda de hoje = 400.000 * 0,12 / 12 = 4.000.
    const [row] = scenarioTable({
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(400_000),
      currentMonthlyContribution: c(10_000),
      scenarios: [ZERO_RETURN[1] as ScenarioParams],
      horizonsYears: [],
      fromCompetence: '2026-10',
    });
    expect(row?.requiredByHorizon).toEqual([]);
    expect(row?.projectedIncomeWithCurrentPlanCents).toBe(4_000);
    expect(row?.feasible).toBe(false);
  });

  it('aporte atual negativo lanca: os dois cenarios do laudo A1 nao chegam a tela', () => {
    const base = {
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(5_000_000),
      scenarios: [{ label: 'moderate', realReturnBp: bp(500), withdrawalBp: bp(400) }] satisfies ScenarioParams[],
      fromCompetence: '2026-10',
    };
    // Cenario 1 do laudo: dava "viavel" com renda projetada de -R$ 13,33.
    expect(() =>
      scenarioTable({ ...base, currentMonthlyContribution: c(-100_000), horizonsYears: [5] }),
    ).toThrow('Aporte atual nao pode ser negativo; recebido: -100000 centavos.');
    // Cenario 2: alvo R$ 3 mi, renda projetada de -R$ 910,47 em 20 anos.
    expect(() =>
      scenarioTable({
        ...base,
        desiredMonthlyIncome: c(1_000_000),
        currentMonthlyContribution: c(-100_000),
        horizonsYears: [20],
      }),
    ).toThrow(RangeError);
  });

  it('patrimonio ou renda negativos lancam, mesmo sem cenarios (laudo A5)', () => {
    const base = {
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(0),
      currentMonthlyContribution: c(0),
      scenarios: [],
      horizonsYears: [5],
      fromCompetence: '2026-10',
    };
    expect(() => scenarioTable({ ...base, currentPortfolio: c(-1) })).toThrow(RangeError);
    expect(() => scenarioTable({ ...base, desiredMonthlyIncome: c(-1) })).toThrow(RangeError);
    expect(() => scenarioTable({ ...base, currentMonthlyContribution: c(-1) })).toThrow(RangeError);
  });

  it('cenario com retirada <= 0 lanca: a linha nao tem como dizer "alvo infinito"', () => {
    expect(() =>
      scenarioTable({
        desiredMonthlyIncome: c(10_000),
        currentPortfolio: c(0),
        currentMonthlyContribution: c(0),
        scenarios: [{ label: 'moderate', realReturnBp: bp(500), withdrawalBp: bp(0) }],
        horizonsYears: [5],
        fromCompetence: '2026-10',
      }),
    ).toThrow(RangeError);
  });

  it('horizonte invalido ou ancora invalida lanca', () => {
    const base = {
      desiredMonthlyIncome: c(10_000),
      currentPortfolio: c(0),
      currentMonthlyContribution: c(0),
      scenarios: ZERO_RETURN,
      fromCompetence: '2026-10',
    };
    expect(() => scenarioTable({ ...base, horizonsYears: [0] })).toThrow(RangeError);
    expect(() => scenarioTable({ ...base, horizonsYears: [2.5] })).toThrow(RangeError);
    expect(() => scenarioTable({ ...base, horizonsYears: [101] })).toThrow(
      'Horizonte deve ser um numero inteiro de anos entre 1 e 100; recebido: 101.',
    );
    // 100 anos e o teto e passa: conservative w = 6 %, r = 0, P0 = 0:
    //   alvo 2.000.000 / 1.200 meses = 1.666,67 -> 1.667.
    expect(scenarioTable({ ...base, horizonsYears: [100] })[0]?.requiredByHorizon).toEqual([
      { years: 100, contributionCents: 1_667 },
    ]);
    expect(() => scenarioTable({ ...base, horizonsYears: [5], fromCompetence: '2026-13' })).toThrow();
  });

  it('DEFAULT_HORIZONS_YEARS e 5/10/15/20 (SPEC §5.6)', () => {
    expect(DEFAULT_HORIZONS_YEARS).toEqual([5, 10, 15, 20]);
  });
});

describe('contributionFeasibility — RF-INV-05', () => {
  it('sobra menor que o exigido: lacuna, inviavel, uso acima de 100 %', () => {
    // 300.000 - 200.000 = 100.000 faltando. 300.000 / 200.000 = 1,5 = 15.000 bp.
    expect(
      contributionFeasibility({ requiredContributionCents: c(300_000), averageMonthlySurplusCents: c(200_000) }),
    ).toEqual({ gapCents: 100_000, feasible: false, surplusUsageBp: 15_000 });
  });

  it('sobra maior: sem lacuna, viavel', () => {
    // 300.000 / 400.000 = 0,75 = 7.500 bp.
    expect(
      contributionFeasibility({ requiredContributionCents: c(300_000), averageMonthlySurplusCents: c(400_000) }),
    ).toEqual({ gapCents: 0, feasible: true, surplusUsageBp: 7_500 });
  });

  it('sobra exatamente igual: viavel, 100 %', () => {
    expect(
      contributionFeasibility({ requiredContributionCents: c(300_000), averageMonthlySurplusCents: c(300_000) }),
    ).toEqual({ gapCents: 0, feasible: true, surplusUsageBp: 10_000 });
  });

  it('sobra zero ou negativa: uso null, lacuna e o exigido inteiro', () => {
    expect(
      contributionFeasibility({ requiredContributionCents: c(300_000), averageMonthlySurplusCents: c(0) }),
    ).toEqual({ gapCents: 300_000, feasible: false, surplusUsageBp: null });
    // Deficit de 50.000 nao aumenta a lacuna da META: o que falta para o aporte e 300.000.
    expect(
      contributionFeasibility({ requiredContributionCents: c(300_000), averageMonthlySurplusCents: c(-50_000) }),
    ).toEqual({ gapCents: 300_000, feasible: false, surplusUsageBp: null });
  });

  it('meta ja atingida (exigido 0) e viavel mesmo com deficit', () => {
    expect(
      contributionFeasibility({ requiredContributionCents: c(0), averageMonthlySurplusCents: c(-100) }),
    ).toEqual({ gapCents: 0, feasible: true, surplusUsageBp: null });
    expect(
      contributionFeasibility({ requiredContributionCents: c(0), averageMonthlySurplusCents: c(100) }),
    ).toEqual({ gapCents: 0, feasible: true, surplusUsageBp: 0 });
  });

  it('uso que nao fecha arredonda para o bp mais proximo', () => {
    // 1 / 3 = 0,33333 = 3.333,33 bp -> 3.333. 2 / 3 = 6.666,67 -> 6.667.
    expect(
      contributionFeasibility({ requiredContributionCents: c(1), averageMonthlySurplusCents: c(3) }).surplusUsageBp,
    ).toBe(3_333);
    expect(
      contributionFeasibility({ requiredContributionCents: c(2), averageMonthlySurplusCents: c(3) }).surplusUsageBp,
    ).toBe(6_667);
  });

  it('empate de meio bp se afasta do zero, decidido em inteiro (laudo A2)', () => {
    // 1 * 10.000 / 20.000 = 0,5 bp -> 1. 3 * 10.000 / 20.000 = 1,5 -> 2.
    expect(
      contributionFeasibility({ requiredContributionCents: c(1), averageMonthlySurplusCents: c(20_000) })
        .surplusUsageBp,
    ).toBe(1);
    expect(
      contributionFeasibility({ requiredContributionCents: c(3), averageMonthlySurplusCents: c(20_000) })
        .surplusUsageBp,
    ).toBe(2);
  });

  it('exigido negativo lanca', () => {
    expect(() =>
      contributionFeasibility({ requiredContributionCents: c(-1), averageMonthlySurplusCents: c(3) }),
    ).toThrow(RangeError);
  });
});
