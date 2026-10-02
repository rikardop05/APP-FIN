import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { leafCategoryGroups } from '@/components/recurring/recurring-form';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Defeito de 2026-10-02: o seletor "Categoria" da despesa fixa mostrava "Sem
 * categoria-folha cadastrada" num household com folhas. A pagina filtrava
 * `parentId !== null` sobre o retorno de `listCategories`, que e uma ARVORE (so
 * raizes no topo). Este teste usa a query real: o filtro antigo da vazio, o
 * `leafCategoryGroups` devolve as folhas.
 *
 * Household proprio, apagado no `finally` (categorias saem em cascata).
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'opcoes de categoria da despesa fixa a partir de listCategories (banco real)',
  () => {
    it('as folhas chegam ao seletor', async () => {
      const [{ db }, schema, { listCategories }] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./categories'),
      ]);
      const [household] = await db
        .insert(schema.households)
        .values({ name: 'T-recorrentes categoria test' })
        .returning({ id: schema.households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      try {
        const [root] = await db
          .insert(schema.categories)
          .values({ householdId: household.id, name: 'Moradia', parentId: null, nature: 'essential' })
          .returning({ id: schema.categories.id });
        if (root === undefined) throw new Error('Raiz não foi criada.');
        await db.insert(schema.categories).values([
          { householdId: household.id, name: 'Água', parentId: root.id, nature: 'essential' },
          { householdId: household.id, name: 'Luz', parentId: root.id, nature: 'essential' },
        ]);

        const tree = await listCategories(household.id);

        // O filtro antigo da pagina: vazio, mesmo com duas folhas no banco.
        expect(tree.filter((category) => category.parentId !== null)).toEqual([]);

        const groups = leafCategoryGroups(tree);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.name).toBe('Moradia');
        expect(groups[0]?.leaves.map((leaf) => leaf.name).sort()).toEqual(['Luz', 'Água'].sort());
      } finally {
        await db.delete(schema.households).where(eq(schema.households.id, household.id));
      }
    });
  },
);
