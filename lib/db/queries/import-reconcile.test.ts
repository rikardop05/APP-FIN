import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * RF-ORC-03 na importação (decisão nº 7, §3.4): a linha real do arquivo cumpre
 * a previsão de recorrência. Banco real, household PRÓPRIO apagado no `finally`.
 * Requer as migrations 0005 e 0006.
 */

const TODAY = '2026-10-15';

async function modules() {
  const [{ db }, schema, imp, recurring, write] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./import'),
    import('./recurring'),
    import('./recurring-planned-write'),
  ]);
  return { db, schema, imp, recurring, write };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function setup(m: Modules) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name: 'T-import-reconcile test' })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;
  await db.insert(schema.householdSettings).values({ householdId, projectionMonths: 6 });
  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId, name: 'Conta teste', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  const [root] = await db
    .insert(schema.categories)
    .values({ householdId, name: 'Moradia teste', parentId: null, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (account === undefined || root === undefined) throw new Error('Seed incompleto.');
  const [leaf] = await db
    .insert(schema.categories)
    .values({ householdId, name: 'Luz teste', parentId: root.id, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (leaf === undefined) throw new Error('Categoria folha não foi criada.');

  const expenseId = await m.recurring.createRecurringExpense(
    householdId,
    {
      description: 'Conta de luz',
      expectedCents: cents(-18000),
      categoryId: leaf.id,
      dueDay: 5,
      frequency: 'monthly',
      accountId: account.id,
      creditCardId: null,
      startsOn: '2026-10-01',
      endsOn: null,
      annualAdjustmentBp: null,
    },
    TODAY,
  );
  const planned = async () =>
    (
      await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.recurringExpenseId, expenseId))
    ).sort((x, y) => x.competence.localeCompare(y.competence));

  let seq = 0;
  const importRows = (
    rows: { occurredOn: string; amountCents: number; categoryId: string | null }[],
    sourceAccountId: string = account.id,
  ) => {
    seq += 1;
    return m.imp.commitImport(householdId, {
      fileName: `extrato-${String(seq)}.txt`,
      fileHash: String(seq).padStart(64, 'c'),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'account' as const,
      sourceId: sourceAccountId,
      confirmedRows: rows.map((row, index) => ({
        index,
        include: true,
        occurredOn: row.occurredOn,
        description: `LUZ CIA ${String(seq)}-${String(index)}`,
        rawDescription: `LUZ CIA ${String(seq)}-${String(index)}`,
        amountCents: cents(row.amountCents),
        categoryId: row.categoryId,
        memberId: null,
        installment: null,
      })),
      reportedTotalCents: null,
      allowReimport: false,
      statementCompetence: null,
    });
  };
  return { householdId, accountId: account.id, categoryId: leaf.id, planned, importRows };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.execute(
    sql`update transactions set status = 'planned', reconciled_by_transaction_id = null where household_id = ${householdId} and status = 'reconciled'`,
  );
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.importBatches).where(eq(schema.importBatches.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
}

describe.skipIf(process.env.DATABASE_URL === undefined)(
  'conciliação na importação (banco real)',
  () => {
    it('concilia o par dentro de 10 % e 5 dias; o resto fica planned; reimportar não concilia de novo', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const result = await s.importRows([
          // Nov/05 previsto -180,00: -185,00 no dia 06 (2,8 %, 1 dia) casa.
          { occurredOn: '2026-11-06', amountCents: -18500, categoryId: s.categoryId },
          // Dez/05: dia 20 está a 15 dias, fora da janela.
          { occurredOn: '2026-12-20', amountCents: -18000, categoryId: s.categoryId },
          // Jan/05: -300,00 está a 66 % do previsto, fora da tolerância.
          { occurredOn: '2027-01-05', amountCents: -30000, categoryId: s.categoryId },
          // Fev/05: sem categoria nunca concilia.
          { occurredOn: '2027-02-05', amountCents: -18000, categoryId: null },
        ]);
        expect(result.plannedReconciled).toBe(1);

        const rows = await s.planned();
        const byCompetence = new Map(rows.map((row) => [row.competence, row]));
        const november = byCompetence.get('2026-11');
        expect(november?.status).toBe('reconciled');
        expect(november?.reconciledByTransactionId).not.toBeNull();
        for (const competence of ['2026-12', '2027-01', '2027-02']) {
          expect(byCompetence.get(competence)).toMatchObject({
            status: 'planned',
            reconciledByTransactionId: null,
          });
        }

        // O par é o real importado, na mesma data do arquivo.
        const [posted] = await m.db
          .select()
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.id, november?.reconciledByTransactionId ?? ''));
        expect(posted).toMatchObject({ status: 'posted', occurredOn: '2026-11-06', amountCents: -18500 });

        // Outro arquivo com outra linha perto de novembro: a previsão já cumprida não volta a casar.
        const again = await s.importRows([
          { occurredOn: '2026-11-05', amountCents: -18000, categoryId: s.categoryId },
        ]);
        expect(again.plannedReconciled).toBe(0);

        // E o top-up não regenera a cumprida.
        await m.write.topUpPlanned(s.householdId, TODAY);
        expect((await s.planned()).filter((row) => row.competence === '2026-11')).toHaveLength(1);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('receita casa pela CONTA onde cai (categoria nula): 7.400 na conta X em 2 dias casa; em outra conta não', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { db, schema } = m;
        const [member] = await db
          .insert(schema.members)
          .values({ householdId: s.householdId, name: 'Pessoa teste', email: `t-${s.householdId}@example.test`, color: '#000000' })
          .returning({ id: schema.members.id });
        const [accountY] = await db
          .insert(schema.accounts)
          .values({ householdId: s.householdId, name: 'Conta Y', kind: 'checking', openingDate: '2026-01-01' })
          .returning({ id: schema.accounts.id });
        if (member === undefined || accountY === undefined) throw new Error('Seed incompleto.');
        const incomeId = await m.recurring.createIncome(
          s.householdId,
          {
            description: 'Salário',
            kind: 'salary',
            expectedCents: cents(740000),
            memberId: member.id,
            accountId: s.accountId,
            receiveDay: 5,
            frequency: 'monthly',
            oneOffCompetence: null,
            startsOn: '2026-10-01',
            endsOn: null,
          },
          TODAY,
        );
        const incomeRows = async () =>
          (await db.select().from(schema.transactions).where(eq(schema.transactions.incomeId, incomeId))).sort(
            (x, y) => x.competence.localeCompare(y.competence),
          );
        const november = (await incomeRows()).find((row) => row.competence === '2026-11');
        expect(november?.categoryId).toBeNull();

        // Mesma data, mesmo valor, mas em OUTRA conta: não casa.
        const wrongAccount = await s.importRows(
          [{ occurredOn: '2026-11-07', amountCents: 740000, categoryId: null }],
          accountY.id,
        );
        expect(wrongAccount.plannedReconciled).toBe(0);
        expect((await incomeRows()).find((row) => row.competence === '2026-11')?.status).toBe('planned');

        // Conta X, 2 dias depois: casa.
        const ok = await s.importRows([{ occurredOn: '2026-11-07', amountCents: 740000, categoryId: null }]);
        expect(ok.plannedReconciled).toBe(1);
        const after = (await incomeRows()).find((row) => row.competence === '2026-11');
        expect(after?.status).toBe('reconciled');
        expect(after?.reconciledByTransactionId).not.toBeNull();
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('desfazer a importação reabre a previsão (sem o RESTRICT barrar)', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const result = await s.importRows([
          { occurredOn: '2026-11-05', amountCents: -18000, categoryId: s.categoryId },
        ]);
        expect(result.plannedReconciled).toBe(1);
        await m.imp.revertImport(s.householdId, result.batchId);
        const november = (await s.planned()).find((row) => row.competence === '2026-11');
        expect(november).toMatchObject({ status: 'planned', reconciledByTransactionId: null });
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  },
);
