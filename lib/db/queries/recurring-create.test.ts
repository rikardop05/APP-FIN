import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Integração de propósito: só o PostgreSQL prova que a regra e a previsão entram
 * (ou saem) juntas, e que o top-up é idempotente contra o índice real.
 *
 * Disciplina do banco único (decisão de 2026-09-30): household PRÓPRIO, apagado
 * no `finally` — e as `transactions` antes dele, porque `category_id` é RESTRICT
 * imediato.
 */

async function modules() {
  const [{ db }, schema, recurring, write] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./recurring'),
    import('./recurring-planned-write'),
  ]);
  return { db, schema, recurring, write };
}

type Modules = Awaited<ReturnType<typeof modules>>;

/** Household de teste com categoria-folha, conta e (opcionalmente) settings. */
async function seedHousehold(m: Modules, options: { withSettings: boolean; projectionMonths?: number }) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name: 'T-204 create test' })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  if (options.withSettings) {
    await db.insert(schema.householdSettings).values({
      householdId: household.id,
      projectionMonths: options.projectionMonths ?? 6,
    });
  }
  const [root] = await db
    .insert(schema.categories)
    .values({ householdId: household.id, name: 'Moradia teste', parentId: null, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (root === undefined) throw new Error('Categoria raiz não foi criada.');
  const [leaf] = await db
    .insert(schema.categories)
    .values({ householdId: household.id, name: 'Luz teste', parentId: root.id, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (leaf === undefined) throw new Error('Categoria folha não foi criada.');
  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId: household.id, name: 'Conta teste', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  if (account === undefined) throw new Error('Conta não foi criada.');
  return { householdId: household.id, categoryId: leaf.id, accountId: account.id };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
}

const baseExpense = (categoryId: string) => ({
  description: 'Conta de luz',
  expectedCents: cents(-18000),
  categoryId,
  dueDay: 5,
  frequency: 'monthly' as const,
  startsOn: '2026-10-01',
  endsOn: null,
  annualAdjustmentBp: null,
});

describe.skipIf(process.env.DATABASE_URL === undefined)(
  'criação de despesa fixa com previsão gravada (banco real)',
  () => {
    it('cria a regra E as linhas planned dos próximos projection_months, na mesma transação', async () => {
      const m = await modules();
      const { householdId, categoryId, accountId } = await seedHousehold(m, {
        withSettings: true,
        projectionMonths: 6,
      });
      try {
        const id = await m.recurring.createRecurringExpense(
          householdId,
          { ...baseExpense(categoryId), accountId, creditCardId: null },
          '2026-10-15',
        );
        const rows = await m.db
          .select()
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.recurringExpenseId, id));
        expect(rows).toHaveLength(6);
        expect(rows.every((row) => row.status === 'planned')).toBe(true);
        expect(rows.every((row) => row.kind === 'expense' && row.amountCents === -18000)).toBe(true);
        expect(rows.map((row) => row.competence).sort()).toEqual([
          '2026-10',
          '2026-11',
          '2026-12',
          '2027-01',
          '2027-02',
          '2027-03',
        ]);
        expect(rows.every((row) => row.accountId === accountId && row.creditCardId === null)).toBe(true);
      } finally {
        await cleanup(m, householdId);
      }
    });

    it('falha na geração desfaz a regra: sem settings, nada fica gravado e o erro sobe', async () => {
      const m = await modules();
      const { householdId, categoryId, accountId } = await seedHousehold(m, { withSettings: false });
      try {
        await expect(
          m.recurring.createRecurringExpense(
            householdId,
            { ...baseExpense(categoryId), accountId, creditCardId: null },
            '2026-10-15',
          ),
        ).rejects.toThrow(/Configurações da família/);
        const rules = await m.db
          .select({ id: m.schema.recurringExpenses.id })
          .from(m.schema.recurringExpenses)
          .where(eq(m.schema.recurringExpenses.householdId, householdId));
        const lines = await m.db
          .select({ id: m.schema.transactions.id })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.householdId, householdId));
        // O INSERT da regra já tinha rodado quando a geração falhou: sem
        // transação de verdade, sobraria 1 despesa sem previsão.
        expect(rules).toHaveLength(0);
        expect(lines).toHaveLength(0);
      } finally {
        await cleanup(m, householdId);
      }
    });

    it('cartão fecha 25 / vence 5: cobrança dia 28 cai na fatura do mês seguinte', async () => {
      const m = await modules();
      const { householdId, categoryId } = await seedHousehold(m, { withSettings: true, projectionMonths: 3 });
      try {
        const [card] = await m.db
          .insert(m.schema.creditCards)
          .values({ householdId, name: 'Cartão teste', closingDay: 25, dueDay: 5 })
          .returning({ id: m.schema.creditCards.id });
        if (card === undefined) throw new Error('Cartão não foi criado.');
        const id = await m.recurring.createRecurringExpense(
          householdId,
          { ...baseExpense(categoryId), dueDay: 28, accountId: null, creditCardId: card.id },
          '2026-10-15',
        );
        const rows = await m.db
          .select()
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.recurringExpenseId, id));
        const byCompetence = Object.fromEntries(rows.map((row) => [row.competence, row]));
        // 28/10 > fechamento 25/10 → fatura de nov, que vence 05/12.
        expect(Object.keys(byCompetence).sort()).toEqual(['2026-11', '2026-12', '2027-01']);
        expect(byCompetence['2026-11']?.occurredOn).toBe('2026-10-28');
        expect(byCompetence['2026-11']?.cashDate).toBe('2026-12-05');
        expect(byCompetence['2026-11']?.creditCardId).toBe(card.id);
        expect(byCompetence['2026-11']?.accountId).toBeNull();
      } finally {
        await cleanup(m, householdId);
      }
    });

    it('topUpPlanned é idempotente, restaura o que falta e estende o horizonte', async () => {
      const m = await modules();
      const { householdId, categoryId, accountId } = await seedHousehold(m, {
        withSettings: true,
        projectionMonths: 6,
      });
      try {
        const id = await m.recurring.createRecurringExpense(
          householdId,
          { ...baseExpense(categoryId), accountId, creditCardId: null },
          '2026-10-15',
        );
        const count = async () =>
          (
            await m.db
              .select({ id: m.schema.transactions.id })
              .from(m.schema.transactions)
              .where(eq(m.schema.transactions.recurringExpenseId, id))
          ).length;
        expect(await count()).toBe(6);

        // Mesmo dia, de novo: nada falta, nada é gravado.
        await m.write.topUpPlanned(householdId, '2026-10-15');
        await m.write.topUpPlanned(householdId, '2026-10-15');
        expect(await count()).toBe(6);

        // Duas linhas somem: o top-up devolve exatamente as duas.
        await m.db
          .delete(m.schema.transactions)
          .where(
            and(
              eq(m.schema.transactions.recurringExpenseId, id),
              sql`${m.schema.transactions.competence} in ('2026-11', '2027-02')`,
            ),
          );
        expect(await count()).toBe(4);
        await m.write.topUpPlanned(householdId, '2026-10-15');
        expect(await count()).toBe(6);

        // Dois meses depois a janela anda: entram as duas competências novas.
        await m.write.topUpPlanned(householdId, '2026-12-15');
        const all = await m.db
          .select({ competence: m.schema.transactions.competence })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.recurringExpenseId, id));
        expect(all.map((row) => row.competence).sort()).toEqual([
          '2026-10',
          '2026-11',
          '2026-12',
          '2027-01',
          '2027-02',
          '2027-03',
          '2027-04',
          '2027-05',
        ]);
      } finally {
        await cleanup(m, householdId);
      }
    });

    it('topUpPlanned nunca lança: data inválida vai para o log, e household sem regras sai calado', async () => {
      const m = await modules();
      const { householdId, categoryId, accountId } = await seedHousehold(m, {
        withSettings: true,
        projectionMonths: 6,
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await m.recurring.createRecurringExpense(
          householdId,
          { ...baseExpense(categoryId), accountId, creditCardId: null },
          '2026-10-15',
        );
        await expect(m.write.topUpPlanned(householdId, 'não-é-data')).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalled();
        await expect(
          m.write.topUpPlanned('00000000-0000-4000-8000-00000000dead', '2026-10-15'),
        ).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
        await cleanup(m, householdId);
      }
    });

    it('editar ou desativar regra com previsão gravada é recusado (nada fica com o valor antigo em silêncio)', async () => {
      const m = await modules();
      const { householdId, categoryId, accountId } = await seedHousehold(m, {
        withSettings: true,
        projectionMonths: 3,
      });
      try {
        const id = await m.recurring.createRecurringExpense(
          householdId,
          { ...baseExpense(categoryId), accountId, creditCardId: null },
          '2026-10-15',
        );
        await expect(
          m.recurring.updateRecurringExpense(householdId, id, {
            ...baseExpense(categoryId),
            expectedCents: cents(-22000),
            accountId,
            creditCardId: null,
          }),
        ).rejects.toThrow(/previsão gravada/);
        await expect(m.recurring.deactivateRecurringExpense(householdId, id)).rejects.toThrow(
          /previsão gravada/,
        );
        const [rule] = await m.db
          .select({ expectedCents: m.schema.recurringExpenses.expectedCents, active: m.schema.recurringExpenses.active })
          .from(m.schema.recurringExpenses)
          .where(eq(m.schema.recurringExpenses.id, id));
        expect(rule).toEqual({ expectedCents: -18000, active: true });
      } finally {
        await cleanup(m, householdId);
      }
    });

    it('receita cai na conta escolhida (exige a migration 0003 aplicada)', async (ctx) => {
      const m = await modules();
      const column = await m.db.execute(
        sql`select 1 from information_schema.columns where table_name = 'incomes' and column_name = 'account_id'`,
      );
      if (column.length === 0) ctx.skip();
      const { householdId, accountId } = await seedHousehold(m, { withSettings: true, projectionMonths: 3 });
      try {
        const [member] = await m.db
          .insert(m.schema.members)
          .values({
            householdId,
            name: 'Membro teste',
            email: 'membro.teste@example.invalid',
            color: '#000000',
          })
          .returning({ id: m.schema.members.id });
        if (member === undefined) throw new Error('Membro não foi criado.');
        const id = await m.recurring.createIncome(
          householdId,
          {
            description: 'Salário',
            kind: 'salary',
            expectedCents: cents(500000),
            memberId: member.id,
            accountId,
            receiveDay: 5,
            frequency: 'monthly',
            oneOffCompetence: null,
            startsOn: '2026-10-01',
            endsOn: null,
          },
          '2026-10-15',
        );
        const rows = await m.db
          .select()
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.incomeId, id));
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.kind === 'income' && row.status === 'planned')).toBe(true);
        expect(rows.every((row) => row.accountId === accountId && row.memberId === member.id)).toBe(true);
        expect(rows.every((row) => row.amountCents === 500000)).toBe(true);
      } finally {
        await cleanup(m, householdId);
      }
    });
  },
);
