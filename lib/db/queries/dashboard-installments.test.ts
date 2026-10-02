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
    it('parcelas a vencer soma só parcela; comprometimento ignora previsão; painel e /cartoes no mesmo recorte', async () => {
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
          // Só para o comprometimento (janela 2026-10 .. 2028-09):
          { ...onCard, description: 'Geladeira 1/2', occurredOn: '2026-09-20', competence: '2026-10', amountCents: -500, kind: 'expense', status: 'posted', installmentPlanId: plan.id, installmentNumber: 1 },
          // Compra de agosto na fatura de outubro: o recorte é a competência, não a data.
          { ...onCard, description: 'À vista lançada', occurredOn: '2026-08-30', competence: '2026-10', amountCents: -2_000, kind: 'expense', status: 'posted' },
          { ...onCard, description: 'planned avulsa no cartão', occurredOn: '2026-12-01', competence: '2026-12', amountCents: -777, kind: 'expense', status: 'planned' },
          { ...onCard, description: 'depois da janela', occurredOn: '2028-10-01', competence: '2028-10', amountCents: -3, kind: 'expense', status: 'posted' },
          { ...onCard, description: 'antes da janela', occurredOn: '2026-09-01', competence: '2026-09', amountCents: -4, kind: 'expense', status: 'posted' },
          // A3: pagamento de fatura e transferência com credit_card_id (dado errado,
          // mas possível) NÃO são comprometimento, nem como parcela.
          { ...onCard, description: 'pagamento errado no cartão', occurredOn: '2026-10-05', competence: '2026-10', amountCents: -50_000, kind: 'credit_card_payment', status: 'posted' },
          { ...onCard, description: 'transfer errada no cartão', occurredOn: '2026-10-05', competence: '2026-10', amountCents: -60_000, kind: 'transfer', status: 'posted' },
        ]);

        const dashboard = await queries.getDashboardData(householdId, '2026-10-10', 24);
        expect(dashboard.futureInstallmentsCents).toBe(-500);

        const summed = await queries.sumFutureInstallments(householdId, '2026-10-10', 24);
        expect(summed).toBe(-500);

        // Comprometimento: parcelas (qualquer status) + o já lançado; sem previsão
        // de despesa fixa nem `planned` avulsa. E o painel usa o MESMO recorte.
        const commitment = await queries.listCommitmentTransactions(householdId, '2026-10', 24);
        const sum = (rows: { amountCents: number }[]) => rows.reduce((total, row) => total + row.amountCents, 0);
        expect(sum(commitment)).toBe(-3_000);
        expect(commitment).toHaveLength(3);
        const key = (row: { competence: string; amountCents: number; status: string }) =>
          `${row.competence}|${row.amountCents}|${row.status}`;
        expect(dashboard.commitmentTransactions.map(key).sort()).toEqual(commitment.map(key).sort());
      } finally {
        // Transações primeiro: `transactions.credit_card_id` é RESTRICT, e a ordem
        // do cascade a partir de `households` não é garantida.
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });

    /**
     * A1 do Corvo: a janela do comprometimento é `household_settings.commitment_months`
     * (SPEC §5.8), não 24 fixo. As duas telas fazem exatamente isto: `getSettings` →
     * `getDashboardData` (painel) e `getSettings` → `listCommitmentTransactions`
     * (`/cartoes`). Com o setting em 12 elas têm de somar o mesmo, e a linha de
     * 2027-10 (13º mês) fica fora das duas.
     */
    it('com commitment_months = 12 o painel e /cartoes somam o mesmo recorte', async () => {
      const [{ db }, schema, queries, { getSettings }] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
        import('./settings'),
      ]);
      const { creditCards, households, householdSettings, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'Comprometimento janela configuravel test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;

      try {
        await db.insert(householdSettings).values({ householdId, commitmentMonths: 12 });
        const [card] = await db
          .insert(creditCards)
          .values({ householdId, name: 'Cartão teste', closingDay: 1, dueDay: 10 })
          .returning({ id: creditCards.id });
        if (card === undefined) throw new Error('Fixture não foi criada.');
        const onCard = { householdId, rawDescription: '', creditCardId: card.id, kind: 'expense', status: 'posted' } as const;
        await db.insert(transactions).values([
          { ...onCard, description: 'mês corrente', occurredOn: '2026-10-02', competence: '2026-10', amountCents: -100 },
          { ...onCard, description: '12º mês', occurredOn: '2027-09-02', competence: '2027-09', amountCents: -200 },
          { ...onCard, description: '13º mês (fora)', occurredOn: '2027-10-02', competence: '2027-10', amountCents: -400 },
        ]);

        const { commitmentMonths } = await getSettings(householdId);
        expect(commitmentMonths).toBe(12);

        const dashboard = await queries.getDashboardData(householdId, '2026-10-10', commitmentMonths);
        const cards = await queries.listCommitmentTransactions(householdId, '2026-10', commitmentMonths);
        const total = (rows: { amountCents: number }[]) => rows.reduce((sum, row) => sum + row.amountCents, 0);
        expect(total(cards)).toBe(-300);
        expect(total(dashboard.commitmentTransactions)).toBe(-300);
      } finally {
        await db.delete(transactions).where(eq(transactions.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });
  },
);
