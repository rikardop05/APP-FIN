import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Integracao de proposito: o incremento de `hits` e a propagacao da categoria do
 * parcelamento sao escrita condicional no banco (`hits + n`, `where category_id ...`),
 * e so se provam contra o PostgreSQL.
 *
 * Disciplina do banco unico: household PROPRIO, apagado no `finally`, com as
 * transacoes antes dele (RESTRICT imediato em `category_id`).
 */

async function modules() {
  const [{ db }, schema, auto] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./auto-categorization'),
  ]);
  return { db, schema, auto };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name = 'F2 auto-categorization test') {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;

  const category = async (categoryName: string, parentId: string | null = null) => {
    const [row] = await db
      .insert(schema.categories)
      .values({ householdId, name: categoryName, parentId, nature: 'non_essential' })
      .returning({ id: schema.categories.id });
    if (row === undefined) throw new Error('Categoria não foi criada.');
    return row.id;
  };
  const root = await category('Compras teste');
  const eletronicos = await category('Eletrônicos teste', root);
  const casa = await category('Casa teste', root);
  const presentes = await category('Presentes teste', root);

  const [card] = await db
    .insert(schema.creditCards)
    .values({ householdId, name: 'Cartão teste', closingDay: 1, dueDay: 10 })
    .returning({ id: schema.creditCards.id });
  if (card === undefined) throw new Error('Cartão não foi criado.');

  const rule = async (pattern: string, categoryId: string) => {
    const [row] = await db
      .insert(schema.categorizationRules)
      .values({ householdId, pattern, categoryId })
      .returning({ id: schema.categorizationRules.id });
    if (row === undefined) throw new Error('Regra não foi criada.');
    return row.id;
  };

  /** Plano de 4 parcelas: 1-2 `posted`, 3-4 `planned`. */
  const plan = async (categoryId: string | null) => {
    const [row] = await db
      .insert(schema.installmentPlans)
      .values({
        householdId,
        creditCardId: card.id,
        description: 'TV 4X',
        totalCents: -400_00,
        installmentsCount: 4,
        firstCompetence: '2026-08',
        categoryId,
        source: 'import',
      })
      .returning({ id: schema.installmentPlans.id });
    if (row === undefined) throw new Error('Plano não foi criado.');
    const ids: string[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const competence = `2026-${String(7 + n).padStart(2, '0')}`;
      const [tx] = await db
        .insert(schema.transactions)
        .values({
          householdId,
          occurredOn: '2026-07-20',
          competence,
          description: `TV ${n}/4`,
          rawDescription: `TV ${n}/4`,
          amountCents: -100_00,
          kind: 'expense',
          status: n <= 2 ? 'posted' : 'planned',
          creditCardId: card.id,
          installmentPlanId: row.id,
          installmentNumber: n,
        })
        .returning({ id: schema.transactions.id });
      if (tx === undefined) throw new Error('Parcela não foi criada.');
      ids.push(tx.id);
    }
    return { planId: row.id, installmentIds: ids };
  };

  return { householdId, root, eletronicos, casa, presentes, rule, plan };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
}

async function categoriesOf(m: Modules, householdId: string, ids: string[]) {
  const out: (string | null)[] = [];
  for (const id of ids) {
    const [row] = await m.db
      .select({ categoryId: m.schema.transactions.categoryId })
      .from(m.schema.transactions)
      .where(and(eq(m.schema.transactions.id, id), eq(m.schema.transactions.householdId, householdId)));
    out.push(row?.categoryId ?? null);
  }
  return out;
}

