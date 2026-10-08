import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Natureza x tipo no SERVIDOR: lançamento novo, edição e lote recusam despesa em categoria de receita
 * e receita em categoria que não é de receita, sem alterar nada. Household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('categorização manual respeita a natureza da categoria', () => {
  async function setup() {
    const [{ db }, schema, queries, { CategoryKindMismatchError }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./transactions'),
      import('./category-kind'),
    ]);
    const [household] = await db.insert(schema.households).values({ name: 'natureza x tipo test' }).returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household não foi criado.');
    const householdId = household.id;
    const [account] = await db
      .insert(schema.accounts)
      .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
      .returning({ id: schema.accounts.id });
    const category = async (name: string, nature: 'income' | 'essential') => {
      const [row] = await db
        .insert(schema.categories)
        .values({ householdId, name, parentId: null, nature })
        .returning({ id: schema.categories.id });
      if (row === undefined) throw new Error('Categoria não foi criada.');
      return row.id;
    };
    const salary = await category('Salário', 'income');
    const market = await category('Mercado', 'essential');
    if (account === undefined) throw new Error('Conta não foi criada.');
    const seed = async (kind: 'expense' | 'income', description: string) => {
      const [row] = await db
        .insert(schema.transactions)
        .values({
          householdId,
          rawDescription: description,
          description,
          accountId: account.id,
          occurredOn: '2026-10-05',
          competence: '2026-10',
          cashDate: '2026-10-05',
          amountCents: kind === 'expense' ? -1000 : 1000,
          kind,
          status: 'posted',
        })
        .returning({ id: schema.transactions.id });
      if (row === undefined) throw new Error('Lançamento não foi criado.');
      return row.id;
    };
    const categoryOf = async (id: string) => {
      const [row] = await db.select({ categoryId: schema.transactions.categoryId }).from(schema.transactions).where(eq(schema.transactions.id, id));
      return row?.categoryId ?? null;
    };
    const draft = (kind: 'expense' | 'income', categoryId: string | null) => ({
      occurredOn: '2026-10-06',
      description: 'manual',
      amountCents: cents(kind === 'expense' ? -500 : 500),
      kind,
      categoryId,
      accountId: account.id,
      creditCardId: null,
      memberId: null,
      note: null,
    });
    return {
      db, schema, queries, CategoryKindMismatchError, householdId, salary, market, seed, categoryOf, draft,
      cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
    };
  }

  it('lançamento NOVO: despesa em categoria de receita e receita em categoria de despesa são recusadas, e nada é gravado', async () => {
    const s = await setup();
    try {
      await expect(s.queries.createManualTransaction(s.householdId, s.draft('expense', s.salary))).rejects.toBeInstanceOf(s.CategoryKindMismatchError);
      await expect(s.queries.createManualTransaction(s.householdId, s.draft('income', s.market))).rejects.toThrow(
        'Receita só pode ir para uma categoria de receita.',
      );
      const stored = await s.db.select({ id: s.schema.transactions.id }).from(s.schema.transactions).where(eq(s.schema.transactions.householdId, s.householdId));
      expect(stored).toHaveLength(0);
      // O que cabe, e o sem categoria, continuam funcionando.
      await s.queries.createManualTransaction(s.householdId, s.draft('expense', s.market));
      await s.queries.createManualTransaction(s.householdId, s.draft('income', s.salary));
      await s.queries.createManualTransaction(s.householdId, s.draft('expense', null));
    } finally {
      await s.cleanup();
    }
  });

  it('EDIÇÃO: recategorizar para categoria que não cabe é recusado e a categoria antiga fica; a que cabe passa', async () => {
    const s = await setup();
    try {
      const expense = await s.seed('expense', 'padaria');
      const income = await s.seed('income', 'freela');
      await expect(s.queries.updateTransaction(s.householdId, expense, { categoryId: s.salary })).rejects.toBeInstanceOf(s.CategoryKindMismatchError);
      await expect(s.queries.updateTransaction(s.householdId, income, { categoryId: s.market })).rejects.toBeInstanceOf(s.CategoryKindMismatchError);
      expect(await s.categoryOf(expense)).toBeNull();
      expect(await s.categoryOf(income)).toBeNull();
      await s.queries.updateTransaction(s.householdId, expense, { categoryId: s.market });
      await s.queries.updateTransaction(s.householdId, income, { categoryId: s.salary });
      expect(await s.categoryOf(expense)).toBe(s.market);
      expect(await s.categoryOf(income)).toBe(s.salary);
      // Editar só a descrição não reconfere a categoria (não a muda), e limpar a categoria passa.
      await s.queries.updateTransaction(s.householdId, expense, { description: 'padaria nova' });
      await s.queries.updateTransaction(s.householdId, expense, { categoryId: null });
      expect(await s.categoryOf(expense)).toBeNull();
    } finally {
      await s.cleanup();
    }
  });

  it('LOTE: um lançamento que não cabe recusa o lote INTEIRO, diz quantos e não altera nenhum', async () => {
    const s = await setup();
    try {
      const a = await s.seed('income', 'salario');
      const b = await s.seed('expense', 'pix enviado');
      const c = await s.seed('income', 'freela');
      const batch = { transactionIds: [a, b, c], categoryId: s.salary, memberId: null };
      await expect(s.queries.categorizeTransactionsBatch(s.householdId, batch)).rejects.toThrow(
        '1 lançamento não cabe nesta categoria: despesa não vai para categoria de receita, e receita só vai para categoria de receita. Nada foi alterado.',
      );
      expect([await s.categoryOf(a), await s.categoryOf(b), await s.categoryOf(c)]).toEqual([null, null, null]);
      // Só as receitas: passa.
      expect(await s.queries.categorizeTransactionsBatch(s.householdId, { ...batch, transactionIds: [a, c] })).toBe(2);
      expect(await s.categoryOf(a)).toBe(s.salary);
      // Só despesa em categoria de despesa: passa.
      expect(await s.queries.categorizeTransactionsBatch(s.householdId, { transactionIds: [b], categoryId: s.market, memberId: null })).toBe(1);
    } finally {
      await s.cleanup();
    }
  });
});
