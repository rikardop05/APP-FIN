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
 * Decisão nº 7, §3.1: uma previsão `reconciled` (cumprida por um `posted`) não é
 * nem prevista nem realizada. Nenhuma leitura de dinheiro pode mudar por ela existir.
 *
 * Método: fixture com previsões e lançamentos reais; lê TUDO; insere as `reconciled`
 * (uma de conta, uma de cartão, uma receita) e lê de novo; o resultado tem de ser
 * idêntico. Household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'leituras de dinheiro ignoram previsão reconciled',
  () => {
    it('dashboard, painel, orçamento e fluxo dão o mesmo resultado com e sem reconciled', async () => {
      const [{ db }, schema, dashboard, cashflow, budgetsQ] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
        import('./cashflow'),
        import('./budgets'),
      ]);
      const { accounts, budgets, categories, creditCards, households, householdSettings, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'Reconciled leituras test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;
      const today = '2026-10-10';

      try {
        await db.insert(householdSettings).values({ householdId, commitmentMonths: 12 });
        const [account] = await db
          .insert(accounts)
          .values({ householdId, name: 'Conta', kind: 'checking', openingBalanceCents: 100_000, openingDate: '2026-01-01' })
          .returning({ id: accounts.id });
        const [root] = await db
          .insert(categories)
          .values({ householdId, name: 'Raiz', parentId: null, nature: 'essential' })
          .returning({ id: categories.id });
        if (account === undefined || root === undefined) throw new Error('Fixture não foi criada.');
        const [leaf] = await db
          .insert(categories)
          .values({ householdId, name: 'Folha', parentId: root.id, nature: 'essential' })
          .returning({ id: categories.id });
        const [card] = await db
          .insert(creditCards)
          .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
          .returning({ id: creditCards.id });
        if (leaf === undefined || card === undefined) throw new Error('Fixture não foi criada.');
        await db.insert(budgets).values({ householdId, period: '2026-10', categoryId: leaf.id, plannedCents: 50_000 });

        const acc = { householdId, rawDescription: '', accountId: account.id, categoryId: leaf.id } as const;
        const onCard = { householdId, rawDescription: '', creditCardId: card.id, categoryId: leaf.id } as const;
        const base = await db
          .insert(transactions)
          .values([
            // Reais.
            { ...acc, description: 'Luz paga', occurredOn: '2026-10-05', competence: '2026-10', cashDate: '2026-10-05', amountCents: -10_000, kind: 'expense', status: 'posted' },
            { ...acc, description: 'Salário recebido', occurredOn: '2026-10-06', competence: '2026-10', cashDate: '2026-10-06', amountCents: 300_000, kind: 'income', status: 'posted' },
            { ...onCard, description: 'Mercado', occurredOn: '2026-10-07', competence: '2026-10', cashDate: '2026-10-20', amountCents: -7_000, kind: 'expense', status: 'posted' },
            // Previsão genuína, ainda em aberto (não pode sumir).
            { ...acc, description: 'Internet prevista', occurredOn: '2026-10-28', competence: '2026-10', cashDate: '2026-10-28', amountCents: -12_000, kind: 'expense', status: 'planned' },
          ])
          .returning({ id: transactions.id, description: transactions.description });
        const byDescription = (d: string) => {
          const found = base.find((row) => row.description === d);
          if (found === undefined) throw new Error(`Fixture sem ${d}.`);
          return found.id;
        };

        const readAll = async () => ({
          dash: await dashboard.getDashboardData(householdId, today, 12),
          series: await dashboard.listIncomeExpenseRows(householdId, today, 3),
          commitment: await dashboard.listCommitmentTransactions(householdId, '2026-10', 12),
          uncategorizedIds: await dashboard.listUncategorizedTransactionIds(householdId, today),
          uncategorizedItems: await dashboard.listUncategorizedTransactionItems(householdId, today),
          overdue: await dashboard.listOverdueRecurring(householdId, today, 10),
          budget: await budgetsQ.getBudgetMonth(householdId, '2026-10'),
          flow: await cashflow.getCashflowData(householdId, today, 6),
        });

        const before = await readAll();

        // As previsões cumpridas: mesmas datas/valores/categoria dos reais, com o par gravado.
        await db.insert(transactions).values([
          { ...acc, description: 'Luz prevista', occurredOn: '2026-10-04', competence: '2026-10', cashDate: '2026-10-04', amountCents: -10_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: byDescription('Luz paga') },
          { ...acc, description: 'Salário previsto', occurredOn: '2026-10-05', competence: '2026-10', cashDate: '2026-10-05', amountCents: 300_000, kind: 'income', status: 'reconciled', reconciledByTransactionId: byDescription('Salário recebido') },
          { ...onCard, description: 'Mercado previsto', occurredOn: '2026-10-06', competence: '2026-10', cashDate: '2026-10-20', amountCents: -7_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: byDescription('Mercado') },
          // Sem categoria: não pode entrar em pendências.
          { householdId, rawDescription: '', accountId: account.id, description: 'Sem categoria prevista', occurredOn: '2026-10-03', competence: '2026-10', cashDate: '2026-10-03', amountCents: -1_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: byDescription('Luz paga') },
        ]);

        const after = await readAll();
        expect(after).toEqual(before);

        // Guarda de sanidade: a fixture de fato produz números (o teste não passa vazio).
        expect(before.commitment).toHaveLength(1);
        expect(before.flow.rows.length).toBeGreaterThan(0);
        expect(before.series.length).toBeGreaterThan(0);
      } finally {
        // `reconciled_by_transaction_id` é RESTRICT: as previsões cumpridas saem antes dos reais.
        await db
          .delete(transactions)
          .where(and(eq(transactions.householdId, householdId), eq(transactions.status, 'reconciled')));
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });
  },
);
