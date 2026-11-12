import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { monthlyKpis } from '@/lib/finance/kpis';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

type Seed = {
  kind: 'expense' | 'income' | 'transfer' | 'credit_card_payment';
  amountCents: number;
  competence?: string;
  status?: 'posted' | 'planned' | 'reconciled';
  onCard?: boolean;
  categoryId?: string | null;
};

/**
 * Lançamentos por mês (Lote 2, itens 5 e 7) contra o banco real: filtros `competence`, `direction`,
 * `origin`, `countUncategorized` e o resumo do mês contra o motor do Painel. Households PRÓPRIOS,
 * apagados no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('lançamentos por mês', () => {
  async function setup(name: string) {
    const [{ db }, schema, queries, dashboard] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./transactions'),
      import('./dashboard'),
    ]);
    const [household] = await db.insert(schema.households).values({ name }).returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household não foi criado.');
    const householdId = household.id;
    const cleanup = () => db.delete(schema.households).where(eq(schema.households.id, householdId));
    try {
      const [account] = await db
        .insert(schema.accounts)
        .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: schema.accounts.id });
      const [card] = await db
        .insert(schema.creditCards)
        .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
        .returning({ id: schema.creditCards.id });
      const [category] = await db
        .insert(schema.categories)
        .values({ householdId, name: 'Mercado', parentId: null, nature: 'essential' })
        .returning({ id: schema.categories.id });
      if (account === undefined || card === undefined || category === undefined) throw new Error('Seed incompleto.');
      const seed = async (values: Seed): Promise<string> => {
        const competence = values.competence ?? '2026-11';
        // A previsão `reconciled` exige o lançamento real que a cumpriu (check do banco): nasce o gêmeo `posted`.
        const twin =
          values.status === 'reconciled'
            ? await seed({ ...values, status: 'posted', categoryId: category.id })
            : null;
        const [row] = await db
          .insert(schema.transactions)
          .values({
            householdId,
            rawDescription: 'x',
            description: 'x',
            accountId: values.onCard ? null : account.id,
            creditCardId: values.onCard ? card.id : null,
            occurredOn: `${competence}-03`,
            competence,
            cashDate: `${competence}-03`,
            amountCents: values.amountCents,
            kind: values.kind,
            status: values.status ?? 'posted',
            categoryId: values.categoryId ?? null,
            reconciledByTransactionId: twin,
          })
          .returning({ id: schema.transactions.id });
        if (row === undefined) throw new Error('Lançamento não foi criado.');
        return row.id;
      };
      return { queries, dashboard, householdId, category: category.id, seed, cleanup };
    } catch (error) {
      try {
        await cleanup();
      } catch {
        // Órfão cai na faxina de households de teste.
      }
      throw error;
    }
  }

  it('filtros competence, direction e origin recortam a lista; household alheio não aparece', async () => {
    const s = await setup('Lote2 filtros test');
    const other = await setup('Lote2 filtros test (outro)');
    try {
      const novAccountExpense = await s.seed({ kind: 'expense', amountCents: -1000 });
      const novCardExpense = await s.seed({ kind: 'expense', amountCents: -2000, onCard: true });
      const novIncome = await s.seed({ kind: 'income', amountCents: 5000 });
      const octExpense = await s.seed({ kind: 'expense', amountCents: -3000, competence: '2026-10' });
      await other.seed({ kind: 'expense', amountCents: -9999 });

      const ids = async (filters: Parameters<typeof s.queries.listTransactions>[1]) =>
        (await s.queries.listTransactions(s.householdId, filters)).map((row) => row.id).sort();
      const sorted = (...list: string[]) => [...list].sort();

      expect(await ids({})).toEqual(sorted(novAccountExpense, novCardExpense, novIncome, octExpense));
      expect(await ids({ competence: '2026-11' })).toEqual(sorted(novAccountExpense, novCardExpense, novIncome));
      expect(await ids({ competence: '2026-10' })).toEqual([octExpense]);
      expect(await ids({ competence: '2026-11', direction: 'expense' })).toEqual(sorted(novAccountExpense, novCardExpense));
      expect(await ids({ competence: '2026-11', direction: 'income' })).toEqual([novIncome]);
      expect(await ids({ competence: '2026-11', origin: 'card' })).toEqual([novCardExpense]);
      expect(await ids({ competence: '2026-11', origin: 'account' })).toEqual(sorted(novAccountExpense, novIncome));
      expect(await ids({ competence: '2026-11', direction: 'expense', origin: 'account' })).toEqual([novAccountExpense]);
      expect(await ids({ competence: '2027-01' })).toEqual([]);
    } finally {
      await s.cleanup();
      await other.cleanup();
    }
  });

  it('countUncategorized conta despesa e receita posted e planned de qualquer mês, ignora reconciled, categorizados, transferência, fatura e valor zero, e isola o household', async () => {
    const s = await setup('Lote2 contagem test');
    const other = await setup('Lote2 contagem test (outro)');
    try {
      expect(await s.queries.countUncategorized(s.householdId)).toBe(0);
      await s.seed({ kind: 'expense', amountCents: -100 });
      await s.seed({ kind: 'expense', amountCents: -100, competence: '2026-09' });
      await s.seed({ kind: 'expense', amountCents: -100, status: 'planned', competence: '2026-12' });
      await s.seed({ kind: 'expense', amountCents: -100, status: 'reconciled' });
      await s.seed({ kind: 'expense', amountCents: -100, categoryId: s.category });
      // Nunca têm categoria e a revisão não os lista: não entram, senão o botão não sumiria.
      await s.seed({ kind: 'transfer', amountCents: 200_000 });
      await s.seed({ kind: 'credit_card_payment', amountCents: -150_000 });
      await s.seed({ kind: 'expense', amountCents: 0 });
      await other.seed({ kind: 'expense', amountCents: -100 });
      await other.seed({ kind: 'expense', amountCents: -100 });
      expect(await s.queries.countUncategorized(s.householdId)).toBe(3);
      // O botão e a tela de revisão são o mesmo recorte: contagem = soma dos itens dos grupos.
      const { listReviewGroups } = await import('./review-groups');
      const groups = await listReviewGroups(s.householdId);
      expect(groups.reduce((total, group) => total + group.transactionIds.length, 0)).toBe(3);
      expect(await other.queries.countUncategorized(other.householdId)).toBe(2);
    } finally {
      await s.cleanup();
      await other.cleanup();
    }
  });

  it('getMonthSummary bate com monthlyKpis sobre o recorte do Painel; transferência, fatura, reconciliada e outro mês ficam de fora', async () => {
    const s = await setup('Lote2 resumo test');
    try {
      await s.seed({ kind: 'income', amountCents: 800_000 });
      await s.seed({ kind: 'expense', amountCents: -300_000, categoryId: s.category });
      await s.seed({ kind: 'expense', amountCents: -12_345, onCard: true });
      await s.seed({ kind: 'expense', amountCents: -50_000, status: 'planned' });
      await s.seed({ kind: 'transfer', amountCents: 200_000 });
      await s.seed({ kind: 'credit_card_payment', amountCents: -150_000 });
      await s.seed({ kind: 'expense', amountCents: -77_777, status: 'reconciled' });
      await s.seed({ kind: 'expense', amountCents: -99_999, competence: '2026-10' });

      const summary = await s.queries.getMonthSummary(s.householdId, '2026-11');
      const dash = await s.dashboard.getDashboardData(s.householdId, '2026-11-15', 3);
      const kpis = monthlyKpis({
        competence: '2026-11',
        transactions: dash.monthlyTransactions,
        futureInstallmentsCents: dash.futureInstallmentsCents,
        uncategorizedCount: dash.uncategorizedCount,
      });
      expect(summary.incomeCents).toBe(kpis.incomeCents);
      expect(summary.expenseCents).toBe(kpis.expenseCents);
      expect(summary.surplusCents).toBe(kpis.surplusCents);

      // Conferido à mão: receita 8.000,00; despesa 3.000,00 + 123,45 + 500,00 (prevista) + 777,77 (o lançamento
      // real que cumpriu a previsão; a previsão `reconciled` não conta em dobro) = 4.401,22.
      expect(summary.incomeCents).toBe(800_000);
      expect(summary.expenseCents).toBe(440_122);
      expect(summary.surplusCents).toBe(359_878);
    } finally {
      await s.cleanup();
    }
  });
});
