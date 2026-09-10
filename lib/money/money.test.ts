import { describe, expect, it } from 'vitest';

import {
  addCents,
  allocate,
  applyRate,
  basisPoints,
  bpToDecimal,
  cents,
  formatBRL,
  parseBRL,
} from '@/lib/money';

describe('cents', () => {
  it('aceita inteiro', () => {
    expect(cents(1000)).toBe(1000);
    expect(cents(-1000)).toBe(-1000);
    expect(cents(0)).toBe(0);
  });

  it('aceita o limite do safe integer (R$ 90.071.992.547.409,91)', () => {
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(9007199254740991);
  });

  it('recusa decimal — dinheiro com decimal e o bug que este tipo existe para impedir', () => {
    expect(() => cents(10.5)).toThrow(RangeError);
    expect(() => cents(0.1 + 0.2)).toThrow(RangeError);
  });

  it('recusa fora do safe integer, NaN e Infinity', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => cents(Number.NaN)).toThrow(RangeError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('normaliza -0 para 0, que senao vaza como "-R$ 0,00" na exibicao', () => {
    expect(Object.is(cents(-0), 0)).toBe(true);
  });
});

describe('formatBRL', () => {
  it('formata zero', () => {
    expect(formatBRL(cents(0))).toBe('R$ 0,00');
  });

  it('formata centavos sem parte inteira', () => {
    // 5 centavos = 0 reais e 05 centavos.
    expect(formatBRL(cents(5))).toBe('R$ 0,05');
  });

  it('formata negativo com o sinal na frente do simbolo', () => {
    // -1000 centavos / 100 = -10 reais.
    expect(formatBRL(cents(-1000))).toBe('-R$ 10,00');
  });

  it('agrupa milhar com ponto e separa centavo com virgula', () => {
    // 123456 centavos = 1234 reais e 56 centavos.
    expect(formatBRL(cents(123456))).toBe('R$ 1.234,56');
    // 100000000 centavos / 100 = 1.000.000 reais.
    expect(formatBRL(cents(100000000))).toBe('R$ 1.000.000,00');
  });

  it('formata o limite do safe integer sem perder digito', () => {
    // 9007199254740991 centavos: os dois ultimos digitos (91) sao os centavos,
    // sobram 90071992547409 reais -> 90.071.992.547.409,91.
    expect(formatBRL(cents(Number.MAX_SAFE_INTEGER))).toBe(
      'R$ 90.071.992.547.409,91',
    );
  });

  it("sign 'never' remove o sinal do negativo", () => {
    expect(formatBRL(cents(-1000), { sign: 'never' })).toBe('R$ 10,00');
    expect(formatBRL(cents(1000), { sign: 'never' })).toBe('R$ 10,00');
  });

  it("sign 'always' prefixa + no positivo e mantem - no negativo", () => {
    expect(formatBRL(cents(1000), { sign: 'always' })).toBe('+R$ 10,00');
    expect(formatBRL(cents(-1000), { sign: 'always' })).toBe('-R$ 10,00');
  });

  it('zero nunca recebe sinal, em nenhum modo', () => {
    expect(formatBRL(cents(0), { sign: 'always' })).toBe('R$ 0,00');
    expect(formatBRL(cents(0), { sign: 'never' })).toBe('R$ 0,00');
  });
});

describe('parseBRL', () => {
  it('le o formato pt-BR com milhar e centavos', () => {
    // 1.234,56 = 1234 reais x 100 + 56 = 123456 centavos.
    expect(parseBRL('1.234,56')).toBe(123456);
  });

  it('le decimal com ponto (formato de arquivo/en)', () => {
    // 1234.56 = 1234 reais x 100 + 56 = 123456 centavos.
    expect(parseBRL('1234.56')).toBe(123456);
  });

  it('le negativo com simbolo e espaco', () => {
    // 10,00 = 1000 centavos, com sinal negativo.
    expect(parseBRL('-R$ 10,00')).toBe(-1000);
  });

  it('le zero com simbolo', () => {
    expect(parseBRL('R$ 0,00')).toBe(0);
  });

  it('normaliza -0 para 0', () => {
    expect(Object.is(parseBRL('-R$ 0,00'), 0)).toBe(true);
  });

  it('aceita o sinal antes ou depois do simbolo, e o +', () => {
    expect(parseBRL('R$ -10,00')).toBe(-1000);
    expect(parseBRL('+R$ 10,00')).toBe(1000);
    expect(parseBRL('+10,00')).toBe(1000);
  });

  it('aceita NBSP entre simbolo e numero, como Intl e extrato de banco emitem', () => {
    // Escape explicito: NBSP e indistinguivel de espaco comum no editor.
    expect(parseBRL('R$\u00A01.234,56')).toBe(123456);
    expect(parseBRL('R$\u202F1.234,56')).toBe(123456);
  });

  it('aceita o sinal de menos tipografico U+2212, que PDF de fatura emite', () => {
    // Recusar faria o parser de PDF descartar toda linha negativa em silencio.
    expect(parseBRL('−R$ 10,00')).toBe(-1000);
    expect(parseBRL('−10,00')).toBe(-1000);
  });

  it('recusa convencao de layout de extrato: quem decide a direcao e o parser', () => {
    // "(10,00)" e "10,00-" significam credito ou debito conforme a coluna em
    // que aparecem. Chutar aqui inverteria o sinal do lancamento em silencio.
    expect(parseBRL('(10,00)')).toBeNull();
    expect(parseBRL('10,00-')).toBeNull();
  });

  it('le milhar em cadeia nos dois estilos', () => {
    // 1.234.567,89 = 1234567 reais x 100 + 89 = 123456789 centavos.
    expect(parseBRL('1.234.567,89')).toBe(123456789);
    // 1,234,567.89 (agrupamento en) da o mesmo valor.
    expect(parseBRL('1,234,567.89')).toBe(123456789);
  });

  it('le agrupamento sem centavos nos dois estilos, com o mesmo resultado', () => {
    // 1.234.567 e 1,234,567 sao o mesmo numero: 1234567 reais = 123456700
    // centavos. Antes o estilo en sem parte decimal caia em null.
    expect(parseBRL('1.234.567')).toBe(123456700);
    expect(parseBRL('1,234,567')).toBe(123456700);
  });

  it('le inteiro sem separador e sem simbolo', () => {
    // 10 reais x 100 = 1000 centavos.
    expect(parseBRL('10')).toBe(1000);
    expect(parseBRL('R$ 10')).toBe(1000);
  });

  it('completa a casa decimal faltante', () => {
    // 10,5 = 10 reais e 50 centavos = 1050 centavos.
    expect(parseBRL('10,5')).toBe(1050);
    // ,50 = 0 reais e 50 centavos.
    expect(parseBRL(',50')).toBe(50);
  });

  it('desambigua o ponto unico: 3 digitos depois e milhar, o resto e decimal', () => {
    // 1.234 tem a forma exata de um grupo de milhar -> 1234 reais = 123400.
    expect(parseBRL('1.234')).toBe(123400);
    // 123.456 idem -> 123456 reais = 12345600 centavos.
    expect(parseBRL('123.456')).toBe(12345600);
    // 1234.56 tem 4 digitos antes: nao e grupo, e decimal -> 123456 centavos.
    expect(parseBRL('1234.56')).toBe(123456);
    // 1.2 tem 1 digito depois: decimal -> 1 real e 20 centavos.
    expect(parseBRL('1.2')).toBe(120);
  });

  it('devolve null para string vazia ou so espaco', () => {
    expect(parseBRL('')).toBeNull();
    expect(parseBRL('   ')).toBeNull();
    expect(parseBRL('\u00A0')).toBeNull();
  });

  it('devolve null para lixo', () => {
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('R$')).toBeNull();
    expect(parseBRL('R$ abc')).toBeNull();
    expect(parseBRL('10,00 reais')).toBeNull();
    expect(parseBRL('--10,00')).toBeNull();
    expect(parseBRL('-R$ -10,00')).toBeNull();
    expect(parseBRL('1.2.3')).toBeNull();
    expect(parseBRL(',')).toBeNull();
  });

  it('devolve null para 3 casas decimais em vez de arredondar', () => {
    // 1,234 seriam 123,4 centavos: nao existe meio centavo no sistema.
    expect(parseBRL('1,234')).toBeNull();
    // 0.567 nao tem forma de milhar (zero a esquerda), entao e decimal de 3.
    expect(parseBRL('0.567')).toBeNull();
    expect(parseBRL('1234.567')).toBeNull();
  });

  it('devolve null quando o valor nao cabe no safe integer', () => {
    // 99.999.999.999.999,99 = 9999999999999999 centavos > MAX_SAFE_INTEGER
    // (9007199254740991).
    expect(parseBRL('99999999999999,99')).toBeNull();
  });

  it('fecha o ciclo com formatBRL', () => {
    // 123456 -> 'R$ 1.234,56' -> 123456.
    expect(parseBRL(formatBRL(cents(123456)))).toBe(123456);
    expect(parseBRL(formatBRL(cents(-1)))).toBe(-1);
  });
});

