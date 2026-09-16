import { describe, expect, it } from 'vitest';

import { futureCommitment, type CommitmentInput } from '@/lib/finance/commitment';
import { expandInstallmentPlan } from '@/lib/finance/installments';
import { addCents, cents } from '@/lib/money';

type Tx = CommitmentInput['transactions'][number];
type Card = CommitmentInput['cards'][number];
type Competence = CommitmentInput['fromCompetence'];

/**
 * Gera os lancamentos de um plano de parcela, um por competencia.
 *
 * O valor de cada parcela vem de `allocate` dentro de `expandInstallmentPlan`
 * (CONVENTIONS §2). O total e passado NEGATIVO porque compra de cartao e saida
 * de dinheiro (CONVENTIONS §2) — e e o sinal que a agregacao deve preservar.
 */
function planTransactions(
  totalCents: number,
  installmentsCount: number,
  firstCompetence: Competence,
  creditCardId: string,
  status: Tx['status'] = 'planned',
): Tx[] {
  return expandInstallmentPlan({
    totalCents: cents(totalCents),
    installmentsCount,
    firstCompetence,
    description: 'Plano de teste',
  }).map((installment) => ({
    competence: installment.competence,
    amountCents: installment.amountCents,
    creditCardId,
    status,
  }));
}

const CARD_A: Card = {
  id: 'card-a',
  name: 'A',
  creditLimitCents: cents(500000),
};
const CARD_B: Card = { id: 'card-b', name: 'B', creditLimitCents: null };
const CARD_C: Card = {
  id: 'card-c',
  name: 'C',
  creditLimitCents: cents(100000),
};

