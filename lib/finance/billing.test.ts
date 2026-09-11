import { describe, expect, it } from 'vitest';

import {
  billingPeriodFor,
  reconcileStatement,
  statementWindow,
} from '@/lib/finance/billing';
import { cents } from '@/lib/money';

/** Cartao comum: fecha dia 10, vence dia 20 do mesmo mes (dueDay > closingDay). */
const FECHA_10_VENCE_20 = { closingDay: 10, dueDay: 20 };

/** Cartao que vence no mes seguinte ao fechamento (dueDay <= closingDay). */
const FECHA_28_VENCE_05 = { closingDay: 28, dueDay: 5 };

describe('billingPeriodFor', () => {
  it('compra ANTES do fechamento cai na fatura corrente', () => {
    // Fecha dia 10. Compra em 05/03 <= 10/03 -> fatura de marco.
    const r = billingPeriodFor('2026-03-05', FECHA_10_VENCE_20);
    expect(r.competence).toBe('2026-03');
    expect(r.closingDate).toBe('2026-03-10');
  });

  it('compra NO dia do fechamento cai na fatura corrente', () => {
    // Limite inclusivo: 10/03 <= 10/03 -> ainda e a fatura de marco.
    const r = billingPeriodFor('2026-03-10', FECHA_10_VENCE_20);
    expect(r.competence).toBe('2026-03');
    expect(r.closingDate).toBe('2026-03-10');
  });

  it('compra UM DIA depois do fechamento cai na fatura seguinte', () => {
    // 11/03 > 10/03 -> pula para abril, que fecha em 10/04.
    const r = billingPeriodFor('2026-03-11', FECHA_10_VENCE_20);
    expect(r.competence).toBe('2026-04');
    expect(r.closingDate).toBe('2026-04-10');
  });

  it('compra depois do fechamento em dezembro cruza a virada de ano', () => {
    // 11/12/2026 > 10/12/2026 -> fatura de janeiro/2027.
    const r = billingPeriodFor('2026-12-11', FECHA_10_VENCE_20);
    expect(r.competence).toBe('2027-01');
    expect(r.closingDate).toBe('2027-01-10');
    // dueDay 20 > closingDay 10 -> vence no proprio mes do fechamento.
    expect(r.dueDate).toBe('2027-01-20');
  });

  it('fechamento dia 31 em fevereiro de ano comum usa o ultimo dia (28)', () => {
    // 2026 nao e bissexto. Fechamento 31 ancorado em fevereiro = 28/02.
    // Compra em 28/02 <= 28/02 -> fatura de fevereiro.
    const r = billingPeriodFor('2026-02-28', { closingDay: 31, dueDay: 10 });
    expect(r.competence).toBe('2026-02');
    expect(r.closingDate).toBe('2026-02-28');
  });

  it('fechamento dia 31 em fevereiro de ano bissexto usa o dia 29', () => {
    // 2024 e bissexto: o fechamento cai em 29/02, e a compra de 29/02 entra.
    const r = billingPeriodFor('2024-02-29', { closingDay: 31, dueDay: 10 });
    expect(r.competence).toBe('2024-02');
    expect(r.closingDate).toBe('2024-02-29');
  });

  it('fechamento dia 31 em mes de 30 dias usa o dia 30', () => {
    // Abril tem 30 dias: fechamento 31 -> 30/04. Compra em 30/04 entra.
    const dentro = billingPeriodFor('2026-04-30', { closingDay: 31, dueDay: 10 });
    expect(dentro.competence).toBe('2026-04');
    expect(dentro.closingDate).toBe('2026-04-30');
  });

  it('com fechamento 31, compra no dia 31 de mes de 31 dias entra no proprio mes', () => {
    // Marco tem 31 dias: fechamento = 31/03 e a compra de 31/03 e <= ele.
    const r = billingPeriodFor('2026-03-31', { closingDay: 31, dueDay: 10 });
    expect(r.competence).toBe('2026-03');
    expect(r.closingDate).toBe('2026-03-31');
  });

  it('dueDay <= closingDay joga o vencimento para o mes seguinte ao fechamento', () => {
    // Fecha 28/03, vence dia 5. Como 5 <= 28, o vencimento e 05/04.
    const r = billingPeriodFor('2026-03-20', FECHA_28_VENCE_05);
    expect(r.competence).toBe('2026-03');
    expect(r.closingDate).toBe('2026-03-28');
    expect(r.dueDate).toBe('2026-04-05');
  });

  it('dueDay > closingDay mantem o vencimento no mes do fechamento', () => {
    // Fecha 10/03, vence dia 20. Como 20 > 10, o vencimento e 20/03.
    const r = billingPeriodFor('2026-03-01', FECHA_10_VENCE_20);
    expect(r.dueDate).toBe('2026-03-20');
  });

  it('vencimento no mes seguinte cruza a virada de ano', () => {
    // Fecha 28/12/2026, vence dia 5 -> 05/01/2027.
    const r = billingPeriodFor('2026-12-01', FECHA_28_VENCE_05);
    expect(r.competence).toBe('2026-12');
    expect(r.dueDate).toBe('2027-01-05');
  });

  it('vencimento dia 31 em fevereiro tambem e ancorado no ultimo dia', () => {
    // Fecha 31/01/2026 (janeiro tem 31), vence dia 31 -> 31 <= 31, entao o
    // vencimento vai para fevereiro e ancora em 28/02 (2026 nao e bissexto).
    const r = billingPeriodFor('2026-01-15', { closingDay: 31, dueDay: 31 });
    expect(r.closingDate).toBe('2026-01-31');
    expect(r.dueDate).toBe('2026-02-28');
  });

  it('recusa dia de ciclo fora de 1-31', () => {
    expect(() => billingPeriodFor('2026-03-05', { closingDay: 0, dueDay: 10 })).toThrow(
      RangeError,
    );
    expect(() => billingPeriodFor('2026-03-05', { closingDay: 32, dueDay: 10 })).toThrow(
      RangeError,
    );
    expect(() => billingPeriodFor('2026-03-05', { closingDay: 10, dueDay: 0 })).toThrow(
      RangeError,
    );
  });

  it('recusa data que nao existe no calendario', () => {
    expect(() => billingPeriodFor('2026-02-30', FECHA_10_VENCE_20)).toThrow(RangeError);
  });
});

