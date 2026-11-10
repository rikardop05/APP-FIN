import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDITABLE_TRANSACTION_KINDS } from '@/lib/db/queries/transactions-editable-kinds';
import { categoryFitsKind } from '@/lib/finance/categorization';
import { buildEditValues, categoryAfterKindChange, directionChange, natureFitsKind, readEditableKind, showsKindField } from './edit-values';
import { amountOnKindChange } from './manual-sign';

const SALARY = '11111111-1111-4111-8111-111111111111';
const MARKET = '22222222-2222-4222-8222-222222222222';
const INVEST = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const categories = [
  { id: SALARY, nature: 'income' as const },
  { id: MARKET, nature: 'essential' as const },
  { id: INVEST, nature: 'investment' as const },
];

const fields = {
  occurredOn: '2026-11-03',
  description: '  Nu turbo  ',
  categoryId: '',
  memberId: '',
};

describe('showsKindField', () => {
  it('só lançamento de conta, já lançado, de tipo editável', () => {
    expect(showsKindField({ accountId: ACCOUNT, status: 'posted', kind: 'income' })).toBe(true);
    expect(showsKindField({ accountId: ACCOUNT, status: 'posted', kind: 'transfer' })).toBe(true);
    // Cartão: o tipo vem da fatura.
    expect(showsKindField({ accountId: null, status: 'posted', kind: 'expense' })).toBe(false);
    // Previsão: é regenerada com o tipo da regra.
    expect(showsKindField({ accountId: ACCOUNT, status: 'planned', kind: 'income' })).toBe(false);
    // Pagamento de fatura está amarrado à fatura.
    expect(showsKindField({ accountId: ACCOUNT, status: 'posted', kind: 'credit_card_payment' })).toBe(false);
  });
});

describe('readEditableKind', () => {
  it('aceita os quatro tipos e recusa o resto', () => {
    expect(readEditableKind('transfer')).toBe('transfer');
    expect(readEditableKind('investment_contribution')).toBe('investment_contribution');
    expect(readEditableKind('credit_card_payment')).toBeNull();
    expect(readEditableKind('')).toBeNull();
  });
});

describe('natureFitsKind e o espelho de categoryFitsKind', () => {
  it('bate com a regra do motor em toda natureza x tipo', () => {
    for (const nature of ['essential', 'non_essential', 'investment', 'income'] as const) {
      for (const kind of EDITABLE_TRANSACTION_KINDS) {
        expect(natureFitsKind(nature, kind), `${nature} x ${kind}`).toBe(categoryFitsKind(nature, kind));
      }
    }
  });

  it('nenhum modulo que o editor carrega no navegador importa lib/finance/categorization (puxa node:crypto)', () => {
    for (const file of ['edit-values.ts', 'transaction-list.tsx', 'manual-sign.ts']) {
      const source = readFileSync(join(process.cwd(), 'components/transactions', file), 'utf8');
      expect(source, file).not.toMatch(/from '@\/lib\/finance\/(categorization|dedupe)'/);
    }
  });
});

describe('categoryAfterKindChange', () => {
  it('virar Transferência MANTÉM a categoria: qualquer natureza cabe, e limpar criaria pendência "sem categoria"', () => {
    expect(categoryAfterKindChange(SALARY, 'transfer', categories)).toBe(SALARY);
    expect(categoryAfterKindChange(MARKET, 'transfer', categories)).toBe(MARKET);
  });

  it('entre os outros tipos, a categoria fica se cabe e é limpa se não cabe', () => {
    // Receita -> Despesa: categoria de receita não cabe em despesa.
    expect(categoryAfterKindChange(SALARY, 'expense', categories)).toBe('');
    // Despesa -> Receita: receita só vai para categoria de receita.
    expect(categoryAfterKindChange(MARKET, 'income', categories)).toBe('');
    expect(categoryAfterKindChange(SALARY, 'income', categories)).toBe(SALARY);
    expect(categoryAfterKindChange(MARKET, 'expense', categories)).toBe(MARKET);
    // Aporte aceita qualquer natureza.
    expect(categoryAfterKindChange(INVEST, 'investment_contribution', categories)).toBe(INVEST);
  });

  it('sem categoria ou com categoria desconhecida, fica sem categoria', () => {
    expect(categoryAfterKindChange('', 'expense', categories)).toBe('');
    expect(categoryAfterKindChange('55555555-5555-4555-8555-555555555555', 'expense', categories)).toBe('');
  });
});

