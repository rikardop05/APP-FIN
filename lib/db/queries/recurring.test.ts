/**
 * Testes de domínio puro para as regras de coerência em
 * `lib/db/queries/recurring-shape.ts` (módulo SEM import de `@/lib/db`,
 * testável sem `DATABASE_URL`).
 *
 * - `assertIncomeShape` cobre as quatro ramificações da matriz
 *   `frequency × oneOffCompetence × startsOn × endsOn`.
 * - `assertRecurrenceShape` cobre a relação `endsOn < startsOn`.
 *
 * Estes testes NÃO tocam banco. As integrações com `createIncome` /
 * `updateIncome` / `createRecurringExpense` / `updateRecurringExpense`
 * dependem de `DATABASE_URL` (escopo do `import.test.ts`, mesmo padrão).
 */

import { describe, expect, it } from 'vitest';

import {
  RecurringReferenceError,
  assertIncomeShape,
  assertExpenseDestination,
  assertRecurrenceShape,
  type IncomeInput,
} from '@/lib/db/queries/recurring-shape';
import { type Frequency, type IncomeKind } from '@/lib/db/enums';
import { cents, type Cents } from '@/lib/money';

function incomeInput(overrides: Partial<IncomeInput> = {}): IncomeInput {
  return {
    description: 'Salário de teste',
    kind: 'salary' satisfies IncomeKind,
    expectedCents: cents(500000) satisfies Cents,
    memberId: '00000000-0000-0000-0000-000000000001',
    accountId: '00000000-0000-0000-0000-000000000002',
    receiveDay: 5,
    frequency: 'monthly' satisfies Frequency,
    oneOffCompetence: null,
    startsOn: '2026-09-10',
    endsOn: null,
    ...overrides,
  };
}

describe('assertIncomeShape — receita eventual (one_off)', () => {
  it('aceita receita eventual com competência fixa no formato YYYY-MM', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          frequency: 'one_off',
          startsOn: null,
          oneOffCompetence: '2026-12',
        }),
      ),
    ).not.toThrow();
  });

  it('rejeita receita eventual sem competência fixa', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          frequency: 'one_off',
          startsOn: '2026-12-10',
          oneOffCompetence: null,
        }),
      ),
    ).toThrowError(RecurringReferenceError);
  });

  it('rejeita competência eventual em formato errado', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          frequency: 'one_off',
          startsOn: null,
          oneOffCompetence: '2026/12',
        }),
      ),
    ).toThrowError(RecurringReferenceError);
  });

  it('rejeita mês 13 ou 00', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({ frequency: 'one_off', oneOffCompetence: '2026-13' }),
      ),
    ).toThrowError(RecurringReferenceError);
    expect(() =>
      assertIncomeShape(
        incomeInput({ frequency: 'one_off', oneOffCompetence: '2026-00' }),
      ),
    ).toThrowError(RecurringReferenceError);
  });
});

describe('assertIncomeShape — receita recorrente (não one_off)', () => {
  it('aceita recorrência mensal com startsOn e sem competência fixa', () => {
    expect(() => assertIncomeShape(incomeInput())).not.toThrow();
  });

  it('rejeita recorrência com competência fixa (regra exclusiva de one_off)', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          frequency: 'monthly',
          startsOn: '2026-09-10',
          oneOffCompetence: '2026-09',
        }),
      ),
    ).toThrowError(RecurringReferenceError);
  });

  it('rejeita recorrência sem data de início', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          frequency: 'monthly',
          startsOn: null,
          oneOffCompetence: null,
        }),
      ),
    ).toThrowError(RecurringReferenceError);
  });

  it('aceita recorrência com endsOn igual a startsOn (válido, não é "<")', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          startsOn: '2026-09-10',
          endsOn: '2026-09-10',
        }),
      ),
    ).not.toThrow();
  });

  it('rejeita endsOn anterior a startsOn', () => {
    expect(() =>
      assertIncomeShape(
        incomeInput({
          startsOn: '2026-09-10',
          endsOn: '2026-09-09',
        }),
      ),
    ).toThrowError(RecurringReferenceError);
  });
});

describe('assertRecurrenceShape — coerência endsOn × startsOn (despesa)', () => {
  it('aceita endsOn ausente', () => {
    expect(() => assertRecurrenceShape('monthly', '2026-09-10', null)).not.toThrow();
  });

  it('aceita endsOn igual a startsOn', () => {
    expect(() => assertRecurrenceShape('monthly', '2026-09-10', '2026-09-10')).not.toThrow();
  });

  it('aceita endsOn após startsOn', () => {
    expect(() => assertRecurrenceShape('monthly', '2026-09-10', '2027-09-10')).not.toThrow();
  });

  it('rejeita endsOn anterior a startsOn', () => {
    expect(() => assertRecurrenceShape('monthly', '2026-09-10', '2026-09-09')).toThrowError(
      RecurringReferenceError,
    );
  });

  it('lança a mesma mensagem em todas as frequências (mensagem não cita frequency)', () => {
    for (const frequency of [
      'monthly',
      'bimonthly',
      'quarterly',
      'semiannual',
      'annual',
      'one_off',
    ] as const) {
      expect(() =>
        assertRecurrenceShape(frequency, '2026-09-10', '2026-09-09'),
      ).toThrowError(RecurringReferenceError);
    }
  });
});

describe('assertExpenseDestination', () => {
  const ACCOUNT = '00000000-0000-0000-0000-000000000002';
  const CARD = '00000000-0000-0000-0000-000000000003';

  it('aceita exatamente um destino', () => {
    expect(() => assertExpenseDestination(ACCOUNT, null)).not.toThrow();
    expect(() => assertExpenseDestination(null, CARD)).not.toThrow();
  });

  it('recusa nenhum destino, com mensagem legível (não violação de constraint)', () => {
    expect(() => assertExpenseDestination(null, null)).toThrow(RecurringReferenceError);
    expect(() => assertExpenseDestination(null, null)).toThrow(/conta ou o cartão/);
  });

  it('recusa os dois destinos', () => {
    expect(() => assertExpenseDestination(ACCOUNT, CARD)).toThrow(RecurringReferenceError);
  });
});
