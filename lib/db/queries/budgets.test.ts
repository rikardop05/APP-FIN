import { eq } from 'drizzle-orm';
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
 * Integração de propósito: realizado (`posted`) × previsto (`planned`), a
 * substituição do conjunto do mês e o isolamento por household só se provam
 * contra o PostgreSQL.
 *
 * Disciplina do banco único: household PRÓPRIO, apagado no `finally`, com as
 * transações e os orçamentos antes dele (RESTRICT imediato em `category_id`).
 */

async function modules() {
  const [{ db }, schema, budgets] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./budgets'),
  ]);
  return { db, schema, budgets };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name = 'T-205 budgets test') {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  await db.insert(schema.householdSettings).values({ householdId: household.id });
  const category = async (
    categoryName: string,
    nature: 'essential' | 'non_essential' | 'investment' | 'income',
    parentId: string | null,
  ) => {
    const [row] = await db
      .insert(schema.categories)
      .values({ householdId: household.id, name: categoryName, parentId, nature })
      .returning({ id: schema.categories.id });
    if (row === undefined) throw new Error('Categoria não foi criada.');
    return row.id;
  };
  const root = await category('Moradia teste', 'essential', null);
  const mercado = await category('Mercado teste', 'essential', root);
  const lazer = await category('Lazer teste', 'non_essential', root);
  const aporte = await category('Aporte teste', 'investment', root);
  const salario = await category('Salário teste', 'income', root);
  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId: household.id, name: 'Conta teste', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  if (account === undefined) throw new Error('Conta não foi criada.');

  const tx = async (
    competence: string,
    categoryId: string | null,
    amountCents: number,
    options: { status?: 'posted' | 'planned'; kind?: 'expense' | 'transfer' | 'income' } = {},
  ) => {
    await db.insert(schema.transactions).values({
      householdId: household.id,
      occurredOn: `${competence}-10`,
      competence,
      description: 'Teste',
      rawDescription: 'TESTE',
      amountCents,
      kind: options.kind ?? 'expense',
      status: options.status ?? 'posted',
      categoryId,
      accountId: account.id,
    });
  };
  return { householdId: household.id, root, mercado, lazer, aporte, salario, tx };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.budgets).where(eq(schema.budgets.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
}

describe.skipIf(process.env.DATABASE_URL === undefined)('orçamento por categoria (banco real)', () => {
  it('o realizado conta só posted/expense/categorizada da competência; o planned vai para "previsto"', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
      ]);
      await s.tx('2026-10', s.mercado, -80000); // realizado
      await s.tx('2026-10', s.mercado, -15000, { status: 'planned' }); // previsto: fora do semáforo
      await s.tx('2026-10', s.mercado, -99999, { kind: 'transfer' }); // RC-03: fora
      await s.tx('2026-10', null, -77777); // sem categoria: fora
      await s.tx('2026-09', s.mercado, -55555); // outra competência: fora

      const month = await m.budgets.getBudgetMonth(s.householdId, '2026-10');
      expect(month.rows).toHaveLength(1);
      const row = month.rows[0];
      expect(row).toMatchObject({
        categoryId: s.mercado,
        plannedCents: 100000,
        spentCents: 80000,
        remainingCents: 20000,
        usageBp: 8000,
        light: 'yellow', // 80,00% == warnBp: amarelo (limite inclusivo)
        upcomingCents: 15000,
        categoryName: 'Mercado teste',
        rootName: 'Moradia teste',
      });
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('planned sozinho NÃO acende o semáforo: no dia 1 com 800 por vir, o realizado é zero e a luz é verde', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
      ]);
      await s.tx('2026-10', s.mercado, -80000, { status: 'planned' });
      const [row] = (await m.budgets.getBudgetMonth(s.householdId, '2026-10')).rows;
      expect(row).toMatchObject({ spentCents: 0, light: 'green', upcomingCents: 80000 });
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('replaceBudgets substitui o conjunto: atualiza, insere e APAGA o que não veio', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
        { categoryId: s.lazer, plannedCents: cents(30000) },
      ]);
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(120000) },
      ]);
      const month = await m.budgets.getBudgetMonth(s.householdId, '2026-10');
      expect(month.rows.map((r) => [r.categoryName, r.plannedCents])).toEqual([['Mercado teste', 120000]]);
      // Outro mês não é tocado.
      await m.budgets.replaceBudgets(s.householdId, '2026-11', [
        { categoryId: s.lazer, plannedCents: cents(5000) },
      ]);
      await m.budgets.replaceBudgets(s.householdId, '2026-10', []);
      expect((await m.budgets.getBudgetMonth(s.householdId, '2026-10')).rows).toEqual([]);
      expect((await m.budgets.getBudgetMonth(s.householdId, '2026-11')).rows).toHaveLength(1);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('orçamento 0 é aceito; com gasto fica vermelho e usageBp é null', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.lazer, plannedCents: cents(0) },
      ]);
      await s.tx('2026-10', s.lazer, -1000);
      const [row] = (await m.budgets.getBudgetMonth(s.householdId, '2026-10')).rows;
      expect(row).toMatchObject({ plannedCents: 0, usageBp: null, light: 'red' });
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('recusa raiz, receita, investimento e categoria de outro household, e NADA é gravado (atomicidade)', async () => {
    const m = await modules();
    const s = await seed(m);
    const other = await seed(m, 'T-205 budgets other');
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
      ]);
      const bad = async (categoryId: string, pattern: RegExp) => {
        await expect(
          m.budgets.replaceBudgets(s.householdId, '2026-10', [
            { categoryId: s.lazer, plannedCents: cents(1) },
            { categoryId, plannedCents: cents(1) },
          ]),
        ).rejects.toThrow(pattern);
      };
      await bad(s.root, /subcategoria/);
      await bad(s.salario, /Receita/);
      await bad(s.aporte, /Investimento/);
      await bad(other.mercado, /não encontrada/);
      // A primeira (válida) NÃO ficou: a transação desfez tudo e o mês segue como estava.
      const month = await m.budgets.getBudgetMonth(s.householdId, '2026-10');
      expect(month.rows.map((r) => [r.categoryName, r.plannedCents])).toEqual([['Mercado teste', 100000]]);
    } finally {
      await cleanup(m, s.householdId);
      await cleanup(m, other.householdId);
    }
  });

  it('recusa valor negativo e categoria repetida', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await expect(
        m.budgets.replaceBudgets(s.householdId, '2026-10', [
          { categoryId: s.mercado, plannedCents: cents(-1) },
        ]),
      ).rejects.toThrow(/negativo/);
      await expect(
        m.budgets.replaceBudgets(s.householdId, '2026-10', [
          { categoryId: s.mercado, plannedCents: cents(1) },
          { categoryId: s.mercado, plannedCents: cents(2) },
        ]),
      ).rejects.toThrow(/repetidas/);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('sugestão "mês anterior": repete o mês anterior; se ele esteve VAZIO, não sugere o de dois meses atrás', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await s.tx('2026-08', s.mercado, -90000); // agosto teve gasto
      // setembro (o mês anterior a outubro) ficou vazio.
      expect(await m.budgets.getBudgetSuggestion(s.householdId, '2026-10', 'previous')).toEqual([]);
      await s.tx('2026-09', s.mercado, -60000);
      expect(await m.budgets.getBudgetSuggestion(s.householdId, '2026-10', 'previous')).toEqual([
        { categoryId: s.mercado, suggestedCents: 60000 },
      ]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('sugestão "média de 3 meses": divide por 3, ignora planned, o mês orçado e categoria não orçável', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await s.tx('2026-07', s.mercado, -90000);
      await s.tx('2026-08', s.mercado, -30000, { status: 'planned' }); // fora
      await s.tx('2026-10', s.mercado, -999999); // o mês orçado não entra
      await s.tx('2026-09', s.aporte, -50000); // investimento: não orçável
      const result = await m.budgets.getBudgetSuggestion(s.householdId, '2026-10', 'avg3');
      expect(result).toEqual([{ categoryId: s.mercado, suggestedCents: 30000 }]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('sugestão nunca grava: depois dela o mês continua sem orçamento', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await s.tx('2026-09', s.mercado, -60000);
      await m.budgets.getBudgetSuggestion(s.householdId, '2026-10', 'previous');
      expect((await m.budgets.getBudgetMonth(s.householdId, '2026-10')).rows).toEqual([]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('listOverBudget devolve só o vermelho do motor, orçamento zero primeiro e depois o maior uso', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
        { categoryId: s.lazer, plannedCents: cents(0) },
      ]);
      await s.tx('2026-10', s.mercado, -101000); // 101,00% -> vermelho
      await s.tx('2026-10', s.lazer, -500); // orçamento zero com gasto -> vermelho
      const over = await m.budgets.listOverBudget(s.householdId, '2026-10');
      expect(over.map((item) => [item.categoryName, item.usageBp])).toEqual([
        ['Lazer teste', null],
        ['Mercado teste', 10100],
      ]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('"estourado" é o vermelho do motor: 100,00% exatos e até 100,004% (arredonda para 10000 bp) são AMARELOS', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.budgets.replaceBudgets(s.householdId, '2026-10', [
        { categoryId: s.mercado, plannedCents: cents(100000) },
        { categoryId: s.lazer, plannedCents: cents(100000) },
      ]);
      await s.tx('2026-10', s.mercado, -100000); // 10000 bp
      await s.tx('2026-10', s.lazer, -100001); // 10000,1 bp -> 10000 bp: a tela mostra 100,00%
      const month = await m.budgets.getBudgetMonth(s.householdId, '2026-10');
      expect(month.rows.map((row) => [row.usageBp, row.light])).toEqual([
        [10000, 'yellow'],
        [10000, 'yellow'],
      ]);
      // O painel não pode dizer "estourado" sobre uma linha que o orçamento mostra amarela.
      expect(await m.budgets.listOverBudget(s.householdId, '2026-10')).toEqual([]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('isolamento: o orçamento e o realizado de um household não aparecem no outro', async () => {
    const m = await modules();
    const a = await seed(m, 'T-205 budgets A');
    const b = await seed(m, 'T-205 budgets B');
    try {
      await m.budgets.replaceBudgets(a.householdId, '2026-10', [
        { categoryId: a.mercado, plannedCents: cents(1000) },
      ]);
      await a.tx('2026-10', a.mercado, -5000);
      expect((await m.budgets.getBudgetMonth(b.householdId, '2026-10')).rows).toEqual([]);
      expect(await m.budgets.listOverBudget(b.householdId, '2026-10')).toEqual([]);
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });
});
