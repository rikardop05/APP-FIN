import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Prova do caminho de exclusao do janitor (`deleteTestHouseholds`), sem rodar
 * o `--execute` de verdade: cria 2 households PROPRIOS com os amarres que
 * costumam travar limpeza (previsao `reconciled`, fatura com
 * `paid_transaction_id`, lote de importacao), roda a exclusao SO sobre os 2
 * ids dentro de transacao, e confere que sumiram e que a Casa real segue
 * intacta (mesmos membros e lancamentos antes e depois).
 *
 * Disciplina do banco unico: households proprios, apagados no `finally`
 * (a propria funcao sob teste, idempotente para o que ja saiu).
 */

const CASA_ID = '1548ea39-8a1e-5dc2-9cd4-54ae6f79b824';

async function modules() {
  const [{ db }, schema, janitor] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./cleanup-test-households.ts'),
  ]);
  return { db, schema, deleteTestHouseholds: janitor.deleteTestHouseholds };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seedProofHousehold(m: Modules, name: string, email: string) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de prova nao foi criado.');
  const householdId = household.id;
  try {
    const [member] = await db
      .insert(schema.members)
      .values({ householdId, name: 'Prova', email, color: '#000000' })
      .returning({ id: schema.members.id });
    const [account] = await db
      .insert(schema.accounts)
      .values({ householdId, name: 'Conta prova', kind: 'checking', openingDate: '2026-01-01' })
      .returning({ id: schema.accounts.id });
    const [category] = await db
      .insert(schema.categories)
      .values({ householdId, name: 'Moradia prova', parentId: null, nature: 'essential' })
      .returning({ id: schema.categories.id });
    const [card] = await db
      .insert(schema.creditCards)
      .values({ householdId, name: 'Cartao prova', closingDay: 10, dueDay: 20 })
      .returning({ id: schema.creditCards.id });
    if (member === undefined || account === undefined || category === undefined || card === undefined) {
      throw new Error('Seed de prova incompleto.');
    }
    const [posted] = await db
      .insert(schema.transactions)
      .values({
        householdId,
        occurredOn: '2026-09-05',
        competence: '2026-09',
        cashDate: '2026-09-05',
        description: 'Real prova',
        rawDescription: 'Real prova',
        amountCents: -5000,
        kind: 'expense',
        status: 'posted',
        accountId: account.id,
        categoryId: category.id,
      })
      .returning({ id: schema.transactions.id });
    if (posted === undefined) throw new Error('Lancamento real de prova nao foi criado.');
    await db.insert(schema.transactions).values({
      householdId,
      occurredOn: '2026-10-05',
      competence: '2026-10',
      cashDate: '2026-10-05',
      description: 'Prevista prova',
      rawDescription: 'Prevista prova',
      amountCents: -5000,
      kind: 'expense',
      status: 'reconciled',
      reconciledByTransactionId: posted.id,
      accountId: account.id,
      categoryId: category.id,
    });
    const [statement] = await db
      .insert(schema.statements)
      .values({
        creditCardId: card.id,
        period: '2026-09',
        closingDate: '2026-09-01',
        dueDate: '2026-09-10',
        source: 'manual',
        paidTransactionId: posted.id,
      })
      .returning({ id: schema.statements.id });
    if (statement === undefined) throw new Error('Fatura de prova nao foi criada.');
    await db.insert(schema.importBatches).values({
      householdId,
      fileName: 'prova.txt',
      fileHash: 'p'.repeat(64),
      format: 'text',
      accountId: account.id,
    });
    return { householdId, statementId: statement.id };
  } catch (error) {
    try {
      await db.delete(schema.households).where(eq(schema.households.id, householdId));
    } catch {
      // Se a compensacao falhar, o orfao cai na faxina de households de teste.
    }
    throw error;
  }
}

async function casaProfile(m: Modules) {
  const { db, schema } = m;
  const memberRows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.householdId, CASA_ID));
  const txRows = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, CASA_ID));
  return { members: memberRows.length, txs: txRows.length };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('janitor: deleteTestHouseholds (prova em households proprios)', () => {
  it('apaga so os 2 ids, com reconciled + paid_transaction_id + lote; a Casa fica igual antes e depois', async () => {
    const m = await modules();
    // A Casa vai receber faturas novas: nao fixa numeros, confere que a
    // exclusao nao tocou nela (igual antes e depois).
    const before = await casaProfile(m);

    const created: string[] = [];
    let completed = false;
    try {
      const a = await seedProofHousehold(m, 'Prova do janitor A', `janitor-a-${Date.now()}@example.test`);
      created.push(a.householdId);
      const b = await seedProofHousehold(m, 'Prova do janitor B', `janitor-b-${Date.now()}@example.test`);
      created.push(b.householdId);

      await m.db.transaction(async (tx) => {
        await m.deleteTestHouseholds(tx, [a.householdId, b.householdId]);
      });

      for (const id of [a.householdId, b.householdId]) {
        const left = await m.db
          .select({ id: m.schema.households.id })
          .from(m.schema.households)
          .where(eq(m.schema.households.id, id));
        expect(left).toHaveLength(0);
        const txLeft = await m.db
          .select({ id: m.schema.transactions.id })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.householdId, id));
        expect(txLeft).toHaveLength(0);
        const batchLeft = await m.db
          .select({ id: m.schema.importBatches.id })
          .from(m.schema.importBatches)
          .where(eq(m.schema.importBatches.householdId, id));
        expect(batchLeft).toHaveLength(0);
      }
      const statementLeft = await m.db
        .select({ id: m.schema.statements.id })
        .from(m.schema.statements)
        .where(eq(m.schema.statements.id, a.statementId));
      expect(statementLeft).toHaveLength(0);

      // A Casa nao foi tocada.
      expect(await casaProfile(m)).toEqual(before);
      completed = true;
    } finally {
      if (!completed && created.length > 0) {
        await m.db.transaction(async (tx) => {
          await m.deleteTestHouseholds(tx, created);
        });
      }
    }
  });
});
