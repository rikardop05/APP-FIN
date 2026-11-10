import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { monthlyKpis } from '@/lib/finance/kpis';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Troca de tipo na edição (Lote 1, item 4) contra o banco real: o que é gravado, o que é recusado
 * sem alterar nada, e a Sobra do mês (`monthlyKpis`) antes e depois. Household PRÓPRIO, apagado no
 * `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('updateTransaction: troca de tipo', () => {
  async function setup() {
    const [{ db }, schema, queries, { CategoryKindMismatchError }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./transactions'),
      import('./category-kind'),
    ]);
    const [household] = await db.insert(schema.households).values({ name: 'Lote1 troca de tipo test' }).returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household não foi criado.');
    const householdId = household.id;
    try {
      const [account] = await db
        .insert(schema.accounts)
        .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: schema.accounts.id });
      const [card] = await db
        .insert(schema.creditCards)
        .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
        .returning({ id: schema.creditCards.id });
      if (account === undefined || card === undefined) throw new Error('Seed incompleto.');
      const category = async (name: string, nature: 'income' | 'essential') => {
        const [row] = await db
          .insert(schema.categories)
          .values({ householdId, name, parentId: null, nature })
          .returning({ id: schema.categories.id });
        if (row === undefined) throw new Error('Categoria não foi criada.');
        return row.id;
      };
      const reserve = await category('Reserva', 'income');
      const market = await category('Mercado', 'essential');
      const seed = async (values: {
        kind: 'expense' | 'income' | 'transfer' | 'credit_card_payment';
        amountCents: number;
        categoryId?: string | null;
        status?: 'posted' | 'planned';
        onCard?: boolean;
      }) => {
        const [row] = await db
          .insert(schema.transactions)
          .values({
            householdId,
            rawDescription: 'x',
            description: 'x',
            accountId: values.onCard ? null : account.id,
            creditCardId: values.onCard ? card.id : null,
            occurredOn: '2026-11-03',
            competence: '2026-11',
            cashDate: '2026-11-03',
            amountCents: values.amountCents,
            kind: values.kind,
            status: values.status ?? 'posted',
            categoryId: values.categoryId ?? null,
          })
          .returning({ id: schema.transactions.id });
        if (row === undefined) throw new Error('Lançamento não foi criado.');
        return row.id;
      };
      const stored = async (id: string) => {
        const [row] = await db
          .select({ kind: schema.transactions.kind, amountCents: schema.transactions.amountCents, categoryId: schema.transactions.categoryId })
          .from(schema.transactions)
          .where(eq(schema.transactions.id, id));
        if (row === undefined) throw new Error('Lançamento sumiu.');
        return { ...row, amountCents: Number(row.amountCents) };
      };
      /** Sobra de nov/2026 pelo motor, sobre o que a lista de lançamentos devolve. */
      const surplus = async () => {
        const rows = await queries.listTransactions(householdId, {});
        return monthlyKpis({
          competence: '2026-11',
          transactions: rows
            .filter((row) => row.competence === '2026-11')
            .map((row) => ({
              amountCents: row.amountCents,
              kind: row.kind,
              status: row.status,
              categoryNature: row.categoryNature ?? 'non_essential',
            })),
          futureInstallmentsCents: cents(0),
          uncategorizedCount: 0,
        });
      };
      return {
        queries, CategoryKindMismatchError, householdId, reserve, market, seed, stored, surplus,
        cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
      };
    } catch (error) {
      try {
        await db.delete(schema.households).where(eq(schema.households.id, householdId));
      } catch {
        // Se a compensação falhar, o órfão cai na faxina de households de teste.
      }
      throw error;
    }
  }

  it('entrada que não é renda vira Transferência: tipo muda, valor e sinal ficam, e a Sobra deixa de contar', async () => {
    const s = await setup();
    try {
      const salary = await s.seed({ kind: 'income', amountCents: 800_000 });
      const turbo = await s.seed({ kind: 'income', amountCents: 502_690, categoryId: s.reserve });
      await s.seed({ kind: 'expense', amountCents: -300_000, categoryId: s.market });
      expect(salary).not.toBe(turbo);

      // Antes: receita 8.000,00 + 5.026,90 = 13.026,90; despesa 3.000,00; sobra 10.026,90.
      const before = await s.surplus();
      expect(before.incomeCents).toBe(1_302_690);
      expect(before.surplusCents).toBe(1_002_690);

      // O corpo que o editor manda: tipo novo, e a categoria que já estava (cabe em Transferência).
      await s.queries.updateTransaction(s.householdId, turbo, { kind: 'transfer', categoryId: s.reserve, amountCents: cents(502_690) });
      expect(await s.stored(turbo)).toEqual({ kind: 'transfer', amountCents: 502_690, categoryId: s.reserve });

      // Depois: receita 8.000,00; despesa 3.000,00; sobra 5.000,00.
      const after = await s.surplus();
      expect(after.incomeCents).toBe(800_000);
      expect(after.surplusCents).toBe(500_000);
    } finally {
      await s.cleanup();
    }
  });

  it('só o tipo no corpo: valor intacto, e a categoria que fica tem de caber no tipo novo', async () => {
    const s = await setup();
    try {
      // Despesa -> Transferência sem mandar valor: o -100,00 continua -100,00 (qualquer categoria cabe).
      const expense = await s.seed({ kind: 'expense', amountCents: -10_000, categoryId: s.market });
      await s.queries.updateTransaction(s.householdId, expense, { kind: 'transfer' });
      expect(await s.stored(expense)).toEqual({ kind: 'transfer', amountCents: -10_000, categoryId: s.market });

      // Receita em categoria de receita -> Despesa sem trocar a categoria: recusado, nada muda.
      const income = await s.seed({ kind: 'income', amountCents: 5_000, categoryId: s.reserve });
      // (O valor vai com o sinal de despesa, como o editor manda: o que recusa aqui é a categoria.)
      await expect(
        s.queries.updateTransaction(s.householdId, income, { kind: 'expense', amountCents: cents(-5_000) }),
      ).rejects.toBeInstanceOf(s.CategoryKindMismatchError);
      expect(await s.stored(income)).toEqual({ kind: 'income', amountCents: 5_000, categoryId: s.reserve });
      // Com a categoria que cabe (ou sem categoria), passa.
      await s.queries.updateTransaction(s.householdId, income, { kind: 'expense', categoryId: s.market, amountCents: cents(-5_000) });
      expect(await s.stored(income)).toEqual({ kind: 'expense', amountCents: -5_000, categoryId: s.market });
      // Troca para Despesa/Receita com o sinal contrário ao tipo (PATCH direto, sem valor): recusado.
      const positive = await s.seed({ kind: 'income', amountCents: 5_000 });
      await expect(s.queries.updateTransaction(s.householdId, positive, { kind: 'expense', categoryId: null })).rejects.toBeInstanceOf(
        s.queries.TransactionKindSignError,
      );
      await expect(
        s.queries.updateTransaction(s.householdId, expense, { kind: 'income', categoryId: null, amountCents: cents(-10_000) }),
      ).rejects.toBeInstanceOf(s.queries.TransactionKindSignError);
      expect(await s.stored(positive)).toEqual({ kind: 'income', amountCents: 5_000, categoryId: null });
      // Mandar o MESMO tipo não é troca: não reconfere nem recusa.
      await s.queries.updateTransaction(s.householdId, income, { kind: 'expense', description: 'mesmo tipo' });
    } finally {
      await s.cleanup();
    }
  });

  it('recusa a troca em cartão, em previsão e em pagamento de fatura, sem alterar a linha', async () => {
    const s = await setup();
    try {
      const onCard = await s.seed({ kind: 'expense', amountCents: -2_000, onCard: true });
      const planned = await s.seed({ kind: 'income', amountCents: 9_000, status: 'planned' });
      const payment = await s.seed({ kind: 'credit_card_payment', amountCents: -30_000 });
      for (const id of [onCard, planned, payment]) {
        await expect(s.queries.updateTransaction(s.householdId, id, { kind: 'transfer', description: 'não grava' })).rejects.toBeInstanceOf(
          s.queries.TransactionKindNotEditableError,
        );
      }
      expect((await s.stored(onCard)).kind).toBe('expense');
      expect((await s.stored(planned)).kind).toBe('income');
      expect((await s.stored(payment)).kind).toBe('credit_card_payment');
      // Outro household não troca o tipo de ninguém.
      await expect(
        s.queries.updateTransaction('00000000-0000-4000-8000-000000000000', onCard, { kind: 'transfer' }),
      ).rejects.toBeInstanceOf(s.queries.TransactionNotFoundError);
    } finally {
      await s.cleanup();
    }
  });
});
