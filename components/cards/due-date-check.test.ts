import { describe, expect, it } from 'vitest';

import { dueDateWarnings, type CheckedStatement } from './due-date-check';

const statement = (overrides: Partial<CheckedStatement> = {}): CheckedStatement => ({
  id: 'a',
  period: '2026-09',
  dueDate: '2026-09-10',
  status: 'open',
  ...overrides,
});

describe('aviso de vencimento que não bate com o ciclo atual do cartão', () => {
  // Caso real: o Santander mudou o vencimento do dia 10 para o dia 7 (fecha dia 1).
  const santander = { closingDay: 1, dueDay: 7 };

  it('fatura de setembro aberta com vencimento 10/09 e cartão vencendo dia 7: avisa, com as duas datas', () => {
    const warnings = dueDateWarnings([statement()], santander);
    expect(warnings).toEqual([
      {
        statementId: 'a',
        period: '2026-09',
        storedDueDate: '2026-09-10',
        expectedDueDate: '2026-09-07',
        message:
          'O vencimento gravado desta fatura (10/09/2026) não bate com o ciclo atual do cartão (vence dia 7, o que daria 07/09/2026). Nada foi alterado: confira a data na fatura.',
      },
    ]);
  });

  it('vencimento que bate com o ciclo não gera aviso', () => {
    expect(dueDateWarnings([statement({ dueDate: '2026-09-07' })], santander)).toEqual([]);
  });

  it('só avisa fatura EM ABERTO: fechada e paga são história, e o ciclo antigo era o certo', () => {
    expect(dueDateWarnings([statement({ status: 'closed' })], santander)).toEqual([]);
    expect(dueDateWarnings([statement({ status: 'paid' })], santander)).toEqual([]);
  });

  it('avisa só as abertas que divergem, mantendo a ordem recebida', () => {
    const warnings = dueDateWarnings(
      [
        statement({ id: 'ok', period: '2026-10', dueDate: '2026-10-07' }),
        statement({ id: 'velha', period: '2026-08', dueDate: '2026-08-10', status: 'paid' }),
        statement({ id: 'divergente', period: '2026-09', dueDate: '2026-09-10' }),
      ],
      santander,
    );
    expect(warnings.map((warning) => warning.statementId)).toEqual(['divergente']);
  });

  it('vencimento no mês seguinte ao fechamento (fecha 28, vence 5) é lido pelo motor de faturas', () => {
    // dueDay <= closingDay: vence no mês seguinte ao fechamento (CONTRACTS §3).
    const cycle = { closingDay: 28, dueDay: 5 };
    expect(dueDateWarnings([statement({ period: '2026-09', dueDate: '2026-10-05' })], cycle)).toEqual([]);
    const warnings = dueDateWarnings([statement({ period: '2026-09', dueDate: '2026-10-10' })], cycle);
    expect(warnings[0]?.expectedDueDate).toBe('2026-10-05');
    expect(warnings[0]?.message).toContain('vence dia 5');
  });

  it('dia 31 em mês curto: o motor ancora no último dia, e isso não é divergência', () => {
    const cycle = { closingDay: 15, dueDay: 31 };
    expect(dueDateWarnings([statement({ period: '2026-02', dueDate: '2026-02-28' })], cycle)).toEqual([]);
  });

  it('ciclo inválido (dia fora de 1 a 31) não lança: sem base de comparação, sem aviso', () => {
    expect(dueDateWarnings([statement()], { closingDay: 0, dueDay: 40 })).toEqual([]);
  });

  it('sem faturas: nada', () => {
    expect(dueDateWarnings([], santander)).toEqual([]);
  });

  it('não altera a entrada', () => {
    const input = [statement()];
    dueDateWarnings(input, santander);
    expect(input).toEqual([statement()]);
  });
});
