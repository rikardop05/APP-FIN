import { describe, expect, it } from 'vitest';

import { missingStatementCompetences, missingStatements } from '@/lib/finance/missing-statements';

/** Fecha dia 10, vence dia 20 do MESMO mes (dueDay > closingDay). */
const SAME_MONTH = { id: 'same', closingDay: 10, dueDay: 20 };
/** Fecha dia 30, vence dia 7 do mes SEGUINTE (dueDay <= closingDay): a fatura de nov fecha em 30/10. */
const NEXT_MONTH = { id: 'next', closingDay: 30, dueDay: 7 };
/** O caso do achado da virada do mes: fecha 25, vence 28 do mesmo mes. */
const LATE = { id: 'late', closingDay: 25, dueDay: 28 };

const st = (creditCardId: string, period: string) => ({ creditCardId, period });
const competencesOf = (items: { competence: string }[]) => items.map((item) => item.competence);

describe('missingStatementCompetences', () => {
  it('a anterior e a corrente, nessa ordem, inclusive na virada do ano', () => {
    expect(missingStatementCompetences('2026-11-15')).toEqual(['2026-10', '2026-11']);
    expect(missingStatementCompetences('2027-01-02')).toEqual(['2026-12', '2027-01']);
  });
});

describe('missingStatements — competencia corrente (conta sempre)', () => {
  it('cartao que fecha e vence no mesmo mes: so e pendencia DEPOIS do dia do fechamento', () => {
    // Fatura de novembro fecha em 10/11. Cartao sem nenhuma fatura.
    const on = (today: string) => missingStatements({ today, cards: [SAME_MONTH], statements: [] });
    expect(on('2026-11-09')).toEqual([]); // ainda aberta
    expect(on('2026-11-10')).toEqual([]); // dia do fechamento: ainda recebe compra
    expect(on('2026-11-11')).toEqual([
      { creditCardId: 'same', competence: '2026-11', closingDate: '2026-11-10', dueDate: '2026-11-20' },
    ]);
    expect(on('2026-11-30')).toHaveLength(1); // continua ate importar
  });

  it('cartao que vence no mes seguinte ao fechamento: a fatura do mes fechou no mes anterior, pendente desde o dia 1', () => {
    // Competencia = mes do vencimento: fatura de novembro fecha 30/10 e vence 07/11.
    expect(missingStatements({ today: '2026-11-01', cards: [NEXT_MONTH], statements: [] })).toEqual([
      { creditCardId: 'next', competence: '2026-11', closingDate: '2026-10-30', dueDate: '2026-11-07' },
    ]);
  });

  it('fatura da corrente ja existe: nao e pendencia', () => {
    expect(
      missingStatements({ today: '2026-11-15', cards: [SAME_MONTH], statements: [st('same', '2026-11')] }),
    ).toEqual([]);
  });

  it('fatura de OUTRO cartao ou de competencia futura nao quita a do mes', () => {
    const result = missingStatements({
      today: '2026-11-15',
      cards: [SAME_MONTH],
      statements: [st('same', '2026-12'), st('next', '2026-11')],
    });
    expect(competencesOf(result)).toEqual(['2026-11']);
  });

  it('fechamento 31 em mes curto ancora no ultimo dia: a fatura de marco fecha em 28/02', () => {
    // Fecha 31, vence 31 (dueDay <= closingDay -> vence no mes seguinte ao fechamento).
    const card = { id: 'c31', closingDay: 31, dueDay: 31 };
    expect(missingStatements({ today: '2026-03-01', cards: [card], statements: [] })).toEqual([
      { creditCardId: 'c31', competence: '2026-03', closingDate: '2026-02-28', dueDate: '2026-03-31' },
    ]);
  });

  it('virada de ano: em janeiro, a fatura de janeiro de quem vence no mes seguinte fechou em dezembro', () => {
    expect(missingStatements({ today: '2027-01-02', cards: [NEXT_MONTH], statements: [] })).toEqual([
      { creditCardId: 'next', competence: '2027-01', closingDate: '2026-12-30', dueDate: '2027-01-07' },
    ]);
  });
});

describe('missingStatements — a anterior NAO conta quando e o comeco do historico', () => {
  it('o caso da casa real: historico comeca em novembro -> nenhuma "fatura de outubro" falsa', () => {
    // 5 cartoes, todos so com a fatura de novembro; hoje 10/11.
    const cards = [1, 2, 3, 4, 5].map((n) => ({ id: `c${String(n)}`, closingDay: 30, dueDay: 7 }));
    const statements = cards.map((card) => st(card.id, '2026-11'));
    expect(missingStatements({ today: '2026-11-10', cards, statements })).toEqual([]);
  });

  it('cartao recem-cadastrado, sem fatura na vida: so a corrente (se ja fechou), nunca a anterior', () => {
    expect(competencesOf(missingStatements({ today: '2026-11-11', cards: [SAME_MONTH], statements: [] }))).toEqual([
      '2026-11',
    ]);
    // Antes de a corrente fechar: nada.
    expect(missingStatements({ today: '2026-11-05', cards: [SAME_MONTH], statements: [] })).toEqual([]);
  });

  it('historico que comeca NA anterior (ela existe) ou na corrente: nada a cobrar para tras', () => {
    expect(
      missingStatements({ today: '2026-12-01', cards: [LATE], statements: [st('late', '2026-11')] }),
    ).toEqual([]);
    // Fatura mais antiga de OUTRO cartao nao da historico a este.
    expect(
      missingStatements({
        today: '2026-11-05',
        cards: [SAME_MONTH],
        statements: [st('next', '2026-08'), st('same', '2026-11')],
      }),
    ).toEqual([]);
  });

  it('custo aceito: a primeira fatura do cartao, nunca importada, some na virada do mes', () => {
    // Novembro e pendencia enquanto e a corrente...
    expect(competencesOf(missingStatements({ today: '2026-11-30', cards: [LATE], statements: [] }))).toEqual([
      '2026-11',
    ]);
    // ...e em dezembro, sem nenhuma fatura antes dela, nao ha buraco a caracterizar.
    expect(missingStatements({ today: '2026-12-01', cards: [LATE], statements: [] })).toEqual([]);
  });
});