describe('directionChange', () => {
  it('acusa a inversão de direção e fica calado no resto', () => {
    // Transferência de saída -70,00 virada Receita: grava +70,00.
    expect(directionChange(-7_000, 7_000)).toBe('to-inflow');
    // Receita +100,00 virada Despesa: grava -100,00.
    expect(directionChange(10_000, -10_000)).toBe('to-outflow');
    // Mesma direção, mesmo com outro valor; e zero não tem direção.
    expect(directionChange(502_690, 502_690)).toBeNull();
    expect(directionChange(-10_000, -9_000)).toBeNull();
    expect(directionChange(0, 5_000)).toBeNull();
    expect(directionChange(-5_000, 0)).toBeNull();
  });
});

describe('buildEditValues', () => {
  it('sem troca de tipo o corpo não leva kind e o sinal é o do tipo da linha', () => {
    const body = buildEditValues({ kind: 'expense' }, { ...fields, typedAmountCents: cents(1000), kind: 'expense', categoryId: MARKET });
    expect(body).toEqual({ occurredOn: '2026-11-03', description: 'Nu turbo', amountCents: -1000, categoryId: MARKET, memberId: null });
    expect('kind' in body).toBe(false);
  });

  it('Receita virada Transferência: kind no corpo e a entrada continua positiva', () => {
    // O caso do "Nu turbo": R$ 5.026,90 de entrada. O campo mostrava 502690 (receita, sem sinal);
    // na troca de tipo o campo passa a mostrar o mesmo +502690, e é isso que grava.
    const typed = amountOnKindChange(cents(502_690), 'income', 'transfer');
    expect(typed).toBe(502_690);
    const body = buildEditValues({ kind: 'income' }, { ...fields, typedAmountCents: typed, kind: 'transfer' });
    expect(body.kind).toBe('transfer');
    expect(body.amountCents).toBe(502_690);
    expect(body.categoryId).toBeNull();
  });

  it('Despesa virada Transferência: a saída continua negativa', () => {
    // Despesa de -100,00 aparece como 10000 no campo; virando transferência o campo mostra -10000.
    const typed = amountOnKindChange(cents(10_000), 'expense', 'transfer');
    expect(typed).toBe(-10_000);
    const body = buildEditValues({ kind: 'expense' }, { ...fields, typedAmountCents: typed, kind: 'transfer' });
    expect(body.amountCents).toBe(-10_000);
  });

  it('Transferência de saída virada Despesa ou Receita: o sinal passa a ser o do tipo', () => {
    expect(amountOnKindChange(cents(-7_000), 'transfer', 'expense')).toBe(7_000);
    expect(buildEditValues({ kind: 'transfer' }, { ...fields, typedAmountCents: cents(7_000), kind: 'expense' }).amountCents).toBe(-7_000);
    expect(buildEditValues({ kind: 'transfer' }, { ...fields, typedAmountCents: cents(7_000), kind: 'income' }).amountCents).toBe(7_000);
  });

  it('tipo fora da lista editável não vai no corpo, e o sinal segue o tipo da linha', () => {
    const body = buildEditValues({ kind: 'credit_card_payment' }, { ...fields, typedAmountCents: cents(-30_000), kind: 'credit_card_payment' });
    expect('kind' in body).toBe(false);
    expect(body.amountCents).toBe(-30_000);
  });
});
