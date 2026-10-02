import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { transactionSchema } from '@/components/transactions/schemas';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Decisão nº 7: a lista de lançamentos esconde a previsão `reconciled` (o real já a
 * substituiu) e o total calculado da fatura não a soma. Household PRÓPRIO, apagado.
 *
 * A previsão de cartão não ganha `statement_id` pelos caminhos de escrita de hoje
 * (só a importação grava, e só em linha `posted`); o teste o força na `reconciled`
 * para provar que o filtro, e não o dado, é quem garante o total.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'lista de lançamentos e fatura ignoram previsão reconciled',
  () => {
    it('listTransactions e computedTotalCents não mudam por causa de uma reconciled', async () => {
      const [{ db }, schema, transactionsQ, cardsQ, dashboardQ] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./transactions'),
        import('./cards'),
        import('./dashboard'),
      ]);
      const { creditCards, households, statements, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'Reconciled lista test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;

      try {
        const [card] = await db
          .insert(creditCards)
          .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
          .returning({ id: creditCards.id });
        if (card === undefined) throw new Error('Fixture não foi criada.');
        const [statement] = await db
          .insert(statements)
          .values({
            creditCardId: card.id,
            period: '2026-10',
            closingDate: '2026-10-01',
            dueDate: '2026-10-10',
            reportedTotalCents: -7_000,
            status: 'open',
            source: 'manual',
          })
          .returning({ id: statements.id });
        if (statement === undefined) throw new Error('Fatura não foi criada.');

        const onCard = { householdId, rawDescription: '', creditCardId: card.id, kind: 'expense' } as const;
        const [real] = await db
          .insert(transactions)
          .values({
            ...onCard,
            description: 'Mercado',
            occurredOn: '2026-10-07',
            competence: '2026-10',
            cashDate: '2026-10-10',
            amountCents: -7_000,
            status: 'posted',
            statementId: statement.id,
          })
          .returning({ id: transactions.id });
        if (real === undefined) throw new Error('Fixture não foi criada.');

        const read = async () => ({
          list: (await transactionsQ.listTransactions(householdId)).map((row) => row.id),
          totals: (await cardsQ.listCards(householdId)).flatMap((c) =>
            c.statements.map((s) => s.computedTotalCents),
          ),
          divergent: (await dashboardQ.getDashboardData(householdId, '2026-10-10', 12)).divergentStatements,
        });
        const before = await read();
        expect(before.list).toEqual([real.id]);
        expect(before.totals).toEqual([-7_000]);

        await db.insert(transactions).values({
          ...onCard,
          description: 'Mercado previsto',
          occurredOn: '2026-10-06',
          competence: '2026-10',
          cashDate: '2026-10-10',
          amountCents: -7_000,
          status: 'reconciled',
          reconciledByTransactionId: real.id,
          statementId: statement.id,
        });

        expect(await read()).toEqual(before);
      } finally {
        await db
          .delete(transactions)
          .where(and(eq(transactions.householdId, householdId), eq(transactions.status, 'reconciled')));
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });

    it('o schema da tela aceita status reconciled (o parse nunca quebra por status novo)', () => {
      const row = {
        id: '00000000-0000-4000-8000-000000000001',
        occurredOn: '2026-10-06',
        competence: '2026-10',
        cashDate: null,
        description: 'x',
        rawDescription: 'x',
        amountCents: -100,
        kind: 'expense',
        status: 'reconciled',
        categoryId: null,
        categoryName: null,
        categoryNature: null,
        accountId: null,
        accountName: null,
        creditCardId: null,
        creditCardName: null,
        memberId: null,
        memberName: null,
        installmentNumber: null,
        note: null,
      };
      expect(transactionSchema.safeParse(row).success).toBe(true);
    });
  },
);
