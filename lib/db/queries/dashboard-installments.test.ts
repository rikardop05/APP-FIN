import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * "Parcelas a vencer" soma SÓ parcela (linha com `installment_plan_id`), nunca a
 * previsão de despesa fixa no mesmo cartão nem a `planned` avulsa. Integração de
 * propósito: o recorte é um predicado SQL. Household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'getDashboardData: parcelas a vencer contra o banco real',
  () => {
    it('soma a parcela futura e ignora a despesa fixa planejada', async () => {
      const [{ db }, schema, queries] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
      ]);
      const {
        accounts,
        categories,
        creditCards,
        households,
        installmentPlans,
        recurringExpenses,
        transactions,
      } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'Parcelas a vencer query test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;

      try {
        const [account] = await db
          .insert(accounts)
          .values({ householdId, name: 'Conta teste', kind: 'checking', openingDate: '2026-01-01' })
          .returning({ id: accounts.id });
        const [category] = await db
          .insert(categories)
          .values({ householdId, name: 'Assinaturas teste', parentId: null, nature: 'non_essential' })
          .returning({ id: categories.id });
        const [card] = await db
          .insert(creditCards)
          .values({ householdId, name: 'Cartão teste', closingDay: 1, dueDay: 10 })
          .returning({ id: creditCards.id });
        if (account === undefined || category === undefined || card === undefined) {
          throw new Error('Fixture não foi criada.');
        }
        const [plan] = await db
          .insert(installmentPlans)
          .values({
            householdId,
            creditCardId: card.id,
            description: 'Geladeira teste',
            totalCents: -1_000,
            installmentsCount: 2,
            firstCompetence: '2026-10',
            source: 'manual',
          })
          .returning({ id: installmentPlans.id });
        const [rule] = await db
          .insert(recurringExpenses)
          .values({
            householdId,
            description: 'Streaming teste',
            expectedCents: -18_000,
            categoryId: category.id,
            dueDay: 10,
            creditCardId: card.id,
            startsOn: '2026-01-01',
          })
          .returning({ id: recurringExpenses.id });
        if (plan === undefined || rule === undefined) throw new Error('Plano/regra não foi criado.');

        const onCard = { householdId, rawDescription: '', creditCardId: card.id } as const;
        await db.insert(transactions).values([
          // today = 2026-10-10 → janela 2026-11 .. 2028-10 (commitmentMonths = 24).
          { ...onCard, description: 'Geladeira 2/2', occurredOn: '2026-09-20', competence: '2026-11', amountCents: -500, kind: 'expense', status: 'planned', installmentPlanId: plan.id, installmentNumber: 2 },
          { ...onCard, description: 'Streaming previsto', occurredOn: '2026-11-10', competence: '2026-11', amountCents: -18_000, kind: 'expense', status: 'planned', recurringExpenseId: rule.id },
          { householdId, rawDescription: '', accountId: account.id, description: 'planned avulsa', occurredOn: '2026-12-01', competence: '2026-12', amountCents: -999, kind: 'expense', status: 'planned' },
        ]);

        const dashboard = await queries.getDashboardData(householdId, '2026-10-10', 24);
        expect(dashboard.futureInstallmentsCents).toBe(-500);

        const summed = await queries.sumFutureInstallments(householdId, '2026-10-10', 24);
        expect(summed).toBe(-500);
      } finally {
        // Transações primeiro: `transactions.credit_card_id` é RESTRICT, e a ordem
        // do cascade a partir de `households` não é garantida.
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });
  },
);