describe('missingStatements — a anterior conta quando e um BURACO no historico', () => {
  it('cartao com fatura de outubro e sem a de novembro: novembro segue pendente em dezembro', () => {
    // Em 30/11 ja era pendencia (fechou 25/11); em 01/12 a corrente vira dezembro (fecha 25/12,
    // ainda aberta) e a de novembro segue cobrada como anterior, porque outubro existe.
    const november = { creditCardId: 'late', competence: '2026-11', closingDate: '2026-11-25', dueDate: '2026-11-28' };
    const on = (today: string) => missingStatements({ today, cards: [LATE], statements: [st('late', '2026-10')] });
    expect(on('2026-11-30')).toEqual([november]);
    expect(on('2026-12-01')).toEqual([november]);
    expect(on('2026-12-25')).toEqual([november]); // dia do fechamento de dezembro: ainda so novembro
  });

  it('qualquer fatura mais antiga serve de historico, nao so a imediatamente anterior', () => {
    expect(
      competencesOf(missingStatements({ today: '2026-12-01', cards: [LATE], statements: [st('late', '2026-03')] })),
    ).toEqual(['2026-11']);
  });

  it('buraco na anterior e corrente fechada sem fatura: DUAS pendencias, a mais antiga primeiro', () => {
    expect(missingStatements({ today: '2026-12-26', cards: [LATE], statements: [st('late', '2026-10')] })).toEqual([
      { creditCardId: 'late', competence: '2026-11', closingDate: '2026-11-25', dueDate: '2026-11-28' },
      { creditCardId: 'late', competence: '2026-12', closingDate: '2026-12-25', dueDate: '2026-12-28' },
    ]);
  });

  it('importar a anterior tira so ela; importar a corrente tira so ela', () => {
    const on = (extra: { creditCardId: string; period: string }[]) =>
      competencesOf(
        missingStatements({ today: '2026-12-26', cards: [LATE], statements: [st('late', '2026-10'), ...extra] }),
      );
    expect(on([st('late', '2026-11')])).toEqual(['2026-12']);
    expect(on([st('late', '2026-12')])).toEqual(['2026-11']);
  });

  it('so UMA competencia para tras: buraco de dois meses atras nao vira pendencia', () => {
    // Tem setembro; faltam outubro e novembro. Em dezembro so novembro e cobrada.
    const result = missingStatements({ today: '2026-12-01', cards: [LATE], statements: [st('late', '2026-09')] });
    expect(competencesOf(result)).toEqual(['2026-11']);
  });

  it('virada de ano: em janeiro a anterior e dezembro do ano passado', () => {
    expect(missingStatements({ today: '2027-01-03', cards: [LATE], statements: [st('late', '2026-11')] })).toEqual([
      { creditCardId: 'late', competence: '2026-12', closingDate: '2026-12-25', dueDate: '2026-12-28' },
    ]);
  });

  it('fevereiro curto: fechamento 30 ancora em 28/02 e a fatura de fevereiro e cobrada em marco', () => {
    // Fecha 30, vence 31 do mesmo mes (dueDay > closingDay): fevereiro fecha 28/02 e vence 28/02.
    const card = { id: 'feb', closingDay: 30, dueDay: 31 };
    expect(missingStatements({ today: '2026-03-05', cards: [card], statements: [st('feb', '2026-01')] })).toEqual([
      { creditCardId: 'feb', competence: '2026-02', closingDate: '2026-02-28', dueDate: '2026-02-28' },
    ]);
  });
});

describe('missingStatements — varios cartoes e validacao', () => {
  it('uma entrada por cartao e competencia; cartoes na ordem recebida; cada cartao com o seu historico', () => {
    const result = missingStatements({
      today: '2026-11-12',
      cards: [NEXT_MONTH, LATE, SAME_MONTH],
      // So 'late' tem historico antes de outubro: so ele e cobrado pela anterior.
      statements: [st('late', '2026-09')],
    });
    // 'late' novembro fecha 25/11: ainda aberta em 12/11.
    expect(result.map((item) => `${item.creditCardId} ${item.competence}`)).toEqual([
      'next 2026-11',
      'late 2026-10',
      'same 2026-11',
    ]);
  });

  it('sem cartao: lista vazia', () => {
    expect(missingStatements({ today: '2026-11-15', cards: [], statements: [] })).toEqual([]);
  });

  it('data ou dia de ciclo invalido lanca, sem fallback', () => {
    expect(() => missingStatements({ today: '2026-02-30', cards: [SAME_MONTH], statements: [] })).toThrow();
    expect(() =>
      missingStatements({ today: '2026-11-15', cards: [{ id: 'x', closingDay: 0, dueDay: 5 }], statements: [] }),
    ).toThrow(RangeError);
  });
});
