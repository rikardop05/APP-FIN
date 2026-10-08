import { describe, expect, it } from 'vitest';

import { dueDateWarnings, type CheckedStatement } from './due-date-check';

const statement = (overrides: Partial<CheckedStatement> = {}): CheckedStatement => ({
  id: 'a',
  period: '2026-09',
  dueDate: '2026-09-10',
  ...overrides,
});

describe('aviso de vencimento que não bate com o ciclo atual do cartão', () => {
  // Caso real: o Santander mudou o vencimento do dia 10 para o dia 7 (fecha dia 1).
  const santander = { closingDay: 1, dueDay: 7 };

  it('fatura de setembro com vencimento gravado 10/09, antes de vencer: avisa, com as duas datas completas', () => {
    const warnings = dueDateWarnings([statement()], santander, '2026-09-03');
    expect(warnings).toEqual([
      {
        statementId: 'a',
        period: '2026-09',
        storedDueDate: '2026-09-10',
        expectedDueDate: '2026-09-07',
        message:
          'A fatura de setembro de 2026 está gravada com vencimento em 10/09/2026, mas o ciclo atual do cartão daria 07/09/2026. Nada foi alterado: confira a data na fatura.',
      },
    ]);
  });

  it('vencimento que bate com o ciclo não gera aviso', () => {
    expect(dueDateWarnings([statement({ dueDate: '2026-09-07' })], santander, '2026-09-03')).toEqual([]);
  });

  it('o aviso vale até o dia do vencimento gravado, inclusive; depois disso a fatura é história e some', () => {
    const input = [statement()];
    expect(dueDateWarnings(input, santander, '2026-09-10')).toHaveLength(1);
    expect(dueDateWarnings(input, santander, '2026-09-11')).toEqual([]);
    // Fatura antiga, paga há meses (o app nunca tira `status` de aberta): sem aviso.
    expect(dueDateWarnings(input, santander, '2026-12-01')).toEqual([]);
  });

  it('avisa só as que divergem e ainda não venceram, mantendo a ordem recebida', () => {
    const warnings = dueDateWarnings(
      [
        statement({ id: 'ok', period: '2026-10', dueDate: '2026-10-07' }),
        statement({ id: 'velha', period: '2026-08', dueDate: '2026-08-10' }),
        statement({ id: 'divergente', period: '2026-09', dueDate: '2026-09-10' }),
      ],
      santander,
      '2026-09-03',
    );
    expect(warnings.map((warning) => warning.statementId)).toEqual(['divergente']);
  });

  it('só o fechamento mudou e o esperado cai no mês seguinte: mostra as duas datas, sem "vence dia"', () => {
    // fecha 28, vence 5: dueDay <= closingDay, então vence no mês seguinte ao fechamento (CONTRACTS §3).
    const cycle = { closingDay: 28, dueDay: 5 };
    expect(dueDateWarnings([statement({ period: '2026-09', dueDate: '2026-10-05' })], cycle, '2026-09-20')).toEqual([]);
    const warnings = dueDateWarnings([statement({ period: '2026-09', dueDate: '2026-09-10' })], cycle, '2026-09-03');
    expect(warnings[0]?.expectedDueDate).toBe('2026-10-05');
    expect(warnings[0]?.message).toBe(
      'A fatura de setembro de 2026 está gravada com vencimento em 10/09/2026, mas o ciclo atual do cartão daria 05/10/2026. Nada foi alterado: confira a data na fatura.',
    );
    expect(warnings[0]?.message).not.toContain('vence dia');
  });

  it('virada de ano: fecha 28, vence 5, competência 2026-12 vence em 05/01/2027', () => {
    const cycle = { closingDay: 28, dueDay: 5 };
    expect(dueDateWarnings([statement({ period: '2026-12', dueDate: '2027-01-05' })], cycle, '2026-12-20')).toEqual([]);
    const warnings = dueDateWarnings([statement({ period: '2026-12', dueDate: '2027-01-10' })], cycle, '2026-12-20');
    expect(warnings[0]?.expectedDueDate).toBe('2027-01-05');
    expect(warnings[0]?.message).toContain('dezembro de 2026');
    expect(warnings[0]?.message).toContain('05/01/2027');
  });

  it('dia 31 em mês curto: o motor ancora no último dia, e isso não é divergência', () => {
    const cycle = { closingDay: 15, dueDay: 31 };
    expect(dueDateWarnings([statement({ period: '2026-02', dueDate: '2026-02-28' })], cycle, '2026-02-10')).toEqual([]);
  });

  it('ciclo inválido (dia fora de 1 a 31) não lança: sem base de comparação, sem aviso', () => {
    expect(dueDateWarnings([statement()], { closingDay: 0, dueDay: 40 }, '2026-09-03')).toEqual([]);
  });

  it('sem faturas: nada; e não altera a entrada', () => {
    expect(dueDateWarnings([], santander, '2026-09-03')).toEqual([]);
    const input = [statement()];
    dueDateWarnings(input, santander, '2026-09-03');
    expect(input).toEqual([statement()]);
  });
});
