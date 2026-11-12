import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { recurringExpenseBodySchema } from '@/app/api/recurring/schemas';
import { cents, parseBRL } from '@/lib/money';

import { IncomeFormSchema, RecurringExpenseFormSchema } from './schemas';
import {
  evidenceMonthsText,
  expenseFormFromSuggestion,
  incomeFormFromSuggestion,
  suggestedStartsOn,
  visibleSuggestions,
  type RecurrenceSuggestion,
} from './suggestions';

const LEAF = '11111111-1111-4111-8111-111111111111';
const OTHER_LEAF = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const CARD = '44444444-4444-4444-8444-444444444444';
const MEMBER = '55555555-5555-4555-8555-555555555555';
const GONE = '66666666-6666-4666-8666-666666666666';

const expenseOptions = {
  categories: [{ id: 'root', name: 'Casa', leaves: [{ id: OTHER_LEAF, name: 'Internet' }, { id: LEAF, name: 'Assinaturas' }] }],
  accounts: [{ id: ACCOUNT, name: 'Conta' }],
  cards: [{ id: CARD, name: 'Cartão' }],
};
const incomeOptions = { members: [{ id: MEMBER, name: 'Ricardo' }], accounts: [{ id: ACCOUNT, name: 'Conta' }] };

function suggestion(overrides: Partial<RecurrenceSuggestion> = {}): RecurrenceSuggestion {
  return {
    key: 'expense|netflix.com|3990',
    kind: 'expense',
    description: 'NETFLIX.COM',
    medianCents: cents(-3_990),
    suggestedDay: 27,
    categoryId: LEAF,
    accountId: null,
    creditCardId: CARD,
    memberId: null,
    months: ['2026-09', '2026-10'],
    ...overrides,
  };
}

describe('evidenceMonthsText', () => {
  it('lista os meses em pt-BR com "e" no fim', () => {
    expect(evidenceMonthsText(['2026-09', '2026-10', '2026-11'])).toBe('set, out e nov');
    expect(evidenceMonthsText(['2026-10', '2026-11'])).toBe('out e nov');
    expect(evidenceMonthsText(['2026-11'])).toBe('nov');
    expect(evidenceMonthsText([])).toBe('');
  });

  it('atravessando o ano, cada mês leva o ano', () => {
    expect(evidenceMonthsText(['2026-12', '2027-01'])).toBe('dez/2026 e jan/2027');
  });
});

describe('suggestedStartsOn', () => {
  it('ainda não apareceu neste mês: começa hoje', () => {
    expect(suggestedStartsOn({ months: ['2026-09', '2026-10'] }, '2026-11-10')).toBe('2026-11-10');
  });

  it('já apareceu neste mês: começa no dia 1 do mês que vem, para não prever o que já foi lançado', () => {
    expect(suggestedStartsOn({ months: ['2026-10', '2026-11'] }, '2026-11-26')).toBe('2026-12-01');
    // Vira o ano.
    expect(suggestedStartsOn({ months: ['2026-11', '2026-12'] }, '2026-12-31')).toBe('2027-01-01');
  });
});