describe('statementWindow', () => {
  it('vai do dia seguinte ao fechamento anterior ate o fechamento', () => {
    // Fecha dia 10. Fatura de marco/2026: fechamento anterior 10/02, entao a
    // janela e 11/02 a 10/03.
    const w = statementWindow('2026-03', FECHA_10_VENCE_20);
    expect(w.from).toBe('2026-02-11');
    expect(w.to).toBe('2026-03-10');
    expect(w.closingDate).toBe('2026-03-10');
    expect(w.dueDate).toBe('2026-03-20');
  });

  it('cruza a virada de ano para tras', () => {
    // Fatura de janeiro/2027: fechamento anterior 10/12/2026 -> from 11/12/2026.
    const w = statementWindow('2027-01', FECHA_10_VENCE_20);
    expect(w.from).toBe('2026-12-11');
    expect(w.to).toBe('2027-01-10');
  });

  it('quando o fechamento anterior e o ultimo dia do mes, from e o dia 1', () => {
    // Fechamento 31 em fevereiro/2026 = 28/02, que E o ultimo dia do mes.
    // O dia seguinte e 01/03, nao "29/02".
    const w = statementWindow('2026-03', { closingDay: 31, dueDay: 10 });
    expect(w.from).toBe('2026-03-01');
    expect(w.to).toBe('2026-03-31');
  });

  it('em ano bissexto o dia seguinte a 29/02 e 01/03', () => {
    // Fechamento 31 em fevereiro/2024 = 29/02 (bissexto), ultimo dia do mes.
    const w = statementWindow('2024-03', { closingDay: 31, dueDay: 10 });
    expect(w.from).toBe('2024-03-01');
    expect(w.to).toBe('2024-03-31');
  });

  it('janela de fevereiro com fechamento 31 termina em 28/02', () => {
    // Fechamento anterior: 31/01/2026 (janeiro tem 31 dias, e o ultimo dia)
    // -> from 01/02. Fechamento de fevereiro: 28/02.
    const w = statementWindow('2026-02', { closingDay: 31, dueDay: 10 });
    expect(w.from).toBe('2026-02-01');
    expect(w.to).toBe('2026-02-28');
  });

  it('faturas consecutivas nao se sobrepoem nem deixam buraco', () => {
    // O `to` de marco e 10/03 e o `from` de abril e 11/03: dias colados.
    const marco = statementWindow('2026-03', FECHA_10_VENCE_20);
    const abril = statementWindow('2026-04', FECHA_10_VENCE_20);
    expect(marco.to).toBe('2026-03-10');
    expect(abril.from).toBe('2026-03-11');
  });

  it('e coerente com billingPeriodFor: a compra cai dentro da janela da fatura', () => {
    // Invariante do modulo: se a compra vai para a competencia C, entao
    // from(C) <= compra <= to(C). Vale nos dois lados do fechamento.
    for (const dia of ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-31']) {
      const { competence } = billingPeriodFor(dia, FECHA_10_VENCE_20);
      const w = statementWindow(competence, FECHA_10_VENCE_20);
      expect(dia >= w.from).toBe(true);
      expect(dia <= w.to).toBe(true);
    }
  });

  it('a invariante vale tambem com fechamento 31 atravessando fevereiro', () => {
    for (const dia of ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']) {
      const cfg = { closingDay: 31, dueDay: 10 };
      const { competence } = billingPeriodFor(dia, cfg);
      const w = statementWindow(competence, cfg);
      expect(dia >= w.from).toBe(true);
      expect(dia <= w.to).toBe(true);
    }
  });
});