describe.skipIf(!process.env.DATABASE_URL)('auto-categorization (integração)', () => {
  describe('schema', () => {
    it('transactions.category_rule_id vira NULL quando a regra é apagada', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const ruleId = await s.rule('TV', s.eletronicos);
        const { installmentIds } = await s.plan(null);
        const first = installmentIds[0] ?? '';
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.eletronicos, categoryRuleId: ruleId })
          .where(and(eq(m.schema.transactions.id, first), eq(m.schema.transactions.householdId, s.householdId)));

        await m.db
          .delete(m.schema.categorizationRules)
          .where(and(eq(m.schema.categorizationRules.id, ruleId), eq(m.schema.categorizationRules.householdId, s.householdId)));

        const [row] = await m.db
          .select({ categoryId: m.schema.transactions.categoryId, ruleId: m.schema.transactions.categoryRuleId })
          .from(m.schema.transactions)
          .where(and(eq(m.schema.transactions.id, first), eq(m.schema.transactions.householdId, s.householdId)));
        // A categoria fica; so o rastro da regra some.
        expect(row).toEqual({ categoryId: s.eletronicos, ruleId: null });
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('categorization_rules.created_at é preenchido pelo banco', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const ruleId = await s.rule('TV', s.eletronicos);
        const [row] = await m.db
          .select({ createdAt: m.schema.categorizationRules.createdAt })
          .from(m.schema.categorizationRules)
          .where(and(eq(m.schema.categorizationRules.id, ruleId), eq(m.schema.categorizationRules.householdId, s.householdId)));
        expect(Number.isFinite(row?.createdAt.getTime())).toBe(true);
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  });

  describe('incrementRuleHits', () => {
    it('soma a contagem de cada regra, sem zerar o que já havia', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const a = await s.rule('TV', s.eletronicos);
        const b = await s.rule('LEROY', s.casa);
        await m.auto.incrementRuleHits(s.householdId, { [a]: 3 });
        const updated = await m.auto.incrementRuleHits(s.householdId, { [a]: 2, [b]: 1 });

        expect(updated).toBe(2);
        const rows = await m.db
          .select({ id: m.schema.categorizationRules.id, hits: m.schema.categorizationRules.hits })
          .from(m.schema.categorizationRules)
          .where(eq(m.schema.categorizationRules.householdId, s.householdId));
        const hits = Object.fromEntries(rows.map((r) => [r.id, r.hits]));
        // a: 3 + 2 = 5; b: 0 + 1 = 1.
        expect(hits).toEqual({ [a]: 5, [b]: 1 });
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('não toca regra de outro household', async () => {
      const m = await modules();
      const s = await seed(m);
      const other = await seed(m, 'F2 outro household');
      try {
        const foreign = await other.rule('TV', other.eletronicos);
        const updated = await m.auto.incrementRuleHits(s.householdId, { [foreign]: 7 });

        expect(updated).toBe(0);
        const [row] = await m.db
          .select({ hits: m.schema.categorizationRules.hits })
          .from(m.schema.categorizationRules)
          .where(and(eq(m.schema.categorizationRules.id, foreign), eq(m.schema.categorizationRules.householdId, other.householdId)));
        expect(row?.hits).toBe(0);
      } finally {
        await cleanup(m, s.householdId);
        await cleanup(m, other.householdId);
      }
    });

    it('ignora contagem zero ou negativa e mapa vazio', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const a = await s.rule('TV', s.eletronicos);
        expect(await m.auto.incrementRuleHits(s.householdId, {})).toBe(0);
        expect(await m.auto.incrementRuleHits(s.householdId, { [a]: 0 })).toBe(0);
        expect(await m.auto.incrementRuleHits(s.householdId, { [a]: -4 })).toBe(0);
        const [row] = await m.db
          .select({ hits: m.schema.categorizationRules.hits })
          .from(m.schema.categorizationRules)
          .where(and(eq(m.schema.categorizationRules.id, a), eq(m.schema.categorizationRules.householdId, s.householdId)));
        expect(row?.hits).toBe(0);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('roda dentro da transação de quem chama: rollback desfaz o incremento', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const a = await s.rule('TV', s.eletronicos);
        await expect(
          m.db.transaction(async (tx) => {
            await m.auto.incrementRuleHits(s.householdId, { [a]: 4 }, tx);
            throw new Error('falha depois do incremento');
          }),
        ).rejects.toThrow('falha depois do incremento');
        const [row] = await m.db
          .select({ hits: m.schema.categorizationRules.hits })
          .from(m.schema.categorizationRules)
          .where(and(eq(m.schema.categorizationRules.id, a), eq(m.schema.categorizationRules.householdId, s.householdId)));
        expect(row?.hits).toBe(0);
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  });

  describe('setInstallmentPlanCategory', () => {
    it('plano sem categoria: grava no plano e em TODAS as parcelas, inclusive planned', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const { planId, installmentIds } = await s.plan(null);
        const updated = await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);

        expect(updated).toBe(4);
        expect(await categoriesOf(m, s.householdId, installmentIds)).toEqual([
          s.eletronicos,
          s.eletronicos,
          s.eletronicos,
          s.eletronicos,
        ]);
        const [plan] = await m.db
          .select({ categoryId: m.schema.installmentPlans.categoryId })
          .from(m.schema.installmentPlans)
          .where(and(eq(m.schema.installmentPlans.id, planId), eq(m.schema.installmentPlans.householdId, s.householdId)));
        expect(plan?.categoryId).toBe(s.eletronicos);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('não sobrescreve parcela categorizada à mão com categoria diferente da do plano', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const { planId, installmentIds } = await s.plan(null);
        const third = installmentIds[2] ?? '';
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.presentes })
          .where(and(eq(m.schema.transactions.id, third), eq(m.schema.transactions.householdId, s.householdId)));

        const updated = await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);

        expect(updated).toBe(3);
        expect(await categoriesOf(m, s.householdId, installmentIds)).toEqual([
          s.eletronicos,
          s.eletronicos,
          s.presentes,
          s.eletronicos,
        ]);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('troca de categoria do plano: parcela que acompanhava o plano acompanha; a manual fica', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const { planId, installmentIds } = await s.plan(null);
        await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);
        const second = installmentIds[1] ?? '';
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.presentes })
          .where(and(eq(m.schema.transactions.id, second), eq(m.schema.transactions.householdId, s.householdId)));

        const updated = await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.casa);

        expect(updated).toBe(3);
        expect(await categoriesOf(m, s.householdId, installmentIds)).toEqual([
          s.casa,
          s.presentes,
          s.casa,
          s.casa,
        ]);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('parcela categorizada por regra, com categoria diferente, também fica (só segue quem estava vazio ou igual ao plano)', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const ruleId = await s.rule('TV', s.presentes);
        const { planId, installmentIds } = await s.plan(null);
        const first = installmentIds[0] ?? '';
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.presentes, categoryRuleId: ruleId })
          .where(and(eq(m.schema.transactions.id, first), eq(m.schema.transactions.householdId, s.householdId)));

        await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);

        expect(await categoriesOf(m, s.householdId, installmentIds)).toEqual([
          s.presentes,
          s.eletronicos,
          s.eletronicos,
          s.eletronicos,
        ]);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('parcela que passa a seguir o plano perde o rastro da regra', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const ruleId = await s.rule('TV', s.eletronicos);
        const { planId, installmentIds } = await s.plan(null);
        const first = installmentIds[0] ?? '';
        // Ja categorizada pela regra, na MESMA categoria que o plano vai receber.
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.eletronicos, categoryRuleId: ruleId })
          .where(and(eq(m.schema.transactions.id, first), eq(m.schema.transactions.householdId, s.householdId)));
        await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);
        await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.casa);

        const rows = await m.db
          .select({ categoryId: m.schema.transactions.categoryId, ruleId: m.schema.transactions.categoryRuleId })
          .from(m.schema.transactions)
          .where(and(eq(m.schema.transactions.id, first), eq(m.schema.transactions.householdId, s.householdId)));
        expect(rows).toEqual([{ categoryId: s.casa, ruleId: null }]);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('limpar a categoria do plano limpa só as parcelas que o acompanhavam', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const { planId, installmentIds } = await s.plan(s.eletronicos);
        const last = installmentIds[3] ?? '';
        await m.db
          .update(m.schema.transactions)
          .set({ categoryId: s.presentes })
          .where(and(eq(m.schema.transactions.id, last), eq(m.schema.transactions.householdId, s.householdId)));
        await m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos);

        await m.auto.setInstallmentPlanCategory(s.householdId, planId, null);

        expect(await categoriesOf(m, s.householdId, installmentIds)).toEqual([null, null, null, s.presentes]);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('recusa plano de outro household e não toca nada', async () => {
      const m = await modules();
      const s = await seed(m);
      const other = await seed(m, 'F2 outro household');
      try {
        const { planId, installmentIds } = await other.plan(null);
        await expect(
          m.auto.setInstallmentPlanCategory(s.householdId, planId, s.eletronicos),
        ).rejects.toBeInstanceOf(m.auto.InstallmentPlanNotFoundError);
        expect(await categoriesOf(m, other.householdId, installmentIds)).toEqual([null, null, null, null]);
      } finally {
        await cleanup(m, s.householdId);
        await cleanup(m, other.householdId);
      }
    });

    it('recusa categoria de outro household', async () => {
      const m = await modules();
      const s = await seed(m);
      const other = await seed(m, 'F2 outro household');
      try {
        const { planId } = await s.plan(null);
        await expect(
          m.auto.setInstallmentPlanCategory(s.householdId, planId, other.eletronicos),
        ).rejects.toBeInstanceOf(m.auto.InvalidPlanCategoryError);
      } finally {
        await cleanup(m, s.householdId);
        await cleanup(m, other.householdId);
      }
    });

    it('recusa categoria com filhas (o lançamento cai na folha)', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const { planId } = await s.plan(null);
        await expect(
          m.auto.setInstallmentPlanCategory(s.householdId, planId, s.root),
        ).rejects.toBeInstanceOf(m.auto.InvalidPlanCategoryError);
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  });
});
