import { describe, expect, it } from 'vitest';

import {
  expandInstallmentPlan,
  replanInstallments,
} from '@/lib/finance/installments';
import { addCents, cents } from '@/lib/money';

describe('expandInstallmentPlan', () => {
  it('R$ 100,00 em 3x gera 33,34 / 33,33 / 33,33 somando exatamente 100,00', () => {
    // 10000 / 3 = 3333, resto 1 -> a primeira parcela leva o centavo.
    const parcelas = expandInstallmentPlan({
      totalCents: cents(10000),
      installmentsCount: 3,
      firstCompetence: '2026-03',
      description: 'Mercado Livre',
    });

    expect(parcelas.map((p) => p.amountCents)).toEqual([3334, 3333, 3333]);
    // 3334 + 3333 + 3333 = 10000.
    expect(addCents(...parcelas.map((p) => p.amountCents))).toBe(10000);
  });

  it('numera e descreve cada parcela com o sufixo (n/N)', () => {
    const parcelas = expandInstallmentPlan({
      totalCents: cents(10000),
      installmentsCount: 3,
      firstCompetence: '2026-03',
      description: 'Mercado Livre',
    });

    expect(parcelas.map((p) => p.installmentNumber)).toEqual([1, 2, 3]);
    expect(parcelas.map((p) => p.description)).toEqual([
      'Mercado Livre (1/3)',
      'Mercado Livre (2/3)',
      'Mercado Livre (3/3)',
    ]);
  });

  it('10x gera 10 competencias consecutivas cruzando a virada de ano', () => {
    // Comecando em out/2026, 10 parcelas terminam em jul/2027.
    const parcelas = expandInstallmentPlan({
      totalCents: cents(50000),
      installmentsCount: 10,
      firstCompetence: '2026-10',
      description: 'Passagem',
    });

    expect(parcelas).toHaveLength(10);
    expect(parcelas.map((p) => p.competence)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
    ]);
    // 50000 / 10 = 5000 exato, sem resto.
    expect(parcelas.every((p) => p.amountCents === 5000)).toBe(true);
    expect(addCents(...parcelas.map((p) => p.amountCents))).toBe(50000);
  });

  it('parcela unica devolve o total inteiro', () => {
    const parcelas = expandInstallmentPlan({
      totalCents: cents(7777),
      installmentsCount: 1,
      firstCompetence: '2026-03',
      description: 'Livro',
    });
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0]?.amountCents).toBe(7777);
    expect(parcelas[0]?.description).toBe('Livro (1/1)');
  });

  it('valor negativo (saida de dinheiro) mantem o sinal e fecha a soma', () => {
    // -10000 em 3x: resto -1 -> primeira parcela -3334.
    const parcelas = expandInstallmentPlan({
      totalCents: cents(-10000),
      installmentsCount: 3,
      firstCompetence: '2026-03',
      description: 'Compra',
    });
    expect(parcelas.map((p) => p.amountCents)).toEqual([-3334, -3333, -3333]);
    // -3334 - 3333 - 3333 = -10000.
    expect(addCents(...parcelas.map((p) => p.amountCents))).toBe(-10000);
  });

  it('divisao que nao fecha redondo distribui o resto nas primeiras', () => {
    // 100,01 = 10001 centavos em 4x: 10001 / 4 = 2500, resto 1.
    const parcelas = expandInstallmentPlan({
      totalCents: cents(10001),
      installmentsCount: 4,
      firstCompetence: '2026-01',
      description: 'Curso',
    });
    expect(parcelas.map((p) => p.amountCents)).toEqual([2501, 2500, 2500, 2500]);
    // 2501 + 2500 x 3 = 10001.
    expect(addCents(...parcelas.map((p) => p.amountCents))).toBe(10001);
  });

  it('resto grande enche varias parcelas', () => {
    // 10 centavos em 4x: 10 / 4 = 2, resto 2 -> duas parcelas de 3.
    const parcelas = expandInstallmentPlan({
      totalCents: cents(10),
      installmentsCount: 4,
      firstCompetence: '2026-01',
      description: 'Cafe',
    });
    expect(parcelas.map((p) => p.amountCents)).toEqual([3, 3, 2, 2]);
    expect(addCents(...parcelas.map((p) => p.amountCents))).toBe(10);
  });

  it('total zero gera parcelas zeradas', () => {
    const parcelas = expandInstallmentPlan({
      totalCents: cents(0),
      installmentsCount: 3,
      firstCompetence: '2026-01',
      description: 'Cortesia',
    });
    expect(parcelas.map((p) => p.amountCents)).toEqual([0, 0, 0]);
  });

  it('recusa numero de parcelas invalido', () => {
    const base = {
      totalCents: cents(10000),
      firstCompetence: '2026-01',
      description: 'X',
    };
    expect(() => expandInstallmentPlan({ ...base, installmentsCount: 0 })).toThrow(
      RangeError,
    );
    expect(() => expandInstallmentPlan({ ...base, installmentsCount: -3 })).toThrow(
      RangeError,
    );
    expect(() => expandInstallmentPlan({ ...base, installmentsCount: 2.5 })).toThrow(
      RangeError,
    );
  });
});