describe('addCents', () => {
  it('sem argumentos devolve zero', () => {
    expect(addCents()).toBe(0);
  });

  it('soma mantendo o sinal de cada parcela', () => {
    // 1050 + (-2000) + 3 = -947.
    expect(addCents(cents(1050), cents(-2000), cents(3))).toBe(-947);
  });

  it('soma entrada e saida ate zerar', () => {
    // 25000 + (-25000) = 0.
    expect(addCents(cents(25000), cents(-25000))).toBe(0);
  });

  it('nao perde centavo quando um total PARCIAL passa do safe integer e volta', () => {
    // 9007199254740991 + 1 + 1 - 2 = 9007199254740991.
    // Somando em number o parcial 2^53 + 1 arredonda para 2^53 e o resultado
    // sai 9007199254740990 — um centavo a menos, e ainda inteiro seguro, entao
    // passaria batido pela validacao final.
    expect(
      addCents(cents(Number.MAX_SAFE_INTEGER), cents(1), cents(1), cents(-2)),
    ).toBe(9007199254740991);
  });

  it('recusa soma que estoura o safe integer', () => {
    expect(() =>
      addCents(cents(Number.MAX_SAFE_INTEGER), cents(1)),
    ).toThrow(RangeError);
  });
});

describe('applyRate', () => {
  it('aplica percentual redondo', () => {
    // R$ 100,00 = 10000 centavos; 5 % -> 10000 x 500 / 10000 = 500.
    expect(applyRate(cents(10000), basisPoints(500))).toBe(500);
  });

  it('arredonda para o centavo mais proximo, para baixo', () => {
    // 12345 x 1550 = 19.134.750; / 10000 = 1913,475 -> 1913.
    expect(applyRate(cents(12345), basisPoints(1550))).toBe(1913);
  });

  it('arredonda para o centavo mais proximo, para cima', () => {
    // 333 x 3333 = 1.109.889; / 10000 = 110,9889 -> 111.
    expect(applyRate(cents(333), basisPoints(3333))).toBe(111);
  });

  it('empate de meio centavo se afasta do zero, nos dois sinais', () => {
    // 1 x 5000 = 5000; / 10000 = 0,5 -> 1.
    expect(applyRate(cents(1), basisPoints(5000))).toBe(1);
    // -1 x 5000 = -5000; / 10000 = -0,5 -> -1.
    expect(applyRate(cents(-1), basisPoints(5000))).toBe(-1);
  });

  it('preserva o sinal do valor', () => {
    // -12345 x 1550 = -19.134.750; / 10000 = -1913,475 -> -1913.
    expect(applyRate(cents(-12345), basisPoints(1550))).toBe(-1913);
  });

  it('taxa zero devolve zero', () => {
    expect(applyRate(cents(999999), basisPoints(0))).toBe(0);
  });

  it('valor zero devolve zero', () => {
    expect(applyRate(cents(0), basisPoints(1234))).toBe(0);
  });

  it('100 % devolve o proprio valor', () => {
    // 87654321 x 10000 / 10000 = 87654321.
    expect(applyRate(cents(87654321), basisPoints(10000))).toBe(87654321);
  });

  it('taxa negativa devolve valor negativo', () => {
    // 10000 x (-250) = -2.500.000; / 10000 = -250.
    expect(applyRate(cents(10000), basisPoints(-250))).toBe(-250);
  });

  it('nao perde precisao em valor grande, onde v x bp estoura o safe integer', () => {
    // 1.000.000.000.000 x 10000 = 1e16, acima de MAX_SAFE_INTEGER (9,007e15):
    // so fecha porque o produto e calculado em bigint. / 10000 = 1e12.
    expect(applyRate(cents(1000000000000), basisPoints(10000))).toBe(
      1000000000000,
    );
  });
});