describe('expenseFormFromSuggestion', () => {
  it('preenche o formulário de despesa fixa, e ele passa na validação da tela e no corpo da rota', () => {
    const form = expenseFormFromSuggestion(suggestion(), expenseOptions, '2026-11-10');
    expect(form).toEqual({
      description: 'NETFLIX.COM',
      amountInput: '39,90',
      categoryId: LEAF,
      dueDay: '27',
      frequency: 'monthly',
      accountId: null,
      creditCardId: CARD,
      startsOn: '2026-11-10',
      endsOn: null,
      annualAdjustmentPercent: '',
    });
    expect(RecurringExpenseFormSchema.safeParse(form).success).toBe(true);
    // O corpo que a tela monta a partir do formulário (mesmo cálculo de `submitExpense`).
    const typed = parseBRL(form.amountInput);
    expect(typed).toBe(3_990);
    const body = {
      description: form.description,
      expectedCents: -Math.abs(typed ?? 0),
      categoryId: form.categoryId,
      dueDay: Number(form.dueDay),
      frequency: form.frequency,
      accountId: form.accountId,
      creditCardId: form.creditCardId,
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      annualAdjustmentBp: null,
    };
    expect(recurringExpenseBodySchema.safeParse(JSON.parse(JSON.stringify(body))).success).toBe(true);
  });

  it('categoria que o seletor não oferece (ou ausente) cai na primeira oferecida', () => {
    expect(expenseFormFromSuggestion(suggestion({ categoryId: null }), expenseOptions, '2026-11-10').categoryId).toBe(OTHER_LEAF);
    expect(expenseFormFromSuggestion(suggestion({ categoryId: GONE }), expenseOptions, '2026-11-10').categoryId).toBe(OTHER_LEAF);
  });

  it('destino: cartão ativo; conta ativa; e a primeira conta quando o do histórico foi desativado', () => {
    const onAccount = expenseFormFromSuggestion(suggestion({ creditCardId: null, accountId: ACCOUNT }), expenseOptions, '2026-11-10');
    expect([onAccount.accountId, onAccount.creditCardId]).toEqual([ACCOUNT, null]);
    const goneCard = expenseFormFromSuggestion(suggestion({ creditCardId: GONE }), expenseOptions, '2026-11-10');
    expect([goneCard.accountId, goneCard.creditCardId]).toEqual([ACCOUNT, null]);
    const nothing = expenseFormFromSuggestion(suggestion({ creditCardId: GONE }), { ...expenseOptions, accounts: [] }, '2026-11-10');
    expect([nothing.accountId, nothing.creditCardId]).toEqual([null, null]);
    // Sem destino o formulário não passa: a pessoa precisa escolher, nada é gravado por omissão.
    expect(RecurringExpenseFormSchema.safeParse(nothing).success).toBe(false);
  });
});

describe('incomeFormFromSuggestion', () => {
  const income = suggestion({
    key: 'income|salario|820000',
    kind: 'income',
    description: 'PAGTO SALARIO',
    medianCents: cents(820_000),
    suggestedDay: 6,
    categoryId: null,
    accountId: ACCOUNT,
    creditCardId: null,
    memberId: MEMBER,
    months: ['2026-10', '2026-11'],
  });

  it('preenche o formulário de receita e ele passa na validação da tela', () => {
    const form = incomeFormFromSuggestion(income, incomeOptions, '2026-11-20');
    expect(form).toEqual({
      description: 'PAGTO SALARIO',
      amountInput: '8.200,00',
      kind: 'other',
      memberId: MEMBER,
      accountId: ACCOUNT,
      receiveDay: '6',
      frequency: 'monthly',
      oneOffCompetence: null,
      startsOn: '2026-12-01',
      endsOn: null,
    });
    expect(IncomeFormSchema.safeParse(form).success).toBe(true);
    expect(parseBRL(form.amountInput)).toBe(820_000);
  });

  it('responsável ou conta que sumiram caem nos primeiros; sem opção nenhuma o formulário não passa', () => {
    const form = incomeFormFromSuggestion({ ...income, memberId: null, accountId: GONE }, incomeOptions, '2026-11-20');
    expect([form.memberId, form.accountId]).toEqual([MEMBER, ACCOUNT]);
    const empty = incomeFormFromSuggestion(income, { members: [], accounts: [] }, '2026-11-20');
    expect(IncomeFormSchema.safeParse(empty).success).toBe(false);
  });
});

describe('visibleSuggestions', () => {
  it('tira as ignoradas e as cadastradas nesta sessão', () => {
    const a = suggestion({ key: 'a' });
    const b = suggestion({ key: 'b' });
    expect(visibleSuggestions([a, b], [])).toEqual([a, b]);
    expect(visibleSuggestions([a, b], ['a'])).toEqual([b]);
    expect(visibleSuggestions([a, b], ['a', 'b'])).toEqual([]);
  });
});

describe('o motor de sugestões não entra no navegador', () => {
  it('a tela e os helpers só importam o TIPO de lib/finance/recurrence-suggestions (o módulo puxa node:crypto)', () => {
    for (const file of ['recurring-screen.tsx', 'suggestions.ts', 'recurring-form.ts', 'schemas.ts']) {
      const source = readFileSync(join(process.cwd(), 'components/recurring', file), 'utf8');
      const imports = source.match(/^import[^;]*from '@\/lib\/finance\/(recurrence-suggestions|categorization|dedupe)';/gm) ?? [];
      for (const line of imports) expect(line, `${file}: ${line}`).toMatch(/^import type /);
    }
  });
});