describe('replanInstallments', () => {
  it('preserva as realizadas e regenera so as futuras', () => {
    // Plano de 10x de R$ 100,00 comecando em jan/2026. Tres parcelas ja
    // realizadas (jan, fev, mar) somando 3000. Sobram 7 parcelas para
    // 10000 - 3000 = 7000 centavos: 7000 / 7 = 1000 exato.
    const futuras = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 10,
        firstCompetence: '2026-01',
        description: 'Geladeira',
      },
      { keepThroughCompetence: '2026-03', settledCents: cents(3000) },
    );

    expect(futuras).toHaveLength(7);
    expect(futuras.map((p) => p.amountCents)).toEqual([
      1000, 1000, 1000, 1000, 1000, 1000, 1000,
    ]);
    // A numeracao continua do plano original: a primeira futura e a de n. 4.
    expect(futuras[0]?.installmentNumber).toBe(4);
    expect(futuras[0]?.competence).toBe('2026-04');
    expect(futuras[0]?.description).toBe('Geladeira (4/10)');
    expect(futuras[6]?.installmentNumber).toBe(10);
    expect(futuras[6]?.competence).toBe('2026-10');
  });

  it('o que sobra somado ao ja realizado fecha com o novo total', () => {
    // Total novo 12345, ja realizado 3000 -> sobram 9345 em 7 parcelas.
    // 9345 / 7 = 1335 exato (7 x 1335 = 9345).
    const futuras = replanInstallments(
      {
        totalCents: cents(12345),
        installmentsCount: 10,
        firstCompetence: '2026-01',
        description: 'Geladeira',
      },
      { keepThroughCompetence: '2026-03', settledCents: cents(3000) },
    );
    const somaFuturas = addCents(...futuras.map((p) => p.amountCents));
    expect(somaFuturas).toBe(9345);
    // 3000 realizado + 9345 futuro = 12345, o total novo.
    expect(addCents(somaFuturas, cents(3000))).toBe(12345);
  });

  it('resto do replan tambem vai para as primeiras parcelas futuras', () => {
    // Total 10000, realizado 3000 -> 7000 em 6 parcelas restantes:
    // 7000 / 6 = 1166, resto 4 -> quatro de 1167 e duas de 1166.
    const futuras = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 10,
        firstCompetence: '2026-01',
        description: 'Geladeira',
      },
      { keepThroughCompetence: '2026-04', settledCents: cents(3000) },
    );
    expect(futuras.map((p) => p.amountCents)).toEqual([
      1167, 1167, 1167, 1167, 1166, 1166,
    ]);
    // 4 x 1167 + 2 x 1166 = 4668 + 2332 = 7000.
    expect(addCents(...futuras.map((p) => p.amountCents))).toBe(7000);
  });

  it('nada realizado ainda devolve o plano inteiro', () => {
    // keepThroughCompetence anterior ao inicio do plano: preserva zero.
    const futuras = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 3,
        firstCompetence: '2026-03',
        description: 'Fone',
      },
      { keepThroughCompetence: '2026-02', settledCents: cents(0) },
    );
    expect(futuras).toHaveLength(3);
    expect(futuras.map((p) => p.amountCents)).toEqual([3334, 3333, 3333]);
    expect(futuras[0]?.installmentNumber).toBe(1);
    expect(futuras[0]?.competence).toBe('2026-03');
  });

  it('competencia muito anterior ao plano tambem preserva zero', () => {
    // Um ano antes do inicio: continua sendo "nada realizado", nao negativo.
    const futuras = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 3,
        firstCompetence: '2026-03',
        description: 'Fone',
      },
      { keepThroughCompetence: '2025-03', settledCents: cents(0) },
    );
    expect(futuras).toHaveLength(3);
    expect(futuras[0]?.installmentNumber).toBe(1);
    expect(futuras[0]?.competence).toBe('2026-03');
  });

  it('plano inteiro ja realizado nao tem o que regenerar', () => {
    // keepThroughCompetence na ultima parcela (jan + 2 = mar) ou depois.
    const noFim = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 3,
        firstCompetence: '2026-01',
        description: 'Fone',
      },
      { keepThroughCompetence: '2026-03', settledCents: cents(10000) },
    );
    expect(noFim).toEqual([]);

    const depois = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 3,
        firstCompetence: '2026-01',
        description: 'Fone',
      },
      { keepThroughCompetence: '2026-09', settledCents: cents(10000) },
    );
    expect(depois).toEqual([]);
  });

  it('LANCA quando nao ha parcela futura para acomodar a diferenca', () => {
    // Plano de 10000 com as 3 parcelas preservadas mas so 5000 realizado:
    // faltam 10000 - 5000 = 5000 centavos e nao existe parcela futura onde
    // coloca-los. Devolver [] faria R$ 50,00 sumirem em silencio.
    expect(() =>
      replanInstallments(
        {
          totalCents: cents(10000),
          installmentsCount: 3,
          firstCompetence: '2026-01',
          description: 'Geladeira',
        },
        { keepThroughCompetence: '2026-03', settledCents: cents(5000) },
      ),
    ).toThrow(RangeError);

    // Caminho 1 ate remainingCount == 0: o plano foi EDITADO para menos
    // parcelas do que as ja preservadas, e o Math.min corta. Plano novo de 2x
    // de R$ 1.000,00 com 3 competencias preservadas e R$ 300,00 realizados:
    // 100000 - 30000 = 70000 centavos sem nenhuma parcela onde caber.
    expect(() =>
      replanInstallments(
        {
          totalCents: cents(100000),
          installmentsCount: 2,
          firstCompetence: '2026-01',
          description: 'Geladeira',
        },
        { keepThroughCompetence: '2026-03', settledCents: cents(30000) },
      ),
    ).toThrow(RangeError);

    // Vale tambem quando o realizado passou do total.
    expect(() =>
      replanInstallments(
        {
          totalCents: cents(5000),
          installmentsCount: 3,
          firstCompetence: '2026-01',
          description: 'Geladeira',
        },
        { keepThroughCompetence: '2026-09', settledCents: cents(10000) },
      ),
    ).toThrow(RangeError);
  });

  it('nao lanca quando tudo foi preservado E o realizado fecha com o total', () => {
    // Mesma situacao, mas 10000 realizado de 10000: nao sobra nada, e a lista
    // vazia e a resposta certa.
    expect(
      replanInstallments(
        {
          totalCents: cents(10000),
          installmentsCount: 3,
          firstCompetence: '2026-01',
          description: 'Geladeira',
        },
        { keepThroughCompetence: '2026-03', settledCents: cents(10000) },
      ),
    ).toEqual([]);
  });

  it('so a ultima parcela em aberto recebe todo o restante', () => {
    // 3 parcelas, duas realizadas somando 6666 -> resta 10000 - 6666 = 3334
    // numa unica parcela.
    const futuras = replanInstallments(
      {
        totalCents: cents(10000),
        installmentsCount: 3,
        firstCompetence: '2026-01',
        description: 'Fone',
      },
      { keepThroughCompetence: '2026-02', settledCents: cents(6666) },
    );
    expect(futuras).toHaveLength(1);
    expect(futuras[0]?.amountCents).toBe(3334);
    expect(futuras[0]?.description).toBe('Fone (3/3)');
  });

  it('regenera cruzando a virada de ano', () => {
    // Plano de 6x comecando em nov/2026, duas preservadas (nov, dez) ->
    // as futuras sao jan a abr/2027.
    const futuras = replanInstallments(
      {
        totalCents: cents(6000),
        installmentsCount: 6,
        firstCompetence: '2026-11',
        description: 'TV',
      },
      { keepThroughCompetence: '2026-12', settledCents: cents(2000) },
    );
    expect(futuras.map((p) => p.competence)).toEqual([
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
    // 6000 - 2000 = 4000 em 4 parcelas = 1000 cada.
    expect(futuras.every((p) => p.amountCents === 1000)).toBe(true);
  });

  it('novo total menor que o ja realizado gera credito nas futuras', () => {
    // Total caiu para 2000 com 3000 ja realizado: sobra -1000 em 2 parcelas.
    // -1000 / 2 = -500 exato. A soma continua fechando com o novo total.
    const futuras = replanInstallments(
      {
        totalCents: cents(2000),
        installmentsCount: 5,
        firstCompetence: '2026-01',
        description: 'Ajuste',
      },
      { keepThroughCompetence: '2026-03', settledCents: cents(3000) },
    );
    expect(futuras.map((p) => p.amountCents)).toEqual([-500, -500]);
    // 3000 realizado + (-1000) futuro = 2000.
    expect(
      addCents(cents(3000), ...futuras.map((p) => p.amountCents)),
    ).toBe(2000);
  });
});
