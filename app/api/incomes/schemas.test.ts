/**
 * Fronteira `/api/incomes`. O que passa aqui vira linha em `incomes`.
 * Cobertura explícita do caso válido e das três regras do `superRefine`
 * (regra `one_off`, regra de `startsOn` obrigatório, regra de `endsOn <
 * startsOn`) — qualquer mudança silenciosa nelas acende vermelho.
 */

import { describe, expect, it } from 'vitest';

import { incomeBodySchema } from './schemas';

const validRecurringIncome = {
  description: 'Salário',
  kind: 'salary' as const,
  expectedCents: 500000,
  memberId: '11111111-1111-4111-8111-111111111111',
  receiveDay: 5,
  frequency: 'monthly' as const,
  oneOffCompetence: null,
  startsOn: '2026-09-10',
  endsOn: null,
};

const validOneOffIncome = {
  description: '13º Salário',
  kind: 'salary' as const,
  expectedCents: 500000,
  memberId: '11111111-1111-4111-8111-111111111111',
  receiveDay: 5,
  frequency: 'one_off' as const,
  oneOffCompetence: '2026-12',
  startsOn: null,
  endsOn: null,
};

describe('incomeBodySchema — caso válido', () => {
  it('aceita recorrência mensal com startsOn e sem competência fixa', () => {
    const result = incomeBodySchema.safeParse(validRecurringIncome);
    expect(result.success).toBe(true);
  });

  it('aceita receita eventual com competência fixa (13º)', () => {
    const result = incomeBodySchema.safeParse(validOneOffIncome);
    expect(result.success).toBe(true);
  });

  it('aceita todas as frequências declaradas', () => {
    for (const frequency of [
      'monthly',
      'bimonthly',
      'quarterly',
      'semiannual',
      'annual',
      'one_off',
    ] as const) {
      const base = frequency === 'one_off' ? validOneOffIncome : validRecurringIncome;
      const result = incomeBodySchema.safeParse({ ...base, frequency });
      expect(result.success, `frequency=${frequency}`).toBe(true);
    }
  });
});

describe('incomeBodySchema — expectedCents', () => {
  it('rejeita valor zero', () => {
    const result = incomeBodySchema.safeParse({ ...validRecurringIncome, expectedCents: 0 });
    expect(result.success).toBe(false);
  });

  it('rejeita valor negativo (receita é entrada, não saída)', () => {
    const result = incomeBodySchema.safeParse({
      ...validRecurringIncome,
      expectedCents: -1000,
    });
    expect(result.success).toBe(false);
  });
});

describe('incomeBodySchema — frequency=one_off', () => {
  it('rejeita one_off sem competência fixa', () => {
    const result = incomeBodySchema.safeParse({
      ...validOneOffIncome,
      oneOffCompetence: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita one_off com competência em formato errado', () => {
    const result = incomeBodySchema.safeParse({
      ...validOneOffIncome,
      oneOffCompetence: '2026/12',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita one_off com mês 13 ou 00', () => {
    expect(
      incomeBodySchema.safeParse({
        ...validOneOffIncome,
        oneOffCompetence: '2026-13',
      }).success,
    ).toBe(false);
    expect(
      incomeBodySchema.safeParse({
        ...validOneOffIncome,
        oneOffCompetence: '2026-00',
      }).success,
    ).toBe(false);
  });
});

describe('incomeBodySchema — frequência ≠ one_off', () => {
  it('rejeita recorrência com competência fixa (regra exclusiva de one_off)', () => {
    const result = incomeBodySchema.safeParse({
      ...validRecurringIncome,
      oneOffCompetence: '2026-09',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita recorrência sem data de início', () => {
    const result = incomeBodySchema.safeParse({
      ...validRecurringIncome,
      startsOn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita endsOn anterior a startsOn', () => {
    const result = incomeBodySchema.safeParse({
      ...validRecurringIncome,
      startsOn: '2026-09-10',
      endsOn: '2026-09-09',
    });
    expect(result.success).toBe(false);
  });

  it('aceita endsOn igual a startsOn (não é "<")', () => {
    const result = incomeBodySchema.safeParse({
      ...validRecurringIncome,
      startsOn: '2026-09-10',
      endsOn: '2026-09-10',
    });
    expect(result.success).toBe(true);
  });
});

describe('incomeBodySchema — receiveDay', () => {
  it('rejeita receiveDay 0 e 32 (mesma regra do dueDay de despesa)', () => {
    expect(incomeBodySchema.safeParse({ ...validRecurringIncome, receiveDay: 0 }).success).toBe(
      false,
    );
    expect(incomeBodySchema.safeParse({ ...validRecurringIncome, receiveDay: 32 }).success).toBe(
      false,
    );
  });
});
