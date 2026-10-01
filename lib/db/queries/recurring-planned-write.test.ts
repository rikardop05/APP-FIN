import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expandRecurrence } from '@/lib/finance/recurrence';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Integração de propósito: só o PostgreSQL prova que o índice parcial único
 * existe, tem o predicado certo e faz o `ON CONFLICT` pular o que já existe.
 *
 * Disciplina do banco único (decisão de 2026-09-30): household PRÓPRIO, apagado
 * no `finally`. É a única barreira entre este teste e os dados da casa.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'insertPlannedRowsIdempotent contra o índice parcial real',
  () => {
    it('gerar a mesma regra duas vezes não duplica, e a posted de mesma origem convive', async () => {
      const [{ db }, schema, { buildPlannedRows }, { insertPlannedRowsIdempotent }] =
        await Promise.all([
          import('@/lib/db'),
          import('@/lib/db/schema'),
          import('./recurring-planned'),
          import('./recurring-planned-write'),
        ]);
      const { accounts, categories, households, recurringExpenses, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'T-204 planned idempotency test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');

      try {
        const [root] = await db
          .insert(categories)
          .values({ householdId: household.id, name: 'Moradia teste', parentId: null, nature: 'essential' })
          .returning({ id: categories.id });
        if (root === undefined) throw new Error('Categoria raiz não foi criada.');
        const [leaf] = await db
          .insert(categories)
          .values({ householdId: household.id, name: 'Luz teste', parentId: root.id, nature: 'essential' })
          .returning({ id: categories.id });
        if (leaf === undefined) throw new Error('Categoria folha não foi criada.');
        const [account] = await db
          .insert(accounts)
          .values({
            householdId: household.id,
            name: 'Conta teste',
            kind: 'checking',
            openingDate: '2026-01-01',
          })
          .returning({ id: accounts.id });
        if (account === undefined) throw new Error('Conta não foi criada.');
        const [expense] = await db
          .insert(recurringExpenses)
          .values({
            householdId: household.id,
            description: 'Conta de luz',
            expectedCents: -18000,
            categoryId: leaf.id,
            dueDay: 5,
            frequency: 'monthly',
            accountId: account.id,
            startsOn: '2026-09-01',
          })
          .returning({ id: recurringExpenses.id });
        if (expense === undefined) throw new Error('Despesa fixa não foi criada.');

        const occurrences = expandRecurrence(
          {
            expectedCents: cents(-18000),
            dueDay: 5,
            frequency: 'monthly',
            startsOn: '2026-09-01',
            endsOn: null,
            annualAdjustmentBp: null,
          },
          { from: '2026-09', months: 12 },
        );
        const rows = buildPlannedRows(
          {
            householdId: household.id,
            origin: { kind: 'expense', recurringExpenseId: expense.id },
            description: 'Conta de luz',
            categoryId: leaf.id,
            memberId: null,
            destination: { accountId: account.id, creditCardId: null },
          },
          occurrences,
        );
        expect(rows).toHaveLength(12);

        const countPlanned = async () =>
          (
            await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(
                and(
                  eq(transactions.householdId, household.id),
                  eq(transactions.recurringExpenseId, expense.id),
                  eq(transactions.status, 'planned'),
                ),
              )
          ).length;

        // Mesma regra, duas vezes, em transações separadas.
        const first = await db.transaction((tx) => insertPlannedRowsIdempotent(tx, rows));
        const second = await db.transaction((tx) => insertPlannedRowsIdempotent(tx, rows));
        expect(first).toBe(12);
        expect(second).toBe(0);
        expect(await countPlanned()).toBe(12);

        // O predicado `status = 'planned'` é o coração: a linha posted que
        // concilia o previsto (RF-ORC-03) tem a MESMA origem e competência e
        // não pode ser barrada. Se o índice saísse cheio, isto lançaria.
        const sample = rows[0];
        if (sample === undefined) throw new Error('Sem linha de amostra.');
        await db.insert(transactions).values({
          ...sample,
          status: 'posted',
          rawDescription: 'CEMIG',
          dedupeHash: null,
        });
        expect(await countPlanned()).toBe(12);

        // E o índice é de verdade único: INSERT cru de uma planned repetida lança.
        await expect(db.insert(transactions).values({ ...sample })).rejects.toThrow();
        expect(await countPlanned()).toBe(12);
      } finally {
        // transactions antes do household: category_id é RESTRICT imediato.
        await db.delete(transactions).where(eq(transactions.householdId, household.id));
        await db.delete(households).where(eq(households.id, household.id));
      }
    });
  },
);
