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
 * Integração de propósito: o 404 em id de outro household (update/deactivate
 * de conta e cartão) só se prova contra o PostgreSQL — é o `returning()` vazio
 * que distingue "não é da casa" de "atualizou".
 *
 * Disciplina do banco único: households PRÓPRIOS (dois, para o caso
 * cruzado), apagados no `finally` (cascade leva o resto).
 */

async function modules() {
  const [{ db }, schema, cards] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./cards'),
  ]);
  return { db, schema, cards };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name: string) {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;
  try {
    const [account] = await db
      .insert(schema.accounts)
      .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
      .returning({ id: schema.accounts.id });
    const [card] = await db
      .insert(schema.creditCards)
      .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
      .returning({ id: schema.creditCards.id });
    if (account === undefined || card === undefined) throw new Error('Seed incompleto.');
    return { householdId, accountId: account.id, cardId: card.id };
  } catch (error) {
    try {
      await db.delete(schema.households).where(eq(schema.households.id, householdId));
    } catch {
      // Se a compensação falhar, o órfão cai na faxina de households de teste.
    }
    throw error;
  }
}

async function cleanup(m: Modules, householdId: string) {
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
}

const FOREIGN = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!process.env.DATABASE_URL)('contas e cartões: NotFound em id de outro household', () => {
  it('updateAccount atualiza a própria e recusa a alheia com AccountNotFoundError', async () => {
    const m = await modules();
    const a = await seed(m, 'T-cards conta A');
    const b = await seed(m, 'T-cards conta B');
    try {
      await m.cards.updateAccount(a.householdId, a.accountId, {
        name: 'Conta nova',
        bank: null,
        kind: 'checking',
        openingBalanceCents: cents(0),
        openingDate: '2026-01-01',
      });
      const [row] = await m.db
        .select({ name: m.schema.accounts.name })
        .from(m.schema.accounts)
        .where(eq(m.schema.accounts.id, a.accountId));
      expect(row?.name).toBe('Conta nova');

      await expect(
        m.cards.updateAccount(a.householdId, b.accountId, {
          name: 'Invasão',
          bank: null,
          kind: 'checking',
          openingBalanceCents: cents(0),
          openingDate: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(m.cards.AccountNotFoundError);
      await expect(
        m.cards.updateAccount(a.householdId, FOREIGN, {
          name: 'Fantasma',
          bank: null,
          kind: 'checking',
          openingBalanceCents: cents(0),
          openingDate: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(m.cards.AccountNotFoundError);
      const [other] = await m.db
        .select({ name: m.schema.accounts.name })
        .from(m.schema.accounts)
        .where(eq(m.schema.accounts.id, b.accountId));
      expect(other?.name).toBe('Conta');
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });

  it('deactivateAccount desativa a própria e recusa a alheia', async () => {
    const m = await modules();
    const a = await seed(m, 'T-cards desativa A');
    const b = await seed(m, 'T-cards desativa B');
    try {
      await m.cards.deactivateAccount(a.householdId, a.accountId);
      const [row] = await m.db
        .select({ active: m.schema.accounts.active })
        .from(m.schema.accounts)
        .where(eq(m.schema.accounts.id, a.accountId));
      expect(row?.active).toBe(false);

      await expect(m.cards.deactivateAccount(a.householdId, b.accountId)).rejects.toBeInstanceOf(
        m.cards.AccountNotFoundError,
      );
      const [other] = await m.db
        .select({ active: m.schema.accounts.active })
        .from(m.schema.accounts)
        .where(eq(m.schema.accounts.id, b.accountId));
      expect(other?.active).toBe(true);
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });

  it('updateCard atualiza o próprio e recusa o alheio com CardNotFoundError', async () => {
    const m = await modules();
    const a = await seed(m, 'T-cards cartao A');
    const b = await seed(m, 'T-cards cartao B');
    try {
      await m.cards.updateCard(a.householdId, a.cardId, {
        name: 'Cartão novo',
        bank: null,
        brand: 'visa',
        holderMemberId: null,
        paymentAccountId: null,
        creditLimitCents: null,
        closingDay: 5,
        dueDay: 15,
      });
      const [row] = await m.db
        .select({ name: m.schema.creditCards.name })
        .from(m.schema.creditCards)
        .where(eq(m.schema.creditCards.id, a.cardId));
      expect(row?.name).toBe('Cartão novo');

      await expect(
        m.cards.updateCard(a.householdId, b.cardId, {
          name: 'Invasão',
          bank: null,
          brand: 'visa',
          holderMemberId: null,
          paymentAccountId: null,
          creditLimitCents: null,
          closingDay: 5,
          dueDay: 15,
        }),
      ).rejects.toBeInstanceOf(m.cards.CardNotFoundError);
      const [other] = await m.db
        .select({ name: m.schema.creditCards.name })
        .from(m.schema.creditCards)
        .where(eq(m.schema.creditCards.id, b.cardId));
      expect(other?.name).toBe('Cartão');
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });

  it('deactivateCard desativa o próprio e recusa o alheio', async () => {
    const m = await modules();
    const a = await seed(m, 'T-cards desativa cartao A');
    const b = await seed(m, 'T-cards desativa cartao B');
    try {
      await m.cards.deactivateCard(a.householdId, a.cardId);
      const [row] = await m.db
        .select({ active: m.schema.creditCards.active })
        .from(m.schema.creditCards)
        .where(eq(m.schema.creditCards.id, a.cardId));
      expect(row?.active).toBe(false);

      await expect(m.cards.deactivateCard(a.householdId, b.cardId)).rejects.toBeInstanceOf(
        m.cards.CardNotFoundError,
      );
      const [other] = await m.db
        .select({ active: m.schema.creditCards.active })
        .from(m.schema.creditCards)
        .where(eq(m.schema.creditCards.id, b.cardId));
      expect(other?.active).toBe(true);
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });
});
