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
 * Decisão 16a do Ricardo (2026-10-08): lançamento MANUAL que cumpre uma previsão. O app
 * SUGERE a previsão compatível (o mesmo `matchPlannedToPosted` da importação) e só concilia
 * se a pessoa confirmar; nunca sozinho. Banco real, household PRÓPRIO apagado no `finally`,
 * com a checagem barulhenta de que sumiu.
 */

const TODAY = '2026-10-15';

async function modules() {
  const [{ db }, schema, manual, transactions, recurring] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./manual-reconcile'),
    import('./transactions'),
    import('./recurring'),
  ]);
  return { db, schema, manual, transactions, recurring };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function setup(m: Modules, name = 'T-16a manual test') {
  const { db, schema } = m;
  const [household] = await db.insert(schema.households).values({ name }).returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;
  await db.insert(schema.householdSettings).values({ householdId, projectionMonths: 6 });
  const [card] = await db.insert(schema.creditCards).values({ householdId, name: 'Cartão', closingDay: 25, dueDay: 5 }).returning({ id: schema.creditCards.id });
  const [account] = await db.insert(schema.accounts).values({ householdId, name: 'Conta X', kind: 'checking', openingDate: '2026-01-01' }).returning({ id: schema.accounts.id });
  const [otherAccount] = await db.insert(schema.accounts).values({ householdId, name: 'Conta Y', kind: 'checking', openingDate: '2026-01-01' }).returning({ id: schema.accounts.id });
  const [root] = await db.insert(schema.categories).values({ householdId, name: 'Moradia teste', parentId: null, nature: 'essential' }).returning({ id: schema.categories.id });
  if (card === undefined || account === undefined || otherAccount === undefined || root === undefined) throw new Error('Seed incompleto.');
  const [luz] = await db.insert(schema.categories).values({ householdId, name: 'Luz teste', parentId: root.id, nature: 'essential' }).returning({ id: schema.categories.id });
  const [agua] = await db.insert(schema.categories).values({ householdId, name: 'Água teste', parentId: root.id, nature: 'essential' }).returning({ id: schema.categories.id });
  const [member] = await db.insert(schema.members).values({ householdId, name: 'Pessoa', email: `t16a-${householdId}@example.test`, color: '#000000' }).returning({ id: schema.members.id });
  if (luz === undefined || agua === undefined || member === undefined) throw new Error('Seed incompleto.');

  const expenseId = await m.recurring.createRecurringExpense(
    householdId,
    {
      description: 'Conta de luz',
      expectedCents: cents(-18000),
      categoryId: luz.id,
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
  const incomeId = await m.recurring.createIncome(
    householdId,
    {
      description: 'Salário',
      kind: 'salary',
      expectedCents: cents(740000),
      memberId: member.id,
      accountId: account.id,
      receiveDay: 5,
      frequency: 'monthly',
      oneOffCompetence: null,
      startsOn: '2026-10-01',
      endsOn: null,
    },
    TODAY,
  );
  const plannedOf = async (origin: 'expense' | 'income', competence: string) => {
    const column = origin === 'expense' ? schema.transactions.recurringExpenseId : schema.transactions.incomeId;
    const rows = await db.select().from(schema.transactions).where(eq(column, origin === 'expense' ? expenseId : incomeId));
    const row = rows.find((item) => item.competence === competence);
    if (row === undefined) throw new Error(`Sem previsão de ${competence}.`);
    return row;
  };
  const expenseDraft = (patch: Record<string, unknown> = {}) => ({
    occurredOn: '2026-11-06',
    description: 'Luz paga no Pix',
    amountCents: cents(-18500),
    kind: 'expense' as const,
    categoryId: luz.id,
    accountId: account.id,
    creditCardId: null,
    memberId: null,
    note: null,
    ...patch,
  });
  return { householdId, cardId: card.id, accountId: account.id, otherAccountId: otherAccount.id, luz: luz.id, agua: agua.id, plannedOf, expenseDraft };
}

async function cleanup(m: Modules, householdId: string) {
  await m.db.execute(
    sql`update transactions set status = 'planned', reconciled_by_transaction_id = null where household_id = ${householdId} and status = 'reconciled'`,
  );
  await m.db.delete(m.schema.transactions).where(eq(m.schema.transactions.householdId, householdId));
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
  const left = await m.db.select({ id: m.schema.households.id }).from(m.schema.households).where(eq(m.schema.households.id, householdId));
  if (left.length > 0) throw new Error(`Limpeza falhou: o household de teste ${householdId} continua no banco.`);
}

describe.skipIf(process.env.DATABASE_URL === undefined)('lançamento manual que cumpre uma previsão (banco real)', () => {
  it('sugere a previsão compatível (despesa por categoria, receita por conta) e nada fora dela', async () => {
    const m = await modules();
    const s = await setup(m);
    try {
      const november = await s.plannedOf('expense', '2026-11');
      // 185,00 no dia 06 contra 180,00 previsto no dia 05: 2,8 %, 1 dia.
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft())).toEqual({
        plannedId: november.id,
        description: 'Conta de luz',
        occurredOn: '2026-11-05',
        amountCents: -18000,
      });
      // Outra categoria, valor fora dos 10 %, data fora dos 5 dias, tipo que não concilia: nada.
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft({ categoryId: s.agua }))).toBeNull();
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft({ amountCents: cents(-30000) }))).toBeNull();
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft({ occurredOn: '2026-11-20' }))).toBeNull();
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft({ kind: 'transfer' }))).toBeNull();
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft({ categoryId: null }))).toBeNull();

      // Receita: casa pela CONTA onde cai (a previsão de receita não tem categoria).
      const salary = await s.plannedOf('income', '2026-11');
      const incomeDraft = s.expenseDraft({ kind: 'income', amountCents: cents(740000), categoryId: null, occurredOn: '2026-11-07' });
      expect((await m.manual.suggestPlannedForManual(s.householdId, incomeDraft))?.plannedId).toBe(salary.id);
      expect(await m.manual.suggestPlannedForManual(s.householdId, { ...incomeDraft, accountId: s.otherAccountId })).toBeNull();
    } finally {
      await cleanup(m, s.householdId);
    }
  }, 30_000);

  it('confirmado: grava o real e a previsão vira reconciled apontando para ele; recusado: grava normal', async () => {
    const m = await modules();
    const s = await setup(m);
    try {
      const november = await s.plannedOf('expense', '2026-11');
      const id = await m.transactions.createManualTransaction(s.householdId, s.expenseDraft(), { reconcilePlannedId: november.id });
      expect(await s.plannedOf('expense', '2026-11')).toMatchObject({ status: 'reconciled', reconciledByTransactionId: id });
      // A cumprida não é mais sugerida.
      expect(await m.manual.suggestPlannedForManual(s.householdId, s.expenseDraft())).toBeNull();

      // Despesa paga no CARTÃO (sem conta): casa pela categoria, como na importação.
      const january = await s.plannedOf('expense', '2027-01');
      const onCard = s.expenseDraft({ occurredOn: '2027-01-04', accountId: null, creditCardId: s.cardId });
      expect((await m.manual.suggestPlannedForManual(s.householdId, onCard))?.plannedId).toBe(january.id);
      const cardId = await m.transactions.createManualTransaction(s.householdId, onCard, { reconcilePlannedId: january.id });
      expect(await s.plannedOf('expense', '2027-01')).toMatchObject({ status: 'reconciled', reconciledByTransactionId: cardId });

      // Recusado (sem reconcilePlannedId): grava normal, a previsão de dezembro fica planned.
      const december = await s.plannedOf('expense', '2026-12');
      await m.transactions.createManualTransaction(s.householdId, s.expenseDraft({ occurredOn: '2026-12-05' }));
      expect((await s.plannedOf('expense', '2026-12')).status).toBe('planned');
      expect(december.status).toBe('planned');
    } finally {
      await cleanup(m, s.householdId);
    }
  }, 30_000);

  it('previsão que não cabe mais (já cumprida, incompatível ou de outra casa): recusa e não grava nada', async () => {
    const m = await modules();
    const s = await setup(m);
    const other = await setup(m, 'T-16a manual test (outra casa)');
    try {
      const november = await s.plannedOf('expense', '2026-11');
      const countReal = async () =>
        (await m.db.select({ id: m.schema.transactions.id }).from(m.schema.transactions).where(eq(m.schema.transactions.householdId, s.householdId))).filter(
          Boolean,
        ).length;
      const before = await countReal();

      // Incompatível com o lançamento (outra categoria): não é a previsão que ele cumpre.
      const wrong = await m.transactions
        .createManualTransaction(s.householdId, s.expenseDraft({ categoryId: s.agua }), { reconcilePlannedId: november.id })
        .catch((error: unknown) => error);
      expect(wrong).toBeInstanceOf(m.manual.PlannedNotReconcilableError);
      expect((wrong as Error).message).toBe(
        'Essa previsão não pode mais ser marcada como cumprida por este lançamento (já foi cumprida, mudou ou não combina). Nada foi gravado: lance à parte ou feche e confira a previsão.',
      );
      // De outra casa.
      const foreign = await other.plannedOf('expense', '2026-11');
      const cross = await m.transactions
        .createManualTransaction(s.householdId, s.expenseDraft(), { reconcilePlannedId: foreign.id })
        .catch((error: unknown) => error);
      expect(cross).toBeInstanceOf(m.manual.PlannedNotReconcilableError);
      expect(await countReal()).toBe(before);
      expect((await s.plannedOf('expense', '2026-11')).status).toBe('planned');

      // Já cumprida por outro lançamento: o segundo não a reivindica.
      await m.transactions.createManualTransaction(s.householdId, s.expenseDraft(), { reconcilePlannedId: november.id });
      const twice = await m.transactions
        .createManualTransaction(s.householdId, s.expenseDraft({ occurredOn: '2026-11-07' }), { reconcilePlannedId: november.id })
        .catch((error: unknown) => error);
      expect(twice).toBeInstanceOf(m.manual.PlannedNotReconcilableError);
      expect(await countReal()).toBe(before + 1);
    } finally {
      await cleanup(m, s.householdId);
      await cleanup(m, other.householdId);
    }
  }, 30_000);
});