describe('reconcileStatement', () => {
  it('soma os lancamentos e bate com o total informado', () => {
    // -1000 + -2550 + -445 = -3995 centavos (R$ 39,95 de gasto).
    const r = reconcileStatement({
      reportedTotal: cents(-3995),
      transactions: [
        { amountCents: cents(-1000) },
        { amountCents: cents(-2550) },
        { amountCents: cents(-445) },
      ],
    });
    expect(r.computedTotal).toBe(-3995);
    expect(r.differenceCents).toBe(0);
    expect(r.matches).toBe(true);
  });

  it('detecta divergencia de 1 centavo', () => {
    // Calculado -3995, informado -3994: diferenca = -3995 - (-3994) = -1.
    const r = reconcileStatement({
      reportedTotal: cents(-3994),
      transactions: [
        { amountCents: cents(-1000) },
        { amountCents: cents(-2550) },
        { amountCents: cents(-445) },
      ],
    });
    expect(r.computedTotal).toBe(-3995);
    expect(r.differenceCents).toBe(-1);
    expect(r.matches).toBe(false);
  });

  it('diferenca e computado - informado; com saida negativa, positiva = somamos MENOS gasto', () => {
    // O sentido do sinal aqui e contraintuitivo e por isso tem teste proprio:
    // como saida de dinheiro e negativa (CONVENTIONS §2), somar MAIS gasto
    // deixa o computado MENOR, e a diferenca sai NEGATIVA.

    // Somamos mais gasto do que a fatura informou:
    // calculado -3000, informado -2000 -> -3000 - (-2000) = -1000.
    const somamosMaisGasto = reconcileStatement({
      reportedTotal: cents(-2000),
      transactions: [{ amountCents: cents(-3000) }],
    });
    expect(somamosMaisGasto.differenceCents).toBe(-1000);

    // Faltou lancamento, somamos menos gasto do que a fatura informou:
    // calculado -1000, informado -2000 -> -1000 - (-2000) = +1000.
    const somamosMenosGasto = reconcileStatement({
      reportedTotal: cents(-2000),
      transactions: [{ amountCents: cents(-1000) }],
    });
    expect(somamosMenosGasto.differenceCents).toBe(1000);
  });

  it('fatura sem total informado nao tem o que conferir', () => {
    const r = reconcileStatement({
      reportedTotal: null,
      transactions: [{ amountCents: cents(-1000) }, { amountCents: cents(-500) }],
    });
    // -1000 + -500 = -1500.
    expect(r.computedTotal).toBe(-1500);
    expect(r.differenceCents).toBe(0);
    expect(r.matches).toBe(true);
  });

  it('fatura sem lancamento soma zero', () => {
    const r = reconcileStatement({ reportedTotal: cents(0), transactions: [] });
    expect(r.computedTotal).toBe(0);
    expect(r.differenceCents).toBe(0);
    expect(r.matches).toBe(true);
  });

  it('fatura vazia com total informado diferente de zero e divergencia', () => {
    // Calculado 0, informado -1000: 0 - (-1000) = 1000.
    const r = reconcileStatement({ reportedTotal: cents(-1000), transactions: [] });
    expect(r.differenceCents).toBe(1000);
    expect(r.matches).toBe(false);
  });

  it('estorno positivo no meio dos gastos entra na soma com o proprio sinal', () => {
    // -5000 + 1200 (estorno) + -300 = -4100.
    const r = reconcileStatement({
      reportedTotal: cents(-4100),
      transactions: [
        { amountCents: cents(-5000) },
        { amountCents: cents(1200) },
        { amountCents: cents(-300) },
      ],
    });
    expect(r.computedTotal).toBe(-4100);
    expect(r.matches).toBe(true);
  });
});
