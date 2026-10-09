import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local, o teste fica pulado.
  }
}

/**
 * Aviso do Fluxo (decisao do Ricardo, 2026-10-09): a projecao NAO desconta as faturas
 * anteriores nao pagas; o loader so as expoe para a tela avisar. Household proprio,
 * apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('loadProjectedCashflow: faturas anteriores nao pagas', () => {
  it('expoe o total e os meses, sem mexer na projecao', async () => {
    const [{ db }, schema, { loadProjectedCashflow }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./load-cashflow'),
    ]);
    const [household] = await db.insert(schema.households).values({ name: 'Fluxo aviso vencidas' }).returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household de teste nao foi criado.');
    const householdId = household.id;
    try {
      const [card] = await db
        .insert(schema.creditCards)
        .values({
          householdId,
          name: 'Cartao',
          bank: null,
          brand: 'other',
          holderMemberId: null,
          paymentAccountId: null,
          creditLimitCents: null,
          closingDay: 1,
          dueDay: 10,
          active: true,
        })
        .returning({ id: schema.creditCards.id });
      if (card === undefined) throw new Error('Cartao nao criado.');
      const [julho] = await db
        .insert(schema.statements)
        .values({ creditCardId: card.id, period: '2026-07', closingDate: '2026-07-01', dueDate: '2026-07-10', status: 'open', source: 'import' })
        .returning({ id: schema.statements.id });
      if (julho === undefined) throw new Error('Fatura nao criada.');
      await db.insert(schema.transactions).values({
        householdId,
        occurredOn: '2026-06-20',
        competence: '2026-07',
        description: 'x',
        rawDescription: 'x',
        amountCents: -146901,
        kind: 'expense',
        creditCardId: card.id,
        statementId: julho.id,
      });

      const loaded = await loadProjectedCashflow(householdId, '2026-10-09');
      expect(loaded.overdueUnpaidStatements).toEqual({ totalCents: -146901, competences: ['2026-07'] });
      // So aviso: a projecao comeca no mes corrente e nao leva a fatura de julho.
      expect(loaded.projection.months[0]?.competence).toBe('2026-10');
    } finally {
      await db.delete(schema.households).where(eq(schema.households.id, householdId));
    }
  });
});