describe('allocate', () => {
  it('divide exato quando nao ha resto', () => {
    // 10000 / 4 = 2500, resto 0.
    expect(allocate(cents(10000), 4)).toEqual([2500, 2500, 2500, 2500]);
  });

  it('R$ 100,00 em 3x da 33,34 / 33,33 / 33,33 e soma 10000', () => {
    // 10000 / 3 = 3333, resto 1 -> a primeira parcela leva o centavo.
    const parts = allocate(cents(10000), 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    // 3334 + 3333 + 3333 = 10000.
    expect(addCents(...parts)).toBe(10000);
  });

  it('distribui um resto maior que 1 nas primeiras partes', () => {
    // 10 / 4 = 2, resto 2 -> as duas primeiras levam 1 centavo a mais.
    const parts = allocate(cents(10), 4);
    expect(parts).toEqual([3, 3, 2, 2]);
    // 3 + 3 + 2 + 2 = 10.
    expect(addCents(...parts)).toBe(10);
  });

  it('resto pode encher quase todas as partes', () => {
    // 5 / 7 = 0, resto 5 -> cinco partes de 1 centavo e duas de zero.
    const parts = allocate(cents(5), 7);
    expect(parts).toEqual([1, 1, 1, 1, 1, 0, 0]);
    // 1x5 + 0x2 = 5.
    expect(addCents(...parts)).toBe(5);
  });

  it('valor negativo mantem o resto negativo e a soma exata', () => {
    // -10000 % 3 = -1; base = (-10000 - (-1)) / 3 = -3333.
    const parts = allocate(cents(-10000), 3);
    expect(parts).toEqual([-3334, -3333, -3333]);
    // -3334 - 3333 - 3333 = -10000.
    expect(addCents(...parts)).toBe(-10000);
  });

  it('zero em N partes da N zeros', () => {
    expect(allocate(cents(0), 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('uma parte devolve o total', () => {
    expect(allocate(cents(7777), 1)).toEqual([7777]);
  });

  it('soma fecha em divisao que nao e redonda em nenhuma parte', () => {
    // 99999 / 7 = 14285, resto 4 (7 x 14285 = 99995).
    const parts = allocate(cents(99999), 7);
    expect(parts).toEqual([14286, 14286, 14286, 14286, 14285, 14285, 14285]);
    // 4 x 14286 + 3 x 14285 = 57144 + 42855 = 99999.
    expect(addCents(...parts)).toBe(99999);
  });

  it('recusa numero de partes invalido', () => {
    expect(() => allocate(cents(10000), 0)).toThrow(RangeError);
    expect(() => allocate(cents(10000), -1)).toThrow(RangeError);
    expect(() => allocate(cents(10000), 2.5)).toThrow(RangeError);
    expect(() => allocate(cents(10000), Number.NaN)).toThrow(RangeError);
  });
});

describe('bpToDecimal', () => {
  it('converte pela escala de 10.000', () => {
    // 500 / 10000 = 0,05.
    expect(bpToDecimal(basisPoints(500))).toBe(0.05);
    // 10000 / 10000 = 1.
    expect(bpToDecimal(basisPoints(10000))).toBe(1);
    // -250 / 10000 = -0,025.
    expect(bpToDecimal(basisPoints(-250))).toBe(-0.025);
  });

  it('taxa zero e zero', () => {
    expect(bpToDecimal(basisPoints(0))).toBe(0);
  });
});

describe('basisPoints', () => {
  it('recusa fracao de basis point', () => {
    expect(() => basisPoints(12.5)).toThrow(RangeError);
    expect(() => basisPoints(Number.NaN)).toThrow(RangeError);
  });
});
