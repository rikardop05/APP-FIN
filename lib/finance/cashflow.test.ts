import { describe, expect, it } from 'vitest';

import { projectCashflow, projectWithOverdueStatements, type CashflowInput } from '@/lib/finance/cashflow';
import { cents } from '@/lib/money';

function occ(competence: string, amountCents: number) {
  return { competence, date: `${competence}-05`, amountCents: cents(amountCents) };
}

function entry(competence: string, amountCents: number) {
  return { competence, amountCents: cents(amountCents) };
}

function baseInput(overrides: Partial<CashflowInput>): CashflowInput {
  return {
    openingBalanceCents: cents(0),
    fromCompetence: '2026-01',
    months: 1,
    incomes: [],
    recurringExpenses: [],
    installments: [],
    statementsDue: [],
    plannedContributions: [],
    ...overrides,
  };
}

describe('projectCashflow — identidade do mes e encadeamento', () => {
  it('calcula net como resultado do mes e closing como acumulado (conta a mao)', () => {
    // Janela de 1 mes, saldo inicial 100000 (R$ 1.000,00).
    //   income 50000, expense 30000, installments 10000,
    //   statements 5000, contributions 2000.
    //   net = 50000 - 30000 - 10000 - 5000 - 2000 = 3000.
    //   closing = 100000 + 3000 = 103000.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(100000),
        months: 1,
        incomes: [occ('2026-01', 50000)],
        recurringExpenses: [occ('2026-01', -30000)],
        installments: [entry('2026-01', 10000)],
        statementsDue: [entry('2026-01', 5000)],
        plannedContributions: [entry('2026-01', 2000)],
      }),
    );

    const month = result.months[0];
    expect(month?.openingCents).toBe(100000);
    expect(month?.incomeCents).toBe(50000);
    expect(month?.expenseCents).toBe(30000);
    expect(month?.installmentsCents).toBe(10000);
    expect(month?.statementsCents).toBe(5000);
    expect(month?.contributionsCents).toBe(2000);
    expect(month?.netCents).toBe(3000);
    expect(month?.closingCents).toBe(103000);
    expect(month?.negative).toBe(false);
  });

  it('mes com resultado negativo e saldo positivo NAO e quebrar', () => {
    // Saldo 100000. net = 10000 - 40000 = -30000. closing = 70000 (positivo).
    // netCents < 0 mas closingCents > 0 -> nao entra em firstNegativeCompetence.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(100000),
        months: 1,
        incomes: [occ('2026-01', 10000)],
        recurringExpenses: [occ('2026-01', -40000)],
      }),
    );

    expect(result.months[0]?.netCents).toBe(-30000);
    expect(result.months[0]?.closingCents).toBe(70000);
    expect(result.months[0]?.negative).toBe(false);
    expect(result.firstNegativeCompetence).toBeNull();
  });

  it('encadeia sobre a JANELA INTEIRA: closing(m) = opening(m+1) em todos os meses', () => {
    // Propriedade, nao so vizinhos: para todo mes, o fechamento e o abertura do
    // seguinte; o primeiro abre no saldo inicial.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(50000),
        months: 12,
        incomes: [occ('2026-06', 99999)],
        recurringExpenses: [occ('2026-03', -12345)],
        installments: [entry('2026-08', 7777)],
      }),
    );

    expect(result.months).toHaveLength(12);
    expect(result.months[0]?.openingCents).toBe(50000);
    for (let i = 0; i < result.months.length - 1; i += 1) {
      expect(result.months[i]?.closingCents).toBe(result.months[i + 1]?.openingCents);
    }
    // O ultimo fechamento e o saldo inicial mais a soma de todos os nets.
    const sumNet = result.months.reduce((acc, m) => acc + (m.netCents ?? 0), 0);
    expect(result.months[11]?.closingCents).toBe(50000 + sumNet);
  });

  it('mes sem lancamento zera o resultado e nao altera o saldo', () => {
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(7000),
        months: 3,
        incomes: [occ('2026-03', 1000)],
      }),
    );
    expect(result.months[0]?.netCents).toBe(0);
    expect(result.months[0]?.closingCents).toBe(7000);
    expect(result.months[1]?.closingCents).toBe(7000);
    expect(result.months[2]?.closingCents).toBe(8000);
  });
});

