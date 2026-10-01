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
 * Integração de propósito: a fronteira "vencida = data ANTERIOR a hoje" e a janela
 * de 12 competências só são provadas contra o SQL real. Household PRÓPRIO,
 * apagado no `finally` (disciplina do banco único, 2026-09-30).
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'consultas do T-208 contra o banco real',
  () => {
    it('listIncomeExpenseRows recorta 12 competências até a corrente; listOverdueRecurring usa DATA, não mês', async () => {
      const [{ db }, schema, queries] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
      ]);
      const { accounts, categories, households, recurringExpenses, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'T-208 dashboard query test' })
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
          .values({ householdId, name: 'Moradia teste', parentId: null, nature: 'essential' })
          .returning({ id: categories.id });
        if (account === undefined || category === undefined) throw new Error('Fixture não foi criada.');
        const [rule] = await db
          .insert(recurringExpenses)
          .values({
            householdId,
            description: 'Luz teste',
            expectedCents: -18_000,
            categoryId: category.id,
            dueDay: 5,
            accountId: account.id,
            startsOn: '2026-01-01',
          })
          .returning({ id: recurringExpenses.id });
        const [ruleToday] = await db
          .insert(recurringExpenses)
          .values({
            householdId,
            description: 'Internet teste',
            expectedCents: -18_000,
            categoryId: category.id,
            dueDay: 10,
            accountId: account.id,
            startsOn: '2026-01-01',
          })
          .returning({ id: recurringExpenses.id });
        if (rule === undefined || ruleToday === undefined) throw new Error('Regra não foi criada.');

        const base = { householdId, rawDescription: '', accountId: account.id } as const;
        await db.insert(transactions).values([
          // today = 2026-10-10 → janela de 12: 2025-11 .. 2026-10
          { ...base, description: 'fora (2025-10)', occurredOn: '2025-10-15', competence: '2025-10', amountCents: -100, kind: 'expense', status: 'posted' },
          { ...base, description: 'dentro (2025-11)', occurredOn: '2025-11-15', competence: '2025-11', amountCents: -200, kind: 'expense', status: 'posted' },
          { ...base, description: 'corrente', occurredOn: '2026-10-02', competence: '2026-10', amountCents: 5_000, kind: 'income', status: 'posted' },
          { ...base, description: 'futuro (2026-11)', occurredOn: '2026-11-02', competence: '2026-11', amountCents: -300, kind: 'expense', status: 'planned' },

          // Recorrência prevista: só a DATA decide.
          { ...base, description: 'vencida ontem', occurredOn: '2026-10-09', competence: '2026-10', amountCents: -18_000, kind: 'expense', status: 'planned', recurringExpenseId: rule.id },
          { ...base, description: 'vence hoje', occurredOn: '2026-10-10', competence: '2026-10', amountCents: -18_000, kind: 'expense', status: 'planned', recurringExpenseId: ruleToday.id },
          { ...base, description: 'vencida mês passado', occurredOn: '2026-09-05', competence: '2026-09', amountCents: -18_000, kind: 'expense', status: 'planned', recurringExpenseId: rule.id },
          // Já realizada (posted) com a mesma origem: não é pendência.
          { ...base, description: 'realizada', occurredOn: '2026-08-05', competence: '2026-08', amountCents: -18_000, kind: 'expense', status: 'posted', recurringExpenseId: rule.id },
          // Planned sem origem de recorrência (ex.: parcela): não é pendência desta lista.
          { ...base, description: 'planned avulsa', occurredOn: '2026-09-01', competence: '2026-09', amountCents: -999, kind: 'expense', status: 'planned' },
        ]);

        const series = await queries.listIncomeExpenseRows(householdId, '2026-10-10', 12);
        const competences = [...new Set(series.map((row) => row.competence))].sort();
        // 2025-10 fica fora; 2026-11 (futuro) fica fora; 2025-11 é a mais antiga da janela.
        expect(competences[0]).toBe('2025-11');
        expect(competences.at(-1)).toBe('2026-10');
        expect(competences).not.toContain('2025-10');
        expect(competences).not.toContain('2026-11');

        const overdue = await queries.listOverdueRecurring(householdId, '2026-10-10', 10);
        expect(overdue.count).toBe(2);
        expect(overdue.items.map((item) => item.description)).toEqual([
          'vencida mês passado',
          'vencida ontem',
        ]);

        // O teto limita a lista, não a contagem.
        const capped = await queries.listOverdueRecurring(householdId, '2026-10-10', 1);
        expect(capped.count).toBe(2);
        expect(capped.items).toHaveLength(1);
      } finally {
        await db.delete(households).where(eq(households.id, householdId));
      }
    });
  },
);
