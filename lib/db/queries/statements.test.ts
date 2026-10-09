import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Integracao de proposito: o isolamento por household passa pelo cartao (a
 * fatura nao tem `household_id`), e isso so se prova contra o PostgreSQL.
 *
 * Disciplina do banco unico: households PROPRIOS, apagados no `finally`
 * (cascade leva cartoes e faturas).
 */

async function modules() {
  const [{ db }, schema, queries] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./statements'),
  ]);
  return { db, schema, queries };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name: string) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  try {
    const [card] = await db
      .insert(schema.creditCards)
      .values({ householdId: household.id, name: 'Cartão Teste', closingDay: 1, dueDay: 10 })
      .returning({ id: schema.creditCards.id });
    if (card === undefined) throw new Error('Cartão de teste não foi criado.');
    const [statement] = await db
      .insert(schema.statements)
      .values({
        creditCardId: card.id,
        period: '2026-09',
        closingDate: '2026-09-01',
        dueDate: '2026-09-10',
        source: 'manual',
      })
      .returning({ id: schema.statements.id });
    if (statement === undefined) throw new Error('Fatura de teste não foi criada.');
    return { householdId: household.id, statementId: statement.id };
  } catch (error) {
    await cleanup(m, household.id);
    throw error;
  }
}

async function statusOf(m: Modules, statementId: string) {
  const [row] = await m.db
    .select({ status: m.schema.statements.status })
    .from(m.schema.statements)
    .where(eq(m.schema.statements.id, statementId));
  return row?.status;
}

async function cleanup(m: Modules, householdId: string) {
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
}

describe.skipIf(!process.env.DATABASE_URL)('setStatementStatus (integração)', () => {
  it('marca como paga e desmarca de volta para open', async () => {
    const m = await modules();
    const s = await seed(m, 'Fatura paga test');
    try {
      expect(await statusOf(m, s.statementId)).toBe('open');

      expect(await m.queries.setStatementStatus(s.householdId, s.statementId, 'paid')).toEqual({
        id: s.statementId,
        status: 'paid',
      });
      expect(await statusOf(m, s.statementId)).toBe('paid');

      // Idempotente: marcar de novo nao falha.
      await m.queries.setStatementStatus(s.householdId, s.statementId, 'paid');
      expect(await statusOf(m, s.statementId)).toBe('paid');

      expect(await m.queries.setStatementStatus(s.householdId, s.statementId, 'open')).toEqual({
        id: s.statementId,
        status: 'open',
      });
      expect(await statusOf(m, s.statementId)).toBe('open');
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('fatura de outro household ou inexistente: StatementNotFoundError, sem alterar nada', async () => {
    const m = await modules();
    const a = await seed(m, 'Fatura paga test A');
    try {
      const b = await seed(m, 'Fatura paga test B');
      try {
        await expect(
          m.queries.setStatementStatus(a.householdId, b.statementId, 'paid'),
        ).rejects.toBeInstanceOf(m.queries.StatementNotFoundError);
        expect(await statusOf(m, b.statementId)).toBe('open');

        await expect(
          m.queries.setStatementStatus(a.householdId, crypto.randomUUID(), 'paid'),
        ).rejects.toBeInstanceOf(m.queries.StatementNotFoundError);
      } finally {
        await cleanup(m, b.householdId);
      }
    } finally {
      await cleanup(m, a.householdId);
    }
  });
});
