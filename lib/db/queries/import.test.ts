import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // The test remains skipped on environments without a local database.
  }
}

/**
 * This is intentionally an integration test: a fake transaction can prove
 * that a callback was called, but not that PostgreSQL rolled back rows already
 * inserted before the injected failure.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('commitImport atomicity', () => {
  it('rolls back batch, statement, plan and transactions after a mid-commit failure', async () => {
    const [{ db }, schema, { commitImport }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./import'),
    ]);
    const {
      creditCards,
      households,
      importBatches,
      installmentPlans,
      statements,
      transactions,
    } = schema;
    const [household] = await db
      .insert(households)
      .values({ name: 'T-108 atomicity test' })
      .returning({ id: households.id });
    if (household === undefined) throw new Error('Test household was not created.');

    try {
      const [card] = await db
        .insert(creditCards)
        .values({
          householdId: household.id,
          name: 'T-108 card',
          bank: null,
          brand: 'other',
          holderMemberId: null,
          paymentAccountId: null,
          creditLimitCents: null,
          closingDay: 10,
          dueDay: 20,
          active: true,
        })
        .returning({ id: creditCards.id });
      if (card === undefined) throw new Error('Test card was not created.');

      await expect(
        commitImport(
          household.id,
          {
            fileName: 'atomicity.txt',
            fileHash: 'a'.repeat(64),
            bankKey: null,
            format: 'text',
            sourceKind: 'credit_card',
            sourceId: card.id,
            confirmedRows: [
              {
                index: 0,
                include: true,
                occurredOn: '2026-09-05',
                description: 'Compra de teste',
                rawDescription: 'Compra de teste',
                amountCents: cents(-1000),
                categoryId: null,
                memberId: null,
                installment: null,
              },
            ],
            reportedTotalCents: null,
            allowReimport: false,
          },
          { failAfter: 'transactions' },
        ),
      ).rejects.toThrow('Falha de teste após os lançamentos.');

      const [batchRows, statementRows, planRows, transactionRows] = await Promise.all([
        db.select({ id: importBatches.id }).from(importBatches).where(eq(importBatches.householdId, household.id)),
        db
          .select({ id: statements.id })
          .from(statements)
          .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
          .where(and(eq(creditCards.householdId, household.id), eq(statements.period, '2026-09'))),
        db.select({ id: installmentPlans.id }).from(installmentPlans).where(eq(installmentPlans.householdId, household.id)),
        db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, household.id)),
      ]);
      expect(batchRows).toHaveLength(0);
      expect(statementRows).toHaveLength(0);
      expect(planRows).toHaveLength(0);
      expect(transactionRows).toHaveLength(0);
    } finally {
      await db.delete(households).where(eq(households.id, household.id));
    }
  });
});

async function createImportFixture(label: string) {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
  ]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `T-108 ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Test household was not created.');

  const [card] = await db
    .insert(schema.creditCards)
    .values({
      householdId: household.id,
      name: `T-108 ${label} card`,
      bank: null,
      brand: 'other',
      holderMemberId: null,
      paymentAccountId: null,
      creditLimitCents: null,
      closingDay: 10,
      dueDay: 20,
      active: true,
    })
    .returning({ id: schema.creditCards.id });
  if (card === undefined) throw new Error('Test card was not created.');

  return {
    db,
    schema,
    householdId: household.id,
    cardId: card.id,
    cleanup: async () => {
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    },
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('import dedupe and revert boundaries', () => {
  it('does not add transactions when the same confirmed file is committed twice', async () => {
    const fixture = await createImportFixture('dedupe');
    const { commitImport } = await import('./import');
    const input = {
      fileName: 'same-file.txt',
      fileHash: 'b'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          description: 'Compra repetida',
          rawDescription: 'Compra repetida',
          amountCents: cents(-1500),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
      reportedTotalCents: null,
      allowReimport: false,
    };

    try {
      const first = await commitImport(fixture.householdId, input);
      const second = await commitImport(fixture.householdId, {
        ...input,
        allowReimport: true,
      });
      const rows = await fixture.db
        .select({ id: fixture.schema.transactions.id })
        .from(fixture.schema.transactions)
        .where(eq(fixture.schema.transactions.householdId, fixture.householdId));

      expect(first.rowsImported).toBe(1);
      expect(second.rowsImported).toBe(0);
      expect(second.rowsDuplicated).toBe(1);
      expect(rows).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('revert removes only its own rows and leaves no plan or statement orphan', async () => {
    const fixture = await createImportFixture('revert-boundary');
    const { commitImport, revertImport } = await import('./import');
    const first = {
      fileName: 'first.txt',
      fileHash: 'c'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          description: 'Compra parcelada',
          rawDescription: 'Compra parcelada 1/2',
          amountCents: cents(-1000),
          categoryId: null,
          memberId: null,
          installment: { current: 1, total: 2 },
        },
      ],
      reportedTotalCents: null,
      allowReimport: false,
    };
    const second = {
      ...first,
      fileName: 'second.txt',
      fileHash: 'd'.repeat(64),
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          rawDescription: 'Outra compra',
          description: 'Outra compra',
          amountCents: cents(-2000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
    };

    try {
      const firstBatch = await commitImport(fixture.householdId, first);
      const secondBatch = await commitImport(fixture.householdId, second);
      const reverted = await revertImport(fixture.householdId, firstBatch.batchId);
      const afterFirst = await fixture.db
        .select({ id: fixture.schema.transactions.id, batchId: fixture.schema.transactions.importBatchId })
        .from(fixture.schema.transactions)
        .where(eq(fixture.schema.transactions.householdId, fixture.householdId));
      const plansAfterFirst = await fixture.db
        .select({ id: fixture.schema.installmentPlans.id })
        .from(fixture.schema.installmentPlans)
        .where(eq(fixture.schema.installmentPlans.householdId, fixture.householdId));
      const statementsAfterFirst = await fixture.db
        .select({ id: fixture.schema.statements.id })
        .from(fixture.schema.statements)
        .innerJoin(
          fixture.schema.creditCards,
          eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
        )
        .where(eq(fixture.schema.creditCards.householdId, fixture.householdId));

      expect(reverted.transactionsDeleted).toBe(2);
      expect(afterFirst).toEqual([
        { id: expect.any(String), batchId: secondBatch.batchId },
      ]);
      expect(plansAfterFirst).toHaveLength(0);
      expect(statementsAfterFirst).toHaveLength(1);

      const revertedSecond = await revertImport(fixture.householdId, secondBatch.batchId);
      const [remainingTransactions, remainingPlans, remainingStatements] = await Promise.all([
        fixture.db
          .select({ id: fixture.schema.transactions.id })
          .from(fixture.schema.transactions)
          .where(eq(fixture.schema.transactions.householdId, fixture.householdId)),
        fixture.db
          .select({ id: fixture.schema.installmentPlans.id })
          .from(fixture.schema.installmentPlans)
          .where(eq(fixture.schema.installmentPlans.householdId, fixture.householdId)),
        fixture.db
          .select({ id: fixture.schema.statements.id })
          .from(fixture.schema.statements)
          .innerJoin(
            fixture.schema.creditCards,
            eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
          )
          .where(eq(fixture.schema.creditCards.householdId, fixture.householdId)),
      ]);
      expect(revertedSecond.transactionsDeleted).toBe(1);
      expect(remainingTransactions).toHaveLength(0);
      expect(remainingPlans).toHaveLength(0);
      expect(remainingStatements).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
