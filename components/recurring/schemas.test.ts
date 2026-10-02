/**
 * Fronteira do formulário de despesas fixas e receitas (T-204).
 *
 * O schema do servidor (`app/api/recurring/schemas.ts` e `app/api/incomes/schemas.ts`)
 * já cobre as regras de domínio — XOR conta/cartão, one_off sem competência,
 * endsOn < startsOn, etc. O schema do FORMULÁRIO tem DUAS peculiaridades que
 * não existem no servidor e valem teste aqui:
 *
 *  1. `dueDay` e `receiveDay` chegam como **string** do DOM (input type="number"
 *     devolve string). Validamos o formato `\d{1,2}` no nível de string antes
 *     da conversão para number — falha cedo, mensagem em pt-BR.
 *  2. `annualAdjustmentPercent` aceita **string vazia** como "sem reajuste", além
 *     de percentual ("5", "4,5"). O servidor recebe basis points já convertidos
 *     (`parseAdjustmentPercent`); aqui ainda é texto do input.
 *
 * Não duplico as superRefine do servidor: a lógica é a mesma, os testes do
 * servidor já a guardam.
 */

import { describe, expect, it } from 'vitest';

import {
  IncomeFormSchema,
  RecurringExpenseFormSchema,
} from './schemas';

const validExpense = {
  description: 'Aluguel',
  amountInput: 'R$ 1.500,00',
  categoryId: '11111111-1111-4111-8111-111111111111',
  dueDay: '5',
  frequency: 'monthly' as const,
  accountId: '22222222-2222-4222-8222-222222222222',
  creditCardId: null,
  startsOn: '2026-09-10',
  endsOn: null,
  annualAdjustmentPercent: '',
};

const validIncome = {
  description: 'Salário',
  amountInput: 'R$ 5.000,00',
  kind: 'salary' as const,
  memberId: '11111111-1111-4111-8111-111111111111',
  receiveDay: '5',
  frequency: 'monthly' as const,
  oneOffCompetence: null,
  startsOn: '2026-09-10',
  endsOn: null,
};

describe('RecurringExpenseFormSchema — particularidades do form (string vs number)', () => {
  it('rejeita dueDay não-numérico (servidor receberia number)', () => {
    const result = RecurringExpenseFormSchema.safeParse({
      ...validExpense,
      dueDay: 'ab',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita dueDay com mais de 2 dígitos', () => {
    const result = RecurringExpenseFormSchema.safeParse({
      ...validExpense,
      dueDay: '123',
    });
    expect(result.success).toBe(false);
  });

  it('aceita dueDay "5" e "31" (boundary)', () => {
    expect(
      RecurringExpenseFormSchema.safeParse({ ...validExpense, dueDay: '5' }).success,
    ).toBe(true);
    expect(
      RecurringExpenseFormSchema.safeParse({ ...validExpense, dueDay: '31' }).success,
    ).toBe(true);
  });

  it('annualAdjustmentPercent aceita string vazia (= "sem reajuste")', () => {
    const result = RecurringExpenseFormSchema.safeParse({
      ...validExpense,
      annualAdjustmentPercent: '',
    });
    expect(result.success).toBe(true);
  });

  it('annualAdjustmentPercent aceita percentual ("5" e "4,5")', () => {
    for (const annualAdjustmentPercent of ['5', '4,5']) {
      const result = RecurringExpenseFormSchema.safeParse({
        ...validExpense,
        annualAdjustmentPercent,
      });
      expect(result.success).toBe(true);
    }
  });

  it('annualAdjustmentPercent rejeita texto não-numérico', () => {
    const result = RecurringExpenseFormSchema.safeParse({
      ...validExpense,
      annualAdjustmentPercent: 'cinco',
    });
    expect(result.success).toBe(false);
  });
});

describe('IncomeFormSchema — particularidades do form (string vs number)', () => {
  it('rejeita receiveDay não-numérico', () => {
    const result = IncomeFormSchema.safeParse({
      ...validIncome,
      receiveDay: 'xy',
    });
    expect(result.success).toBe(false);
  });

  it('oneOffCompetence desabilitado pelo frequencySelectSchema (servidor)', () => {
    // A regra "competência só se aplica a one_off" é a mesma do servidor.
    // Verificamos só que o form tem a mesma coerência — o teste detalhado
    // já existe em app/api/incomes/schemas.test.ts.
    const result = IncomeFormSchema.safeParse({
      ...validIncome,
      frequency: 'monthly',
      oneOffCompetence: '2026-09',
    });
    expect(result.success).toBe(false);
  });
});