describe('futureCommitment', () => {
  it('3 planos em cartoes diferentes agregam por competencia, sem perder o sinal', () => {
    // Plano A: R$ 300,00 em 3x de mar/2026 (-30000 / 3 = -10000 exato).
    // Plano B: R$ 100,01 em 2x de abr/2026 -> allocate(-10001, 2): resto -1,
    //   base -5000, primeira parcela leva o centavo -> -5001 / -5000.
    // Plano C: R$ 50,00 em 1x de mar/2026 -> -5000.
    const transactions: Tx[] = [
      ...planTransactions(-30000, 3, '2026-03', CARD_A.id),
      ...planTransactions(-10001, 2, '2026-04', CARD_B.id),
      ...planTransactions(-5000, 1, '2026-03', CARD_C.id),
    ];

    const result = futureCommitment({
      transactions,
      fromCompetence: '2026-03',
      months: 6,
      cards: [CARD_A, CARD_B, CARD_C],
    });

    // Conta a mao, mes a mes:
    //   mar: A -10000 + C -5000                       = -15000
    //   abr: A -10000 + B -5001                       = -15001
    //   mai: A -10000 + B -5000                       = -15000
    //   jun, jul, ago: sem parcela                    =      0
    //   total: -15000 - 15001 - 15000                 = -45001
    expect(result.byCompetence).toEqual([
      {
        competence: '2026-03',
        totalCents: -15000,
        byCardId: { 'card-a': -10000, 'card-c': -5000 },
      },
      {
        competence: '2026-04',
        totalCents: -15001,
        byCardId: { 'card-a': -10000, 'card-b': -5001 },
      },
      {
        competence: '2026-05',
        totalCents: -15000,
        byCardId: { 'card-a': -10000, 'card-b': -5000 },
      },
      { competence: '2026-06', totalCents: 0, byCardId: {} },
      { competence: '2026-07', totalCents: 0, byCardId: {} },
      { competence: '2026-08', totalCents: 0, byCardId: {} },
    ]);

    expect(result.totalCents).toBe(-45001);
    // Ultimo mes com parcela e maio/2026 (aceite T-110). Jun/2026 ja zera.
    expect(result.lastCommittedCompetence).toBe('2026-05');

    // Limite A: 30000 / 500000 * 10000 = 600 bp (6,00 %).
    // Limite C:  5000 / 100000 * 10000 = 500 bp (5,00 %).
    // B nao tem limite cadastrado -> usageBp null, never NaN/Infinity.
    expect(result.limitUsage).toEqual([
      { cardId: 'card-a', usedCents: -30000, usageBp: 600 },
      { cardId: 'card-b', usedCents: -10001, usageBp: null },
      { cardId: 'card-c', usedCents: -5000, usageBp: 500 },
    ]);
  });

  it('lastCommittedCompetence e o ultimo mes com parcela, nao o fim da janela', () => {
    // Uma parcela unica em jan/2027 numa janela de 12 meses a partir de
    // jun/2026: so jan/2027 carrega valor; fev../2027 mai/2027 zeram.
    const result = futureCommitment({
      transactions: planTransactions(-1000, 1, '2027-01', CARD_A.id),
      fromCompetence: '2026-06',
      months: 12,
      cards: [CARD_A],
    });

    expect(result.byCompetence.map((entry) => entry.competence)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
    ]);
    expect(result.lastCommittedCompetence).toBe('2027-01');
  });

  it('lancamento fora da janela nao entra em nada (passado nem futuro alem do fim)', () => {
    const transactions: Tx[] = [
      ...planTransactions(-1000, 1, '2026-02', CARD_A.id),
      ...planTransactions(-2000, 1, '2026-09', CARD_A.id),
    ];

    const result = futureCommitment({
      transactions,
      fromCompetence: '2026-03',
      months: 6,
      cards: [CARD_A],
    });

    expect(result.byCompetence.every((entry) => entry.totalCents === 0)).toBe(true);
    expect(result.totalCents).toBe(0);
    expect(result.lastCommittedCompetence).toBeNull();
    // Sem comprometimento na janela, o cartao fica com zero usado.
    expect(result.limitUsage).toEqual([
      { cardId: 'card-a', usedCents: 0, usageBp: 0 },
    ]);
  });

  it('janela vazia (months 0) devolve tudo zerado, nunca NaN', () => {
    const result = futureCommitment({
      transactions: planTransactions(-5000, 2, '2026-03', CARD_A.id),
      fromCompetence: '2026-03',
      months: 0,
      cards: [CARD_A],
    });

    expect(result.byCompetence).toEqual([]);
    expect(result.totalCents).toBe(0);
    expect(result.lastCommittedCompetence).toBeNull();
    expect(result.limitUsage).toEqual([
      { cardId: 'card-a', usedCents: 0, usageBp: 0 },
    ]);
  });

  it('cartao sem lancamento na janela aparece com uso zero (limite e sem limite)', () => {
    const cardNoLimit: Card = { id: 'card-d', name: 'D', creditLimitCents: null };
    const cardWithLimit: Card = {
      id: 'card-e',
      name: 'E',
      creditLimitCents: cents(200000),
    };

    const result = futureCommitment({
      transactions: [],
      fromCompetence: '2026-03',
      months: 3,
      cards: [cardWithLimit, cardNoLimit],
    });

    // usageBp de usado zero com limite de 200000: 0 / 200000 = 0 bp.
    expect(result.limitUsage).toEqual([
      { cardId: 'card-e', usedCents: 0, usageBp: 0 },
      { cardId: 'card-d', usedCents: 0, usageBp: null },
    ]);
  });

  it('usageBp arredonda a razao para o bp mais proximo (empate afasta do zero)', () => {
    // R$ 123,45 de R$ 1.000,00: 12345 / 100000 * 10000 = 1234,5 bp -> 1235.
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-12345),
          creditCardId: CARD_C.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [CARD_C],
    });

    expect(result.limitUsage[0]?.usageBp).toBe(1235);
  });

  it('uso acima do limite nao trava: percentual passa de 100 %', () => {
    // R$ 2.500,00 de limite R$ 1.000,00: 250000 / 100000 * 10000 = 25000 bp.
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-250000),
          creditCardId: CARD_C.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [CARD_C],
    });

    expect(result.limitUsage[0]?.usageBp).toBe(25000);
  });

  it('razao absurda satura em vez de lancar e nao derruba os outros cartoes', () => {
    // Limite cadastrado errado: 1 centavo. Uso de 1e15 centavos (R$ 10 trilhoes)
    // da razao 1e15 * 10000 = 1e19 bp, acima do safe integer. Em vez de lancar
    // RangeError e derrubar a visao de TODOS os cartoes, satura no maximo
    // representavel; o cartao sao segue calculado normalmente.
    const brokenLimit: Card = {
      id: 'card-quebrado',
      name: 'Q',
      creditLimitCents: cents(1),
    };

    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-1000000000000000),
          creditCardId: brokenLimit.id,
          status: 'posted',
        },
        {
          competence: '2026-03',
          amountCents: cents(-5000),
          creditCardId: CARD_C.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [brokenLimit, CARD_C],
    });

    expect(result.limitUsage[0]?.usageBp).toBe(Number.MAX_SAFE_INTEGER);
    // Nao e null: null significa "sem limite cadastrado", e aqui HA limite.
    expect(result.limitUsage[0]?.usageBp).not.toBeNull();
    // O cartao sao: 5000 / 100000 * 10000 = 500 bp.
    expect(result.limitUsage[1]?.usageBp).toBe(500);
  });

  it('limite zero devolve usageBp null em vez de dividir por zero', () => {
    const zeroLimit: Card = { id: 'card-z', name: 'Z', creditLimitCents: cents(0) };

    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-1000),
          creditCardId: zeroLimit.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [zeroLimit],
    });

    expect(result.limitUsage).toEqual([
      { cardId: 'card-z', usedCents: -1000, usageBp: null },
    ]);
  });

  it('posted e planned somam igual: a competencia ja e o eixo do mes', () => {
    const transactions: Tx[] = [
      {
        competence: '2026-03',
        amountCents: cents(-3000),
        creditCardId: CARD_A.id,
        status: 'posted',
      },
      {
        competence: '2026-03',
        amountCents: cents(-2000),
        creditCardId: CARD_A.id,
        status: 'planned',
      },
    ];

    const result = futureCommitment({
      transactions,
      fromCompetence: '2026-03',
      months: 1,
      cards: [CARD_A],
    });

    // -3000 + (-2000) = -5000 no mesmo mes.
    expect(result.byCompetence[0]?.totalCents).toBe(-5000);
    expect(result.byCompetence[0]?.byCardId['card-a']).toBe(-5000);
  });

  it('credito (devolucao) abate o mes: a soma e liquida', () => {
    // Compra de -10000 e estorno de +4000 no mesmo mes/cartao -> -6000.
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-10000),
          creditCardId: CARD_A.id,
          status: 'posted',
        },
        {
          competence: '2026-03',
          amountCents: cents(4000),
          creditCardId: CARD_A.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [CARD_A],
    });

    expect(result.byCompetence[0]?.totalCents).toBe(-6000);
  });

  it('mes com parcelas que se anulam nao conta como comprometimento (liquido zero)', () => {
    // +5000 e -5000 no mesmo mes: total zero, entao o mes nao e "commitido".
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-04',
          amountCents: cents(5000),
          creditCardId: CARD_A.id,
          status: 'posted',
        },
        {
          competence: '2026-04',
          amountCents: cents(-5000),
          creditCardId: CARD_A.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 2,
      cards: [CARD_A],
    });

    expect(result.lastCommittedCompetence).toBeNull();
  });

  it('mes final so de estorno nao conta: aponta o penultimo mes DEVEDOR', () => {
    // Compra de mar (-3000) e estorno puro em mai (+5000). O ultimo mes com
    // movimento e maio, mas so recebe dinheiro; o ultimo mes DEVEDOR e marco.
    // Se apontasse maio, a tela diria "voce termina de pagar em maio" num mes
    // em que a familia RECEBE (CONTRACTS §5).
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-3000),
          creditCardId: CARD_A.id,
          status: 'planned',
        },
        {
          competence: '2026-05',
          amountCents: cents(5000),
          creditCardId: CARD_A.id,
          status: 'posted',
        },
      ],
      fromCompetence: '2026-03',
      months: 4,
      cards: [CARD_A],
    });

    expect(result.byCompetence.map((entry) => entry.totalCents)).toEqual([
      -3000, 0, 5000, 0,
    ]);
    expect(result.lastCommittedCompetence).toBe('2026-03');
  });

  it('cartao presente em lancamento mas ausente de cards nao desaparece do uso', () => {
    // Card desconhecido: nao ha limite a consultar -> usageBp null, mas o valor
    // comprometido continua contado (dinheiro nao some calado).
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-03',
          amountCents: cents(-7000),
          creditCardId: 'card-orfao',
          status: 'planned',
        },
      ],
      fromCompetence: '2026-03',
      months: 1,
      cards: [CARD_A],
    });

    expect(result.byCompetence[0]?.byCardId['card-orfao']).toBe(-7000);
    expect(result.limitUsage).toEqual([
      { cardId: 'card-a', usedCents: 0, usageBp: 0 },
      { cardId: 'card-orfao', usedCents: -7000, usageBp: null },
    ]);
  });

  it('a janela inclui fevereiro curto e vira o ano sem depender de dias', () => {
    // jan/2026 -> abr/2026: fevereiro (28 dias), marco (31) e abril (30) sao
    // competencias de `lib/date`; aqui sao so rotulos consecutivos. O dia do
    // mes e responsabilidade de lib/date e billing, nao deste motor.
    const result = futureCommitment({
      transactions: [
        {
          competence: '2026-02',
          amountCents: cents(-2800),
          creditCardId: CARD_A.id,
          status: 'planned',
        },
      ],
      fromCompetence: '2026-01',
      months: 4,
      cards: [CARD_A],
    });

    expect(result.byCompetence.map((entry) => entry.competence)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(result.lastCommittedCompetence).toBe('2026-02');
  });

  it('soma dos meses fecha exatamente com totalCents (allocate nao perde centavo)', () => {
    // R$ 100,00 em 3x: 33,34 / 33,33 / 33,33, soma exata 100,00.
    const result = futureCommitment({
      transactions: planTransactions(-10000, 3, '2026-03', CARD_A.id),
      fromCompetence: '2026-03',
      months: 3,
      cards: [CARD_A],
    });

    expect(result.byCompetence.map((entry) => entry.totalCents)).toEqual([
      -3334, -3333, -3333,
    ]);
    expect(
      addCents(...result.byCompetence.map((entry) => entry.totalCents)),
    ).toBe(-10000);
    expect(result.totalCents).toBe(-10000);
  });

  it('recusa janela invalida e competencia malformada', () => {
    // months negativo: `competenceRange` lanca.
    expect(() =>
      futureCommitment({
        transactions: [],
        fromCompetence: '2026-03',
        months: -1,
        cards: [],
      }),
    ).toThrow(RangeError);

    // Competencia fora de 'YYYY-MM' lanca na validacao de lib/date.
    expect(() =>
      futureCommitment({
        transactions: [],
        fromCompetence: '2026-3',
        months: 3,
        cards: [],
      }),
    ).toThrow(RangeError);
  });
});
