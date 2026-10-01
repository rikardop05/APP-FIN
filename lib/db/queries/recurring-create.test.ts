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

    describe('edição: preserva o vencido, apaga e regenera o futuro (replan)', () => {
      const TODAY = '2026-10-15';

      /** Cria a despesa (mensal, dia 5, 6 meses: out/26..mar/27) e devolve ids e leitor. */
      async function setup(m: Modules, projectionMonths = 6) {
        const seed = await seedHousehold(m, { withSettings: true, projectionMonths });
        const id = await m.recurring.createRecurringExpense(
          seed.householdId,
          { ...baseExpense(seed.categoryId), accountId: seed.accountId, creditCardId: null },
          TODAY,
        );
        const rows = async () =>
          (
            await m.db
              .select()
              .from(m.schema.transactions)
              .where(eq(m.schema.transactions.recurringExpenseId, id))
          ).sort((a, b) => a.competence.localeCompare(b.competence));
        const patch = (overrides: Record<string, unknown> = {}) => ({
          ...baseExpense(seed.categoryId),
          accountId: seed.accountId,
          creditCardId: null,
          ...overrides,
        });
        return { ...seed, id, rows, patch };
      }

      it('180 -> 220: o futuro sai em 220, a vencida de outubro FICA em 180 (e continua a mesma linha)', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          const before = await s.rows();
          expect(before).toHaveLength(6);
          expect(before.every((row) => row.amountCents === -18000)).toBe(true);
          const outId = before[0]?.id;

          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ expectedCents: cents(-22000) }) as never,
            TODAY,
          );

          const after = await s.rows();
          expect(after.map((row) => [row.competence, row.amountCents])).toEqual([
            ['2026-10', -18000], // 05/10 < hoje: vencida, preservada com o valor com que aconteceu
            ['2026-11', -22000],
            ['2026-12', -22000],
            ['2027-01', -22000],
            ['2027-02', -22000],
            ['2027-03', -22000],
          ]);
          expect(after[0]?.id).toBe(outId);
          expect(after.every((row) => row.status === 'planned')).toBe(true);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('P3: dueDay 5 -> 20 com a vencida de 05/out pendente: a de 20/out NÃO entra, novembro já sai no dia 20', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ dueDay: 20, expectedCents: cents(-22000) }) as never,
            TODAY,
          );
          const after = await s.rows();
          const october = after.filter((row) => row.competence === '2026-10');
          // Uma expectativa só por mês: duas dobrariam o gasto previsto.
          expect(october).toHaveLength(1);
          expect(october[0]).toMatchObject({ occurredOn: '2026-10-05', amountCents: -18000 });
          const november = after.find((row) => row.competence === '2026-11');
          expect(november).toMatchObject({ occurredOn: '2026-11-20', amountCents: -22000 });
          expect(after).toHaveLength(6);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('competência já ocupada por uma POSTED da mesma origem: o replan não gera a planned ao lado (contaria o gasto duas vezes)', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          const before = await s.rows();
          const november = before.find((row) => row.competence === '2026-11');
          if (november === undefined) throw new Error('Sem linha de novembro.');
          // O realizado de novembro, já lançado, com a mesma origem. O índice parcial
          // só cobre `planned`: nada no banco impede uma planned ao lado dele.
          const { id: _id, ...rest } = november;
          void _id;
          await m.db.insert(m.schema.transactions).values({
            ...rest,
            status: 'posted',
            rawDescription: 'CEMIG',
            dedupeHash: null,
          });

          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ expectedCents: cents(-22000) }) as never,
            TODAY,
          );

          const after = await s.rows();
          const inNovember = after.filter((row) => row.competence === '2026-11');
          // Só a posted: a planned antiga foi apagada (futura, não conciliada) e a
          // nova NÃO foi gerada, porque a competência já tem ocorrência.
          expect(inNovember.map((row) => row.status)).toEqual(['posted']);
          expect(inNovember[0]?.amountCents).toBe(-18000);
          // As outras competências futuras seguem no valor novo.
          expect(after.find((row) => row.competence === '2026-12')?.amountCents).toBe(-22000);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('mensal -> trimestral: o futuro do ritmo antigo some, só o novo fica; a vencida sobrevive', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ frequency: 'quarterly' }) as never,
            TODAY,
          );
          // Âncora em out/26: out, jan, abr. Out é a vencida; jan cai na janela; abr não.
          const after = await s.rows();
          expect(after.map((row) => row.competence)).toEqual(['2026-10', '2027-01']);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('desativar: apaga o futuro, preserva a vencida (a pendência do painel) e não gera nada', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          await m.recurring.deactivateRecurringExpense(s.householdId, s.id, TODAY);
          const after = await s.rows();
          expect(after.map((row) => row.competence)).toEqual(['2026-10']);
          const [rule] = await m.db
            .select({ active: m.schema.recurringExpenses.active })
            .from(m.schema.recurringExpenses)
            .where(eq(m.schema.recurringExpenses.id, s.id));
          expect(rule?.active).toBe(false);
          // O top-up ignora regra inativa: nada reaparece.
          await m.write.topUpPlanned(s.householdId, TODAY);
          expect(await s.rows()).toHaveLength(1);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('editar regra INATIVA atualiza a regra mas não gera previsão nova', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          await m.recurring.deactivateRecurringExpense(s.householdId, s.id, TODAY);
          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ expectedCents: cents(-30000) }) as never,
            TODAY,
          );
          expect(await s.rows()).toHaveLength(1);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('atomicidade: falha DEPOIS de apagar desfaz tudo (regra volta ao valor antigo, linhas voltam)', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          const [card] = await m.db
            .insert(m.schema.creditCards)
            .values({ householdId: s.householdId, name: 'Cartão teste', closingDay: 28, dueDay: 5 })
            .returning({ id: m.schema.creditCards.id });
          if (card === undefined) throw new Error('Cartão não foi criado.');
          const before = (await s.rows()).map((row) => [row.id, row.amountCents]);

          // Dia 31 em cartão que fecha dia 28 junta duas cobranças na mesma fatura:
          // o construtor lança DEPOIS de o replan ter apagado as futuras.
          await expect(
            m.recurring.updateRecurringExpense(
              s.householdId,
              s.id,
              s.patch({
                dueDay: 31,
                expectedCents: cents(-99900),
                accountId: null,
                creditCardId: card.id,
                startsOn: '2026-10-01',
              }) as never,
              TODAY,
            ),
          ).rejects.toThrow(/mesma fatura|competência/);

          const [rule] = await m.db
            .select({
              expectedCents: m.schema.recurringExpenses.expectedCents,
              dueDay: m.schema.recurringExpenses.dueDay,
              accountId: m.schema.recurringExpenses.accountId,
            })
            .from(m.schema.recurringExpenses)
            .where(eq(m.schema.recurringExpenses.id, s.id));
          expect(rule).toEqual({ expectedCents: -18000, dueDay: 5, accountId: s.accountId });
          expect((await s.rows()).map((row) => [row.id, row.amountCents])).toEqual(before);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('topUpPlanned logo depois da edição não desfaz nada (nem recria o ritmo antigo)', async () => {
        const m = await modules();
        const s = await setup(m);
        try {
          await m.recurring.updateRecurringExpense(
            s.householdId,
            s.id,
            s.patch({ expectedCents: cents(-22000), frequency: 'quarterly' }) as never,
            TODAY,
          );
          const after = (await s.rows()).map((row) => [row.competence, row.amountCents]);
          await m.write.topUpPlanned(s.householdId, TODAY);
          await m.write.topUpPlanned(s.householdId, TODAY);
          expect((await s.rows()).map((row) => [row.competence, row.amountCents])).toEqual(after);
        } finally {
          await cleanup(m, s.householdId);
        }
      });

      it('receita: 5.000 -> 5.500 regenera o futuro, preserva a vencida; desativar apaga o futuro', async (ctx) => {
        const m = await modules();
        const column = await m.db.execute(
          sql`select 1 from information_schema.columns where table_name = 'incomes' and column_name = 'account_id'`,
        );
        if (column.length === 0) ctx.skip();
        const seed = await seedHousehold(m, { withSettings: true, projectionMonths: 4 });
        try {
          const [member] = await m.db
            .insert(m.schema.members)
            .values({
              householdId: seed.householdId,
              name: 'Membro teste',
              email: 'membro.replan@example.invalid',
              color: '#000000',
            })
            .returning({ id: m.schema.members.id });
          if (member === undefined) throw new Error('Membro não foi criado.');
          const income = {
            description: 'Salário',
            kind: 'salary' as const,
            expectedCents: cents(500000),
            memberId: member.id,
            accountId: seed.accountId,
            receiveDay: 5,
            frequency: 'monthly' as const,
            oneOffCompetence: null,
            startsOn: '2026-10-01',
            endsOn: null,
          };
          const id = await m.recurring.createIncome(seed.householdId, income, TODAY);
          const rows = async () =>
            (
              await m.db
                .select()
                .from(m.schema.transactions)
                .where(eq(m.schema.transactions.incomeId, id))
            ).sort((a, b) => a.competence.localeCompare(b.competence));
          expect(await rows()).toHaveLength(4);

          await m.recurring.updateIncome(
            seed.householdId,
            id,
            { ...income, expectedCents: cents(550000) },
            TODAY,
          );
          expect((await rows()).map((row) => [row.competence, row.amountCents])).toEqual([
            ['2026-10', 500000],
            ['2026-11', 550000],
            ['2026-12', 550000],
            ['2027-01', 550000],
          ]);

          await m.recurring.deactivateIncome(seed.householdId, id, TODAY);
          expect((await rows()).map((row) => row.competence)).toEqual(['2026-10']);
        } finally {
          await cleanup(m, seed.householdId);
        }
      });
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