describe('projectCashflow — firstNegativeCompetence', () => {
  it('e o PRIMEIRO mes com fechamento negativo, nao o menor saldo', () => {
    // Saldo inicial 0.
    //   jan: +10000 -> closing 10000 (positivo)
    //   fev: -20000 -> closing -10000 (primeiro negativo) -> first = fev
    //   mar: -1000  -> closing -11000 (MAIS negativo, mas nao e o first)
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(0),
        months: 3,
        incomes: [occ('2026-01', 10000)],
        recurringExpenses: [occ('2026-02', -20000), occ('2026-03', -1000)],
      }),
    );

    expect(result.firstNegativeCompetence).toBe('2026-02');
    expect(result.minClosingCents).toBe(-11000);
  });

  it('null quando nenhum fechamento e negativo', () => {
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(100000),
        months: 3,
        recurringExpenses: [occ('2026-02', -10000)],
      }),
    );
    expect(result.firstNegativeCompetence).toBeNull();
    expect(result.minClosingCents).toBe(90000);
  });

  it('zero no fechamento nao e negativo', () => {
    // Saldo 10000, despesa 10000 -> closing 0 -> nao e negativo.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(10000),
        months: 2,
        recurringExpenses: [occ('2026-01', -10000)],
      }),
    );
    expect(result.months[0]?.closingCents).toBe(0);
    expect(result.months[0]?.negative).toBe(false);
    expect(result.firstNegativeCompetence).toBeNull();
  });
});

describe('projectCashflow — adjustments do modo "e se"', () => {
  it('aplica ajuste positivo (entrada) e negativo (saida) no mes da competencia', () => {
    // 13o de 20000 em dez: net = 0 + 20000 = 20000; closing = 0 + 20000.
    const comAjuste = projectCashflow(
      baseInput({
        months: 2,
        adjustments: [
          { competence: '2026-02', amountCents: cents(20000), label: '13o' },
        ],
      }),
    );
    expect(comAjuste.months[1]?.netCents).toBe(20000);
    expect(comAjuste.months[1]?.closingCents).toBe(20000);

    // Corte de 5000 de lazer: net = -5000.
    const corte = projectCashflow(
      baseInput({
        months: 2,
        adjustments: [
          { competence: '2026-01', amountCents: cents(-5000), label: 'cortar lazer' },
        ],
      }),
    );
    expect(corte.months[0]?.netCents).toBe(-5000);
    expect(corte.months[0]?.closingCents).toBe(-5000);
  });

  it('sem adjustments produz o mesmo resultado que adjustments vazio', () => {
    const semCampo = projectCashflow(
      baseInput({ months: 3, incomes: [occ('2026-02', 12345)] }),
    );
    const vazio = projectCashflow(
      baseInput({ months: 3, incomes: [occ('2026-02', 12345)], adjustments: [] }),
    );
    expect(semCampo).toEqual(vazio);
  });

  it('nao altera a entrada: o mesmo input aplicado duas vezes da o mesmo resultado (puro)', () => {
    const input = baseInput({
      openingBalanceCents: cents(1000),
      months: 4,
      adjustments: [
        { competence: '2026-03', amountCents: cents(-700), label: 'e se' },
      ],
    });
    const first = projectCashflow(input);
    const second = projectCashflow(input);
    expect(first).toEqual(second);
  });
});

describe('projectCashflow — janela, sinais e validacao', () => {
  it('gera a janela consecutiva a partir de fromCompetence cruzando o ano', () => {
    const result = projectCashflow(
      baseInput({ fromCompetence: '2026-11', months: 4 }),
    );
    expect(result.months.map((m) => m.competence)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('janela vazia: minClosingCents e null, nao o saldo de abertura', () => {
    // Sem fechamento nao ha o que minimizar. Devolver a abertura seria um valor
    // que nao e fechamento com nome de fechamento (achado do Corvo).
    const result = projectCashflow(
      baseInput({ openingBalanceCents: cents(4321), months: 0 }),
    );
    expect(result.months).toEqual([]);
    expect(result.firstNegativeCompetence).toBeNull();
    expect(result.minClosingCents).toBeNull();
  });

  it('minClosingCents e o menor FECHAMENTO, nao a abertura (caso so sobe)', () => {
    // Saldo 1000, 2 meses, so receita de 500/mes:
    //   jan: open 1000 -> close 1500
    //   fev: open 1500 -> close 2000
    // Nenhum fechamento vale 1000: o minimo dos fechamentos e 1500, NAO a
    // abertura (1000). A versao antiga devolvia 1000.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(1000),
        months: 2,
        incomes: [occ('2026-01', 500), occ('2026-02', 500)],
      }),
    );
    expect(result.months.map((m) => m.closingCents)).toEqual([1500, 2000]);
    expect(result.minClosingCents).toBe(1500);
  });

  it('minClosingCents pega o menor fechamento quando ele e menor que a abertura', () => {
    // Saldo 1000; jan close 500, fev close 200, mar close 900.
    // O menor FECHAMENTO e 200 (fev) — prova que a mudanca nao inverteu nada.
    const result = projectCashflow(
      baseInput({
        openingBalanceCents: cents(1000),
        months: 3,
        recurringExpenses: [occ('2026-01', -500), occ('2026-02', -300)],
        adjustments: [
          { competence: '2026-03', amountCents: cents(700), label: 'extra' },
        ],
      }),
    );
    expect(result.months.map((m) => m.closingCents)).toEqual([500, 200, 900]);
    expect(result.minClosingCents).toBe(200);
  });

  it('recusa despesa recorrente com sinal positivo', () => {
    expect(() =>
      projectCashflow(
        baseInput({ months: 1, recurringExpenses: [occ('2026-01', 5000)] }),
      ),
    ).toThrow(RangeError);
  });

  it('recusa installment, statement e contribution negativos', () => {
    expect(() =>
      projectCashflow(baseInput({ months: 1, installments: [entry('2026-01', -1)] })),
    ).toThrow(RangeError);
    expect(() =>
      projectCashflow(baseInput({ months: 1, statementsDue: [entry('2026-01', -1)] })),
    ).toThrow(RangeError);
    expect(() =>
      projectCashflow(
        baseInput({ months: 1, plannedContributions: [entry('2026-01', -1)] }),
      ),
    ).toThrow(RangeError);
  });

  it('recusa months negativo ou fracionario', () => {
    expect(() => projectCashflow(baseInput({ months: -1 }))).toThrow(RangeError);
    expect(() => projectCashflow(baseInput({ months: 1.5 }))).toThrow(RangeError);
  });

  it('rejeita transfer e pagamento de fatura por construcao: nao ha campo para eles', () => {
    // RC-03: o contrato §11 nao expoe `kind` nem esses dois lancamentos. O teste
    // documenta que o motor nao tem porta para eles — o pagamento de fatura entra
    // so por statementsDue, contado uma vez.
    const key = 'creditCardPayments';
    expect(Object.prototype.hasOwnProperty.call(baseInput({}), key)).toBe(false);
  });
});

