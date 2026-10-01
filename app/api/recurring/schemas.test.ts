/**
 * Fronteira `/api/recurring`. O que passa aqui vira linha no banco do Ricardo.
 * Os testes cobrem o caso válido e cada `superRefine` para que uma mudança
 * silenciosa em uma regra aqui não chegue à produção sem acender vermelho.
 */

import { describe, expect, it } from 'vitest';

import { recurringExpenseBodySchema } from './schemas';

const validExpense = {
  description: 'Aluguel',
  expectedCents: -150000,
  categoryId: '11111111-1111-4111-8111-111111111111',
  dueDay: 5,
  frequency: 'monthly' as const,
  accountId: '22222222-2222-4222-8222-222222222222',
  creditCardId: null,
  startsOn: '2026-09-10',
  endsOn: null,
  annualAdjustmentBp: null,
};

describe('recurringExpenseBodySchema — caso válido', () => {
  it('aceita o payload completo com conta', () => {
    const result = recurringExpenseBodySchema.safeParse(validExpense);
    expect(result.success).toBe(true);
  });

  it('aceita o payload com cartão (em vez de conta)', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      accountId: null,
      creditCardId: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(true);
  });

  it('aceita endsOn nulo', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      endsOn: null,
    });
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
      const result = recurringExpenseBodySchema.safeParse({ ...validExpense, frequency });
      expect(result.success, `frequency=${frequency}`).toBe(true);
    }
  });
});

describe('recurringExpenseBodySchema — dueDay', () => {
  it('rejeita dueDay 0', () => {
    const result = recurringExpenseBodySchema.safeParse({ ...validExpense, dueDay: 0 });
    expect(result.success).toBe(false);
  });

  it('rejeita dueDay 32', () => {
    const result = recurringExpenseBodySchema.safeParse({ ...validExpense, dueDay: 32 });
    expect(result.success).toBe(false);
  });

  it('rejeita dueDay não-inteiro', () => {
    const result = recurringExpenseBodySchema.safeParse({ ...validExpense, dueDay: 5.5 });
    expect(result.success).toBe(false);
  });
});

describe('recurringExpenseBodySchema — expectedCents', () => {
  it('rejeita expectedCents zero', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      expectedCents: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita expectedCents positivo (loud — DATA-MODEL §2 diz saída é negativa)', () => {
    // Caso do bug que pegou o Ricardo: a tela enviava positivo em algum
    // caminho e o motor estourava depois em `projectCashflow`. A defesa é
    // recusar aqui, alto, no boundary — silent normalization mascararia o
    // bug do chamador, que é o mesmo padrão do G-07.
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      expectedCents: 5000,
    });
    expect(result.success).toBe(false);
  });
});

describe('recurringExpenseBodySchema — accountId XOR creditCardId', () => {
  it('rejeita conta E cartão preenchidos', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      accountId: '22222222-2222-4222-8222-222222222222',
      creditCardId: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita sem conta e sem cartão (exatamente um destino, decisão 2 de 2026-09-30)', () => {
    // Antes aceitava: o CHECK de `transactions` (conta XOR cartão) faria a
    // gravação da previsão falhar dois passos depois, vazando constraint.
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      accountId: null,
      creditCardId: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Informe a conta ou o cartão de onde a despesa sai.',
      );
    }
  });
});

describe('recurringExpenseBodySchema — endsOn × startsOn', () => {
  it('rejeita endsOn anterior a startsOn', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      startsOn: '2026-09-10',
      endsOn: '2026-09-09',
    });
    expect(result.success).toBe(false);
  });

  it('aceita endsOn igual a startsOn', () => {
    const result = recurringExpenseBodySchema.safeParse({
      ...validExpense,
      startsOn: '2026-09-10',
      endsOn: '2026-09-10',
    });
    expect(result.success).toBe(true);
  });
});
