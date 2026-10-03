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
 * Decisão nº 7: previsão cumprida vira `reconciled`. Estes testes cobrem os
 * consumidores de recorrência e de exclusão (§3.2 e §3.3) contra o PostgreSQL:
 * o `topUpPlanned` não regenera, o replan não toca, apagar o real reabre a
 * previsão, apagar a `reconciled` a dispensa.
 *
 * Household PRÓPRIO, apagado no `finally`. Requer as migrations 0005 e 0006.
 */

const TODAY = '2026-10-15';

async function modules() {
  const [{ db }, schema, del, recurring, write] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./transaction-delete'),
    import('./recurring'),
    import('./recurring-planned-write'),
  ]);
  return { db, schema, del, recurring, write };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function setup(m: Modules) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name: 'T-reconciled test' })
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

  const rule = {
    description: 'Conta de luz',
    expectedCents: cents(-18000),
    categoryId: leaf.id,
    dueDay: 5,
    frequency: 'monthly' as const,
    accountId: account.id,
    creditCardId: null,
    startsOn: '2026-10-01',
    endsOn: null,
    annualAdjustmentBp: null,
  };
  const expenseId = await m.recurring.createRecurringExpense(householdId, rule, TODAY);
  const rows = async () =>
    (
      await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.recurringExpenseId, expenseId))
    ).sort((x, y) => x.competence.localeCompare(y.competence));

  /** Cria um `posted` real e concilia a previsão da competência com ele. */
  const reconcile = async (competence: string) => {
    const planned = (await rows()).find((row) => row.competence === competence);
    if (planned === undefined) throw new Error(`Sem previsão de ${competence}.`);
    const [posted] = await db
      .insert(schema.transactions)
      .values({
        householdId,
        occurredOn: `${competence}-06`,
        competence,
        description: 'LUZ CIA',
        rawDescription: 'LUZ CIA',
        amountCents: -18000,
        kind: 'expense',
        status: 'posted',
        accountId: account.id,
        categoryId: leaf.id,
      })
      .returning({ id: schema.transactions.id });
    if (posted === undefined) throw new Error('Lançamento real não foi criado.');
    await db
      .update(schema.transactions)
      .set({ status: 'reconciled', reconciledByTransactionId: posted.id })
      .where(eq(schema.transactions.id, planned.id));
    return { plannedId: planned.id, postedId: posted.id };
  };
  return { householdId, expenseId, rule, rows, reconcile };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  // `reconciled_by_transaction_id` é RESTRICT: reabre tudo antes de apagar.
  await db.execute(
    sql`update transactions set status = 'planned', reconciled_by_transaction_id = null where household_id = ${householdId} and status = 'reconciled'`,
  );
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
  // Barulhento: se o household ainda existe, a limpeza falhou e o teste tem de falhar.
  const left = await db.select({ id: schema.households.id }).from(schema.households).where(eq(schema.households.id, householdId));
  if (left.length > 0) throw new Error(`Limpeza falhou: o household de teste ${householdId} continua no banco.`);
}

describe.skipIf(process.env.DATABASE_URL === undefined)(
  'previsão conciliada (reconciled) — recorrência e exclusão (banco real)',
  () => {
    it('topUpPlanned não regenera a previsão do mês já cumprida', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { plannedId } = await s.reconcile('2026-11');
        const before = await s.rows();
        await m.write.topUpPlanned(s.householdId, TODAY);
        await m.write.topUpPlanned(s.householdId, TODAY);
        const after = await s.rows();
        expect(after).toHaveLength(before.length);
        const november = after.filter((row) => row.competence === '2026-11');
        expect(november).toHaveLength(1);
        expect(november[0]?.id).toBe(plannedId);
        expect(november[0]?.status).toBe('reconciled');
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('editar a regra: a reconciled é imutável (mesmo valor, mesmo par); as planned futuras saem no valor novo', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { plannedId, postedId } = await s.reconcile('2026-11');
        await m.recurring.updateRecurringExpense(
          s.householdId,
          s.expenseId,
          { ...s.rule, expectedCents: cents(-22000) },
          TODAY,
        );
        const rows = await s.rows();
        const november = rows.filter((row) => row.competence === '2026-11');
        expect(november).toHaveLength(1);
        expect(november[0]).toMatchObject({
          id: plannedId,
          status: 'reconciled',
          reconciledByTransactionId: postedId,
          amountCents: -18000,
        });
        const december = rows.find((row) => row.competence === '2026-12');
        expect(december).toMatchObject({ status: 'planned', amountCents: -22000 });
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('apagar o REAL que cumpria: o impacto avisa, a previsão volta a planned (par nulo) e o real some', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { plannedId, postedId } = await s.reconcile('2026-11');

        const impact = await m.del.getDeleteImpact(s.householdId, postedId, 'only');
        expect(impact.effects).toContainEqual({
          kind: 'reopens_planned',
          ruleDescription: 'Conta de luz',
          competence: '2026-11',
        });

        await m.del.deleteTransaction(s.householdId, postedId, 'only');
        const [planned] = await m.db
          .select()
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.id, plannedId));
        expect(planned).toMatchObject({ status: 'planned', reconciledByTransactionId: null });
        const gone = await m.db
          .select({ id: m.schema.transactions.id })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.id, postedId));
        expect(gone).toHaveLength(0);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('sem reabrir, o RESTRICT barra o DELETE do real (esquecimento barulhento)', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { postedId } = await s.reconcile('2026-11');
        await expect(
          m.db.delete(m.schema.transactions).where(eq(m.schema.transactions.id, postedId)),
        ).rejects.toThrow();
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('apagar a RECONCILED: some, a ocorrência é dispensada, o top-up não a recria e o real continua', async () => {
      const m = await modules();
      const s = await setup(m);
      try {
        const { plannedId, postedId } = await s.reconcile('2026-11');

        const impact = await m.del.getDeleteImpact(s.householdId, plannedId, 'only');
        expect(impact.target.status).toBe('reconciled');
        expect(impact.effects).toContainEqual({
          kind: 'occurrence_skipped',
          ruleDescription: 'Conta de luz',
          competence: '2026-11',
        });
        expect(impact.effects.some((effect) => effect.kind === 'reopens_planned')).toBe(false);

        await m.del.deleteTransaction(s.householdId, plannedId, 'only');
        await m.write.topUpPlanned(s.householdId, TODAY);
        const competences = (await s.rows()).map((row) => row.competence);
        expect(competences).not.toContain('2026-11');
        const real = await m.db
          .select({ id: m.schema.transactions.id })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.id, postedId));
        expect(real).toHaveLength(1);
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  },
);
