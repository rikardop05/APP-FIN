import { describe, expect, it } from 'vitest';

import {
  HISTORY_MONTHS,
  recurrenceHistoryStart,
  suggestRecurrences,
  type RecurrenceHistoryRow,
} from '@/lib/finance/recurrence-suggestions';
import { cents } from '@/lib/money';

const ACCOUNT = 'acc-1';
const CARD = 'card-1';
const TODAY = '2026-11-20';

/** Linha de despesa em cartao, sobrescrita em cada caso. */
function row(
  overrides: Partial<Omit<RecurrenceHistoryRow, 'amountCents'>> & { occurredOn: string; amountCents: number },
): RecurrenceHistoryRow {
  const { amountCents, ...rest } = overrides;
  return {
    description: 'NETFLIX.COM',
    kind: 'expense',
    categoryId: null,
    accountId: null,
    creditCardId: CARD,
    memberId: null,
    isInstallment: false,
    ...rest,
    amountCents: cents(amountCents),
  };
}

function suggest(rows: RecurrenceHistoryRow[], today = TODAY, existing: { kind: 'income' | 'expense'; description: string }[] = []) {
  return suggestRecurrences({ today, rows, existing });
}

/** Tres meses de historico da casa (set, out, nov), para os casos que exigem 3 meses. */
const filler = [
  row({ description: 'PADARIA A', occurredOn: '2026-09-02', amountCents: -1_000 }),
  row({ description: 'PADARIA B', occurredOn: '2026-10-02', amountCents: -1_100 }),
  row({ description: 'PADARIA C', occurredOn: '2026-11-02', amountCents: -1_200 }),
];

describe('recurrenceHistoryStart', () => {
  it('a janela sao 6 meses contando o de hoje, a partir do dia 1', () => {
    expect(HISTORY_MONTHS).toBe(6);
    // nov, out, set, ago, jul, jun -> 1o de junho.
    expect(recurrenceHistoryStart('2026-11-20')).toBe('2026-06-01');
    // Vira o ano: jan/2027 -> ago/2026.
    expect(recurrenceHistoryStart('2027-01-31')).toBe('2026-08-01');
  });
});

describe('suggestRecurrences: o caso do briefing', () => {
  it('assinatura em set, out e nov, ~R$ 39,90 no dia 27', () => {
    const result = suggest([
      row({ occurredOn: '2026-09-27', amountCents: -3_990, categoryId: 'cat-lazer' }),
      row({ occurredOn: '2026-10-27', amountCents: -3_990, categoryId: 'cat-lazer' }),
      row({ occurredOn: '2026-11-28', amountCents: -4_190, categoryId: 'cat-outros' }),
    ]);
    expect(result).toHaveLength(1);
    const [netflix] = result;
    // Valores em modulo: 3990, 3990, 4190 (4190*10 = 41900 <= 3990*11 = 43890: mesma faixa).
    // Mediana inferior de [3990, 3990, 4190] = 3990, com o sinal de despesa.
    // Dias [27, 27, 28] -> mediana 27; o 28 esta a 1 dia.
    expect(netflix).toEqual({
      key: 'expense|netflix.com|3990',
      kind: 'expense',
      description: 'NETFLIX.COM',
      medianCents: -3_990,
      suggestedDay: 27,
      categoryId: 'cat-lazer',
      accountId: null,
      creditCardId: CARD,
      memberId: null,
      months: ['2026-09', '2026-10', '2026-11'],
    });
  });

  it('receita: salario em conta, valor que varia menos de 10%', () => {
    const salary = (occurredOn: string, amountCents: number) =>
      row({ description: 'PAGTO SALARIO EMPRESA X', kind: 'income', accountId: ACCOUNT, creditCardId: null, memberId: 'm-1', occurredOn, amountCents });
    const result = suggest([salary('2026-09-05', 800_000), salary('2026-10-07', 820_000), salary('2026-11-06', 870_000)]);
    // 870000*10 = 8.700.000 <= 800000*11 = 8.800.000: mesma faixa.
    // Mediana inferior de [800000, 820000, 870000] = 820000. Dias [5, 7, 6] -> mediana 6.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'income', medianCents: 820_000, suggestedDay: 6, accountId: ACCOUNT, creditCardId: null, memberId: 'm-1' });
  });
});

