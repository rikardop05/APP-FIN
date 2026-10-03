import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * T-305: a média de despesa essencial, o saldo da conta vinculada e as regras de
 * gravação, contra o SQL real. Household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('metas contra o banco real', () => {
  it('média essencial (3 meses fechados, só expense essencial, sem reconciled), saldo vinculado e reserva única', async () => {
    const [{ db }, schema, queries, { loadGoalsResponse }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./goals'),
      import('@/app/api/goals/load'),
    ]);
    const { accounts, categories, goals, households, householdSettings, transactions } = schema;
    const today = '2026-10-02';

    const [household] = await db
      .insert(households)
      .values({ name: 'T-305 metas test' })
      .returning({ id: households.id });
    const [other] = await db
      .insert(households)
      .values({ name: 'T-305 metas test (outra casa)' })
      .returning({ id: households.id });
    if (household === undefined || other === undefined) throw new Error('Household não foi criado.');
    const householdId = household.id;

    try {
      await db.insert(householdSettings).values({ householdId, emergencyFundMonths: 6 });
      const [account] = await db
        .insert(accounts)
        .values({ householdId, name: 'Poupança', kind: 'savings', openingBalanceCents: 100_000, openingDate: '2026-01-01' })
        .returning({ id: accounts.id });
      const [linked] = await db
        .insert(accounts)
        .values({ householdId, name: 'Reserva', kind: 'savings', openingBalanceCents: 100_000, openingDate: '2026-01-01' })
        .returning({ id: accounts.id });
      const [foreign] = await db
        .insert(accounts)
        .values({ householdId: other.id, name: 'Conta alheia', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: accounts.id });
      const [essential] = await db
        .insert(categories)
        .values({ householdId, name: 'Moradia', parentId: null, nature: 'essential' })
        .returning({ id: categories.id });
      const [lazer] = await db
        .insert(categories)
        .values({ householdId, name: 'Lazer', parentId: null, nature: 'non_essential' })
        .returning({ id: categories.id });
      if (account === undefined || linked === undefined || foreign === undefined || essential === undefined || lazer === undefined) {
        throw new Error('Fixture não foi criada.');
      }

      const row = { householdId, rawDescription: '', accountId: account.id } as const;
      const first = await db
        .insert(transactions)
        .values({ ...row, description: 'Aluguel', categoryId: essential.id, occurredOn: '2026-09-05', competence: '2026-09', cashDate: '2026-09-05', amountCents: -100_000, kind: 'expense', status: 'posted' })
        .returning({ id: transactions.id });
      const real = first[0];
      if (real === undefined) throw new Error('Fixture não foi criada.');
      await db.insert(transactions).values([
        // Não entram na média essencial:
        { ...row, description: 'Cinema', categoryId: lazer.id, occurredOn: '2026-09-06', competence: '2026-09', cashDate: '2026-09-06', amountCents: -50_000, kind: 'expense', status: 'posted' },
        { ...row, description: 'Aluguel previsto (cumprido)', categoryId: essential.id, occurredOn: '2026-09-04', competence: '2026-09', cashDate: '2026-09-04', amountCents: -80_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: real.id },
        { ...row, description: 'Pagamento de fatura', categoryId: essential.id, occurredOn: '2026-09-07', competence: '2026-09', cashDate: '2026-09-07', amountCents: -999, kind: 'credit_card_payment', status: 'posted' },
        // Ago: só receita (mês COM histórico, essencial = 0). Jul: nada (mês sem histórico, fora da média).
        { ...row, description: 'Salário', occurredOn: '2026-08-05', competence: '2026-08', cashDate: '2026-08-05', amountCents: 300_000, kind: 'income', status: 'posted' },
        // Mês corrente e anterior à janela: fora.
        { ...row, description: 'Corrente', categoryId: essential.id, occurredOn: '2026-10-01', competence: '2026-10', cashDate: '2026-10-01', amountCents: -777_777, kind: 'expense', status: 'posted' },
        { ...row, description: 'Antigo', categoryId: essential.id, occurredOn: '2026-06-01', competence: '2026-06', cashDate: '2026-06-01', amountCents: -555_555, kind: 'expense', status: 'posted' },
        // Saldo da conta vinculada (hoje = 02/10): +50.000 em 10/09 entra; futuro e planned não.
        { ...row, accountId: linked.id, description: 'Rendimento', occurredOn: '2026-09-10', competence: '2026-09', cashDate: '2026-09-10', amountCents: 50_000, kind: 'income', status: 'posted' },
        { ...row, accountId: linked.id, description: 'Futuro', occurredOn: '2026-10-05', competence: '2026-10', cashDate: '2026-10-05', amountCents: -20_000, kind: 'expense', status: 'posted' },
        { ...row, accountId: linked.id, description: 'Previsto', occurredOn: '2026-10-01', competence: '2026-10', cashDate: '2026-10-01', amountCents: -1_111, kind: 'expense', status: 'planned' },
      ]);

      const average = await queries.getEssentialAverageData(householdId, today);
      expect(average.from).toBe('2026-07');
      expect(average.to).toBe('2026-09');
      // Ago (0) e set (-100.000 de aluguel). `reconciled`, lazer e pagamento de fatura ficam de fora.
      expect(average.months).toEqual([
        { competence: '2026-08', expenseNetCents: 0 },
        { competence: '2026-09', expenseNetCents: -100_000 },
      ]);

      // Reserva: média (0 + 100.000) / 2 = 50.000; 6 meses = 300.000.
      await queries.createGoal(householdId, {
        name: 'Reserva',
        targetCents: 0 as never,
        targetDate: null,
        currentCents: 0 as never,
        accountId: linked.id,
        priority: 1,
        status: 'active',
        isEmergencyFund: true,
      });
      await queries.createGoal(householdId, {
        name: 'Viagem',
        targetCents: 120_000 as never,
        targetDate: '2027-02-10',
        currentCents: 30_000 as never,
        accountId: null,
        priority: 50,
        status: 'active',
        isEmergencyFund: false,
      });

      const loaded = await loadGoalsResponse(householdId, today);
      expect(loaded.emergency).toMatchObject({
        months: 6,
        averageCents: 50_000,
        monthsWithData: 2,
        targetCents: 300_000,
        exists: true,
      });
      const [reserve, trip] = loaded.goals;
      // Saldo vinculado: 100.000 + 50.000 = 150.000 (futuro e planned fora).
      expect(reserve).toMatchObject({ name: 'Reserva', currentCents: 150_000, targetCents: 300_000 });
      expect(reserve?.progress?.progressBp).toBe(5000);
      // Viagem: faltam 90.000, out/2026 -> fev/2027 = 4 meses, 22.500/mês.
      expect(trip?.progress).toMatchObject({
        progressBp: 2500,
        remainingCents: 90_000,
        monthsRemaining: 4,
        requiredMonthlyCents: 22_500,
        onTrack: true,
      });

      // Só uma reserva por household.
      await expect(
        queries.createGoal(householdId, {
          name: 'Outra reserva',
          targetCents: 0 as never,
          targetDate: null,
          currentCents: 0 as never,
          accountId: null,
          priority: 2,
          status: 'active',
          isEmergencyFund: true,
        }),
      ).rejects.toBeInstanceOf(queries.EmergencyFundExistsError);

      // Conta de outra casa é recusada.
      await expect(
        queries.createGoal(householdId, {
          name: 'Com conta alheia',
          targetCents: 1_000 as never,
          targetDate: null,
          currentCents: 0 as never,
          accountId: foreign.id,
          priority: 3,
          status: 'active',
          isEmergencyFund: false,
        }),
      ).rejects.toBeInstanceOf(queries.GoalReferenceError);

      // Meta cancelada some da lista; excluir de outra casa não acha.
      const [viagem] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.householdId, householdId), eq(goals.name, 'Viagem')));
      if (viagem === undefined) throw new Error('Meta não encontrada.');
      await expect(queries.deleteGoal(other.id, viagem.id)).rejects.toBeInstanceOf(queries.GoalNotFoundError);
      await queries.deleteGoal(householdId, viagem.id);
      expect((await queries.listGoals(householdId, today)).map((goal) => goal.name)).toEqual(['Reserva']);
    } finally {
      await db.delete(transactions).where(and(eq(transactions.householdId, householdId), eq(transactions.status, 'reconciled')));
      await db.delete(transactions).where(eq(transactions.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(households).where(eq(households.id, other.id));
    }
  });

  it('histórico sem despesa essencial: média 0 (verdadeira), alvo 0 e sem progresso', async () => {
    const [{ db }, schema, queries, { loadGoalsResponse }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./goals'),
      import('@/app/api/goals/load'),
    ]);
    const [household] = await db
      .insert(schema.households)
      .values({ name: 'T-305 metas media zero test' })
      .returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household não foi criado.');
    try {
      await db.insert(schema.householdSettings).values({ householdId: household.id });
      const [account] = await db
        .insert(schema.accounts)
        .values({ householdId: household.id, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: schema.accounts.id });
      if (account === undefined) throw new Error('Fixture não foi criada.');
      await db.insert(schema.transactions).values({
        householdId: household.id,
        rawDescription: '',
        accountId: account.id,
        description: 'Salário',
        occurredOn: '2026-09-05',
        competence: '2026-09',
        cashDate: '2026-09-05',
        amountCents: 300_000,
        kind: 'income',
        status: 'posted',
      });
      await queries.createGoal(household.id, {
        name: 'Reserva',
        targetCents: 0 as never,
        targetDate: null,
        currentCents: 0 as never,
        accountId: null,
        priority: 1,
        status: 'active',
        isEmergencyFund: true,
      });
      const loaded = await loadGoalsResponse(household.id, '2026-10-02');
      expect(loaded.emergency).toMatchObject({ averageCents: 0, targetCents: 0, monthsWithData: 1 });
      expect(loaded.goals[0]).toMatchObject({ targetCents: 0, progress: null });
    } finally {
      await db.delete(schema.transactions).where(eq(schema.transactions.householdId, household.id));
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    }
  });

  it('sem histórico: a reserva não tem alvo (null), nunca R$ 0,00 de mentira', async () => {
    const [{ db }, schema, queries, { loadGoalsResponse }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./goals'),
      import('@/app/api/goals/load'),
    ]);
    const [household] = await db
      .insert(schema.households)
      .values({ name: 'T-305 metas vazia test' })
      .returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household não foi criado.');
    try {
      await db.insert(schema.householdSettings).values({ householdId: household.id });
      await queries.createGoal(household.id, {
        name: 'Reserva',
        targetCents: 0 as never,
        targetDate: null,
        currentCents: 0 as never,
        accountId: null,
        priority: 1,
        status: 'active',
        isEmergencyFund: true,
      });
      const loaded = await loadGoalsResponse(household.id, '2026-10-02');
      expect(loaded.emergency.averageCents).toBeNull();
      expect(loaded.emergency.targetCents).toBeNull();
      expect(loaded.goals[0]).toMatchObject({ targetCents: null, progress: null });
    } finally {
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    }
  });
});
