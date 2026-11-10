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
 * Integração de propósito: "cartão ATIVO, da família, sem `statement` na competência" só se
 * prova contra o SQL real (o join que dá a fronteira de household a `statements`). A regra
 * do fechamento é de `missingStatements`, testada em `lib/finance`. Household PRÓPRIO,
 * apagado no `finally` (disciplina do banco único).
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'listMissingStatements contra o banco real',
  () => {
    it('lista só cartão ativo, já fechado e sem fatura na competência corrente; isolado por household', async () => {
      const [{ db }, schema, queries] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
      ]);
      const { creditCards, households, statements } = schema;

      const household = async (name: string) => {
        const [row] = await db.insert(households).values({ name }).returning({ id: households.id });
        if (row === undefined) throw new Error('Household de teste não foi criado.');
        return row.id;
      };
      const householdId = await household('Lote1 missing statements A');
      let otherId: string | null = null;

      try {
        otherId = await household('Lote1 missing statements B');
        const card = async (
          owner: string,
          name: string,
          closingDay: number,
          dueDay: number,
          active = true,
        ) => {
          const [row] = await db
            .insert(creditCards)
            .values({ householdId: owner, name, closingDay, dueDay, active })
            .returning({ id: creditCards.id });
          if (row === undefined) throw new Error('Cartão de teste não foi criado.');
          return row.id;
        };

        // today = 2026-11-12, competência 2026-11.
        const pending = await card(householdId, 'B pendente', 30, 7); // fatura de nov fechou 30/10
        const recent = await card(householdId, 'A recém-cadastrado', 10, 20); // fechou 10/11, sem fatura na vida
        const imported = await card(householdId, 'C importada', 30, 7);
        const stillOpen = await card(householdId, 'D aberta', 25, 28); // fecha 25/11
        await card(householdId, 'E inativo', 30, 7, false);
        const onlyOld = await card(householdId, 'F só fatura antiga', 30, 7);
        const hole = await card(householdId, 'G buraco', 25, 28); // tem setembro, falta outubro
        const inactive = await card(householdId, 'H inativo com histórico', 25, 28, false);
        await card(otherId, 'Cartão de outra família', 30, 7);

        await db.insert(statements).values([
          { creditCardId: imported, period: '2026-11', closingDate: '2026-10-30', dueDate: '2026-11-07', source: 'import' },
          // Fatura de outubro não quita a de novembro.
          { creditCardId: onlyOld, period: '2026-10', closingDate: '2026-09-30', dueDate: '2026-10-07', source: 'import' },
          // Histórico ANTES da competência anterior: outubro vira buraco.
          { creditCardId: hole, period: '2026-09', closingDate: '2026-09-25', dueDate: '2026-09-28', source: 'import' },
          { creditCardId: inactive, period: '2026-09', closingDate: '2026-09-25', dueDate: '2026-09-28', source: 'import' },
        ]);

        const pairs = (items: { cardName: string; competence: string }[]) =>
          items.map((item) => `${item.cardName} ${item.competence}`);

        // Corrente = 2026-11 (conta sempre); anterior = 2026-10 (só para quem tem fatura antes dela).
        const result = await queries.listMissingStatements(householdId, '2026-11-12');
        // Ordem: nome do cartão e, dentro dele, a competência mais antiga primeiro.
        expect(pairs(result)).toEqual([
          'A recém-cadastrado 2026-11', // sem fatura na vida: outubro NÃO é cobrado (começo do histórico)
          'B pendente 2026-11',
          'F só fatura antiga 2026-11', // a de outubro existe
          'G buraco 2026-10', // tem setembro e falta outubro; novembro fecha 25/11, ainda aberta
        ]);
        expect(result[0]).toEqual({
          creditCardId: recent,
          cardName: 'A recém-cadastrado',
          competence: '2026-11',
          closingDate: '2026-11-10',
          dueDate: '2026-11-20',
        });
        expect(result.find((item) => item.creditCardId === hole)).toMatchObject({
          closingDate: '2026-10-25',
          dueDate: '2026-10-28',
        });
        // Histórico começando em novembro (C) ou sem fatura e ainda aberta (D): nada, e nada de outubro falso.
        expect(result.some((item) => item.creditCardId === imported || item.creditCardId === stillOpen)).toBe(false);

        // No dia do fechamento (10/11) a fatura de novembro do cartão que fecha dia 10 ainda não é pendência.
        const onClosingDay = await queries.listMissingStatements(householdId, '2026-11-10');
        expect(pairs(onClosingDay)).toEqual(['B pendente 2026-11', 'F só fatura antiga 2026-11', 'G buraco 2026-10']);

        // Fatura MANUAL também conta como existente.
        await db.insert(statements).values({
          creditCardId: pending,
          period: '2026-11',
          closingDate: '2026-10-30',
          dueDate: '2026-11-07',
          source: 'manual',
        });
        const after = await queries.listMissingStatements(householdId, '2026-11-12');
        expect(pairs(after)).toEqual(['A recém-cadastrado 2026-11', 'F só fatura antiga 2026-11', 'G buraco 2026-10']);

        // Virada do mês (01/12): corrente = dezembro, anterior = novembro.
        const nextMonth = await queries.listMissingStatements(householdId, '2026-12-01');
        expect(pairs(nextMonth)).toEqual([
          'B pendente 2026-12', // fecha 30/11; a de novembro existe (manual)
          'C importada 2026-12',
          'F só fatura antiga 2026-11', // buraco: tem outubro, falta novembro. NÃO some na virada
          'F só fatura antiga 2026-12',
          'G buraco 2026-11', // tem setembro, falta novembro; outubro já ficou para trás (só uma competência)
          // A e D: novembro sem histórico antes dele não é buraco; dezembro ainda aberta.
        ]);

        // Isolamento: a outra família só vê o próprio cartão.
        const other = await queries.listMissingStatements(otherId, '2026-11-12');
        expect(pairs(other)).toEqual(['Cartão de outra família 2026-11']);
      } finally {
        if (otherId !== null) await db.delete(households).where(eq(households.id, otherId));
        await db.delete(households).where(eq(households.id, householdId));
      }
    });

    it('família sem cartão: lista vazia', async () => {
      const [{ db }, schema, queries] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./dashboard'),
      ]);
      const [row] = await db
        .insert(schema.households)
        .values({ name: 'Lote1 missing statements vazio' })
        .returning({ id: schema.households.id });
      if (row === undefined) throw new Error('Household de teste não foi criado.');
      try {
        expect(await queries.listMissingStatements(row.id, '2026-11-12')).toEqual([]);
      } finally {
        await db.delete(schema.households).where(eq(schema.households.id, row.id));
      }
    });
  },
);