describe('suggestRecurrences: quantos meses bastam', () => {
  it('um mes so de historico: nenhuma sugestao', () => {
    expect(suggest([row({ occurredOn: '2026-11-05', amountCents: -3_990 })])).toEqual([]);
    expect(suggest([])).toEqual([]);
  });

  it('dois meses de historico: duas ocorrencias bastam', () => {
    const result = suggest([
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(result.map((item) => item.months)).toEqual([['2026-10', '2026-11']]);
  });

  it('tres meses ou mais de historico: duas ocorrencias nao bastam, tres bastam', () => {
    const two = [
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ];
    expect(suggest([...filler, ...two])).toEqual([]);
    const three = [row({ occurredOn: '2026-09-10', amountCents: -5_000 }), ...two];
    expect(suggest([...filler, ...three]).map((item) => item.key)).toEqual(['expense|netflix.com|5000']);
  });
});

describe('suggestRecurrences: o que NAO e candidato', () => {
  it('parcela de cartao fica de fora (ja esta no comprometido)', () => {
    const result = suggest([
      row({ description: 'LOJA X 01/10', occurredOn: '2026-10-10', amountCents: -5_000, isInstallment: true }),
      row({ description: 'LOJA X 02/10', occurredOn: '2026-11-10', amountCents: -5_000, isInstallment: true }),
      // Sem a parcela a casa teria so um mes de historico; esta linha garante dois.
      row({ description: 'OUTRA', occurredOn: '2026-10-11', amountCents: -100 }),
      row({ description: 'MAIS UMA', occurredOn: '2026-11-11', amountCents: -200 }),
    ]);
    expect(result).toEqual([]);
  });

  it('transferencia, pagamento de fatura e aporte nao viram recorrencia', () => {
    const kinds = ['transfer', 'credit_card_payment', 'investment_contribution'] as const;
    const rows = kinds.flatMap((kind) => [
      row({ description: `MOV ${kind}`, kind, accountId: ACCOUNT, creditCardId: null, occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ description: `MOV ${kind}`, kind, accountId: ACCOUNT, creditCardId: null, occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(suggest(rows)).toEqual([]);
  });

  it('receita sem conta (estorno em cartao) fica de fora', () => {
    const result = suggest([
      row({ description: 'ESTORNO LOJA', kind: 'income', occurredOn: '2026-10-10', amountCents: 5_000 }),
      row({ description: 'ESTORNO LOJA', kind: 'income', occurredOn: '2026-11-10', amountCents: 5_000 }),
    ]);
    expect(result).toEqual([]);
  });

  it('duas vezes no mesmo mes, na mesma faixa de valor, nao e conta fixa', () => {
    const result = suggest([
      row({ description: 'MERCADO BOM', occurredOn: '2026-10-05', amountCents: -20_000 }),
      row({ description: 'MERCADO BOM', occurredOn: '2026-10-08', amountCents: -21_000 }),
      row({ description: 'MERCADO BOM', occurredOn: '2026-11-06', amountCents: -20_500 }),
    ]);
    expect(result).toEqual([]);
  });

  it('valor fora de 10% abre outra faixa: cada faixa e julgada sozinha', () => {
    // 5000 e 5500: 5500*10 = 55000 <= 5000*11 = 55000 -> mesma faixa (limite exato).
    // 5501: 55010 > 55000 -> faixa nova, sozinha, com um mes so -> descartada.
    const result = suggest([
      row({ occurredOn: '2026-09-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-10-10', amountCents: -5_500 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_501 }),
    ]);
    // Historico de 3 meses, e a faixa [5000, 5500] so tem 2: nada.
    expect(result).toEqual([]);
    // Com dois meses de historico (out e nov), a faixa [5000, 5500] basta e a de 12000 sobra sozinha.
    const twoMonths = suggest([
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_500 }),
      row({ occurredOn: '2026-11-12', amountCents: -12_000 }),
    ]);
    // Mediana inferior de [5000, 5500] = 5000.
    expect(twoMonths.map((item) => [item.key, item.medianCents])).toEqual([['expense|netflix.com|5000', -5_000]]);
  });

  it('adiantamento e saldo do mesmo pagador viram duas sugestoes', () => {
    const pay = (occurredOn: string, amountCents: number) =>
      row({ description: 'EMPRESA X', kind: 'income', accountId: ACCOUNT, creditCardId: null, occurredOn, amountCents });
    const result = suggest([pay('2026-10-15', 300_000), pay('2026-10-30', 500_000), pay('2026-11-14', 300_000), pay('2026-11-30', 500_000)]);
    // Maior valor primeiro: 5.000,00 no dia 30, depois 3.000,00 no dia 14 (mediana inferior de [14, 15]).
    expect(result.map((item) => [item.medianCents, item.suggestedDay])).toEqual([
      [500_000, 30],
      [300_000, 14],
    ]);
  });

  it('dia do mes longe demais do mediano descarta', () => {
    // Dias [3, 10, 20] -> mediana 10; o 20 esta a 10 dias (> 5).
    const far = suggest([
      row({ occurredOn: '2026-09-03', amountCents: -5_000 }),
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-20', amountCents: -5_000 }),
    ]);
    expect(far).toEqual([]);
    // Dias [5, 10, 15] -> mediana 10; 5 e 15 estao a exatamente 5 dias: passa.
    const edge = suggest([
      row({ occurredOn: '2026-09-05', amountCents: -5_000 }),
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-15', amountCents: -5_000 }),
    ]);
    expect(edge.map((item) => item.suggestedDay)).toEqual([10]);
  });

  it('cancelada: ultima ocorrencia ha mais de um mes nao e sugerida', () => {
    const rows = [
      row({ occurredOn: '2026-07-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-08-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-09-10', amountCents: -5_000 }),
    ];
    // Hoje em novembro: a ultima foi em setembro (2 meses atras).
    expect(suggest(rows)).toEqual([]);
    // Hoje em outubro: a ultima foi no mes anterior, ainda vale.
    expect(suggest(rows, '2026-10-03').map((item) => item.months)).toEqual([['2026-07', '2026-08', '2026-09']]);
  });

  it('bimestral nao e sugerida como mensal; um unico mes faltando e tolerado', () => {
    // jul, set, nov: do primeiro ao ultimo sao 5 meses para 3 ocorrencias (faltam 2).
    const bimonthly = suggest([
      row({ occurredOn: '2026-07-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-09-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(bimonthly).toEqual([]);
    // ago, set, nov: 4 meses para 3 ocorrencias (falta 1, outubro): passa.
    const oneMissing = suggest([
      row({ occurredOn: '2026-08-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-09-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(oneMissing.map((item) => item.months)).toEqual([['2026-08', '2026-09', '2026-11']]);
  });

  it('ocorrencia antiga isolada e ignorada: vale a sequencia mais recente', () => {
    // jun, set, out, nov: de jun a nov sao 6 meses para 4 ocorrencias (faltam 2). Tirando junho,
    // set a nov sao 3 meses para 3 ocorrencias: passa, e junho nao entra na evidencia nem no valor.
    const result = suggest([
      row({ occurredOn: '2026-06-10', amountCents: -4_600 }),
      row({ occurredOn: '2026-09-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-10-11', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-12', amountCents: -5_050 }),
    ]);
    // Mediana inferior de [5000, 5000, 5050] = 5000; dias [10, 11, 12] -> 11.
    expect(result.map((item) => [item.months, item.medianCents, item.suggestedDay])).toEqual([
      [['2026-09', '2026-10', '2026-11'], -5_000, 11],
    ]);
  });

  it('fora da janela de 6 meses nao conta', () => {
    // Hoje em novembro: a janela comeca em junho. Maio fica fora, e sobram out e nov.
    const result = suggest([
      row({ occurredOn: '2026-05-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(result.map((item) => item.months)).toEqual([['2026-10', '2026-11']]);
  });

  it('ja cadastrada como fixa nao e sugerida de novo; o mesmo nome no outro sentido e', () => {
    const rows = [
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ];
    expect(suggest(rows, TODAY, [{ kind: 'expense', description: 'Netflix.com' }])).toEqual([]);
    expect(suggest(rows, TODAY, [{ kind: 'income', description: 'Netflix.com' }])).toHaveLength(1);
  });

  it('valor zero e descricao vazia nao viram sugestao', () => {
    const result = suggest([
      row({ occurredOn: '2026-10-10', amountCents: 0 }),
      row({ occurredOn: '2026-11-10', amountCents: 0 }),
      row({ description: '   ', occurredOn: '2026-10-10', amountCents: -700 }),
      row({ description: '   ', occurredOn: '2026-11-10', amountCents: -700 }),
    ]);
    expect(result).toEqual([]);
  });
});

describe('suggestRecurrences: agrupamento e desempates', () => {
  it('a mesma loja escrita de formas diferentes cai no mesmo grupo', () => {
    const result = suggest([
      row({ description: 'Spotify  Brasil', occurredOn: '2026-10-12', amountCents: -2_190 }),
      row({ description: 'SPOTIFY BRASIL 8841', occurredOn: '2026-11-12', amountCents: -2_190 }),
    ]);
    expect(result).toHaveLength(1);
    // Empate de frequencia na descricao: vence a da linha mais recente.
    expect(result[0]?.description).toBe('SPOTIFY BRASIL 8841');
    expect(result[0]?.key).toBe('expense|spotify brasil|2190');
  });

  it('receita e despesa com o mesmo nome nao se misturam; receita vem primeiro', () => {
    const result = suggest([
      row({ description: 'ALUGUEL', occurredOn: '2026-10-05', amountCents: -200_000 }),
      row({ description: 'ALUGUEL', occurredOn: '2026-11-05', amountCents: -200_000 }),
      row({ description: 'ALUGUEL', kind: 'income', accountId: ACCOUNT, creditCardId: null, occurredOn: '2026-10-08', amountCents: 150_000 }),
      row({ description: 'ALUGUEL', kind: 'income', accountId: ACCOUNT, creditCardId: null, occurredOn: '2026-11-08', amountCents: 150_000 }),
    ]);
    expect(result.map((item) => [item.kind, item.medianCents])).toEqual([
      ['income', 150_000],
      ['expense', -200_000],
    ]);
  });

  it('categoria e destino: o mais frequente; no empate, o mais recente; conta OU cartao', () => {
    const result = suggest([
      row({ occurredOn: '2026-09-10', amountCents: -5_000, categoryId: 'cat-a', accountId: ACCOUNT, creditCardId: null }),
      row({ occurredOn: '2026-10-10', amountCents: -5_000, categoryId: 'cat-b' }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000, categoryId: null }),
    ]);
    // Categoria: cat-a 1 x cat-b 1 -> empate, vence a mais recente (cat-b); a linha sem categoria nao vota.
    // Destino: conta 1 x cartao 2 -> cartao.
    expect(result[0]).toMatchObject({ categoryId: 'cat-b', accountId: null, creditCardId: CARD });
  });

  it('nenhuma ocorrencia com categoria: categoria nula', () => {
    const result = suggest([
      row({ occurredOn: '2026-10-10', amountCents: -5_000 }),
      row({ occurredOn: '2026-11-10', amountCents: -5_000 }),
    ]);
    expect(result[0]?.categoryId).toBeNull();
  });

  it('mes de 28, 30 e 31 dias: o dia 31 e o dia 28 de fevereiro ficam proximos o bastante', () => {
    // dez/31, jan/31, fev/28: dias [31, 31, 28] -> mediana 31; o 28 esta a 3 dias.
    const result = suggest(
      [
        row({ occurredOn: '2026-12-31', amountCents: -9_000 }),
        row({ occurredOn: '2027-01-31', amountCents: -9_000 }),
        row({ occurredOn: '2027-02-28', amountCents: -9_000 }),
      ],
      '2027-02-28',
    );
    expect(result.map((item) => [item.suggestedDay, item.months])).toEqual([[31, ['2026-12', '2027-01', '2027-02']]]);
  });

  it('data invalida no historico lanca, em vez de virar sugestao torta', () => {
    expect(() => suggest([row({ occurredOn: '2026-02-30', amountCents: -5_000 })])).toThrow();
  });
});