describe('projectWithOverdueStatements — segunda leitura do veredito (2026-10-09)', () => {
  // Saldo 10.000,00 em out/26; faturas de 6.000,00 em nov e 3.000,00 em dez.
  // Sem as vencidas: out 10.000,00 -> nov 4.000,00 -> dez 1.000,00 (pior: dez, 1.000,00).
  const input = baseInput({
    openingBalanceCents: cents(1_000_000),
    fromCompetence: '2026-10',
    months: 3,
    statementsDue: [entry('2026-11', 600_000), entry('2026-12', 300_000)],
  });

  it('desconta as faturas anteriores nao pagas no mes corrente e diz se e quando fica negativo', () => {
    // Vencidas: -5.418,32 (sinal do Comprometido). Considerado: 5.418,32.
    // out: 10.000,00 - 5.418,32 = 4.581,68
    // nov: 4.581,68 - 6.000,00 = -1.418,32 -> primeiro negativo
    // dez: -1.418,32 - 3.000,00 = -4.418,32 -> pior fechamento
    expect(projectWithOverdueStatements(input, cents(-541_832))).toEqual({
      consideredCents: 541_832,
      minClosingCents: -441_832,
      minClosingCompetence: '2026-12',
      firstNegativeCompetence: '2026-11',
    });
  });

  it('a projecao principal nao muda: a entrada nao e alterada', () => {
    const before = projectCashflow(input);
    projectWithOverdueStatements(input, cents(-541_832));
    expect(projectCashflow(input)).toEqual(before);
    expect(input.statementsDue).toHaveLength(2);
    expect(before.minClosingCents).toBe(100_000);
    expect(before.firstNegativeCompetence).toBeNull();
  });

  it('sem fatura vencida: considerado zero, leitura igual a principal', () => {
    expect(projectWithOverdueStatements(input, cents(0))).toEqual({
      consideredCents: 0,
      minClosingCents: 100_000,
      minClosingCompetence: '2026-12',
      firstNegativeCompetence: null,
    });
  });

  it('saldo credor (so estorno) nao vira entrada: considerado zero', () => {
    expect(projectWithOverdueStatements(input, cents(5_000)).consideredCents).toBe(0);
    expect(projectWithOverdueStatements(input, cents(5_000)).minClosingCents).toBe(100_000);
  });

  it('empate no pior fechamento aponta o PRIMEIRO mes', () => {
    const flat = baseInput({ openingBalanceCents: cents(1_000), fromCompetence: '2026-10', months: 3 });
    // 1.000 - 400 = 600 nos tres meses.
    expect(projectWithOverdueStatements(flat, cents(-400))).toMatchObject({ minClosingCents: 600, minClosingCompetence: '2026-10' });
  });

  it('janela vazia: sem fechamento, sem mes', () => {
    expect(projectWithOverdueStatements(baseInput({ months: 0 }), cents(-100))).toEqual({
      consideredCents: 100,
      minClosingCents: null,
      minClosingCompetence: null,
      firstNegativeCompetence: null,
    });
  });
});
