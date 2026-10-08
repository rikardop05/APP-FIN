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
 * Integracao de proposito: o upsert por (cartao, final), o CHECK do final e o
 * isolamento por household so se provam contra o PostgreSQL.
 *
 * Disciplina do banco unico: household PROPRIO, apagado no `finally` (cascade
 * leva cartoes, membros e mapeamentos).
 */

async function modules() {
  const [{ db }, schema, holders, cards, imports] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./card-holders'),
    import('./cards'),
    import('./import'),
  ]);
  return { db, schema, holders, cards, imports };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name = 'D20 card holders test') {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;
  const suffix = crypto.randomUUID();
  const [ana, bia] = await db
    .insert(schema.members)
    .values([
      { householdId, name: 'Ana', email: `ana-${suffix}@teste.invalid`, color: '#000000' },
      { householdId, name: 'Bia', email: `bia-${suffix}@teste.invalid`, color: '#ffffff' },
    ])
    .returning({ id: schema.members.id });
  const [card, other] = await db
    .insert(schema.creditCards)
    .values([
      { householdId, name: 'Cartão A', closingDay: 1, dueDay: 10 },
      { householdId, name: 'Cartão B', closingDay: 5, dueDay: 15 },
    ])
    .returning({ id: schema.creditCards.id });
  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  if (!ana || !bia || !card || !other || !account) throw new Error('Fixture não foi criada.');
  return { householdId, ana: ana.id, bia: bia.id, card: card.id, other: other.id, account: account.id };
}

async function cleanup(m: Modules, householdId: string) {
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
}

describe.skipIf(!process.env.DATABASE_URL)('credit_card_holders (integração)', () => {
  it('upsert grava, troca o membro do mesmo final e lista por final', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '9999', memberId: s.ana });
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '1234', memberId: s.ana });
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '9999', memberId: s.bia });

      const byCard = await m.holders.listCardHolders(s.householdId);
      const list = byCard.get(s.card) ?? [];
      expect(list.map((h) => [h.last4, h.memberId])).toEqual([
        ['1234', s.ana],
        ['9999', s.bia],
      ]);
      expect(byCard.get(s.other)).toBeUndefined();
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('o mesmo final em cartões diferentes são mapeamentos independentes', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '4239', memberId: s.ana });
      await m.holders.upsertCardHolder(s.householdId, s.other, { last4: '4239', memberId: s.bia });
      expect(await m.holders.cardHoldersByLast4(s.householdId, s.card)).toEqual(new Map([['4239', s.ana]]));
      expect(await m.holders.cardHoldersByLast4(s.householdId, s.other)).toEqual(new Map([['4239', s.bia]]));
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('recusa final que não seja 4 dígitos, mesmo passando por fora da query (CHECK)', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      for (const last4 of ['123', '12345', 'abcd', '12 4', '']) {
        await expect(
          m.holders.upsertCardHolder(s.householdId, s.card, { last4, memberId: s.ana }),
        ).rejects.toBeInstanceOf(m.holders.InvalidCardHolderError);
      }
      await expect(
        m.db.insert(m.schema.creditCardHolders).values({
          householdId: s.householdId,
          creditCardId: s.card,
          last4: '12a4',
          memberId: s.ana,
        }),
      ).rejects.toThrow();
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('cartão de outro household: CardNotFoundError; membro de outro household: InvalidCardHolderError', async () => {
    const m = await modules();
    const s = await seed(m);
    const o = await seed(m, 'D20 outro household');
    try {
      await expect(
        m.holders.upsertCardHolder(s.householdId, o.card, { last4: '1111', memberId: s.ana }),
      ).rejects.toBeInstanceOf(m.holders.CardNotFoundError);
      await expect(
        m.holders.upsertCardHolder(s.householdId, s.card, { last4: '1111', memberId: o.ana }),
      ).rejects.toBeInstanceOf(m.holders.InvalidCardHolderError);
      expect((await m.holders.listCardHolders(o.householdId)).size).toBe(0);
    } finally {
      await cleanup(m, s.householdId);
      await cleanup(m, o.householdId);
    }
  });

  it('delete exige que o mapeamento seja do cartão e do household', async () => {
    const m = await modules();
    const s = await seed(m);
    const o = await seed(m, 'D20 outro household');
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '2387', memberId: s.ana });
      const [holder] = (await m.holders.listCardHolders(s.householdId)).get(s.card) ?? [];
      if (!holder) throw new Error('Mapeamento não foi criado.');

      await expect(
        m.holders.deleteCardHolder(s.householdId, s.other, holder.id),
      ).rejects.toBeInstanceOf(m.holders.CardHolderNotFoundError);
      await expect(
        m.holders.deleteCardHolder(o.householdId, s.card, holder.id),
      ).rejects.toBeInstanceOf(m.holders.CardHolderNotFoundError);
      expect((await m.holders.listCardHolders(s.householdId)).get(s.card)).toHaveLength(1);

      await m.holders.deleteCardHolder(s.householdId, s.card, holder.id);
      expect((await m.holders.listCardHolders(s.householdId)).get(s.card)).toBeUndefined();
    } finally {
      await cleanup(m, s.householdId);
      await cleanup(m, o.householdId);
    }
  });

  it('listCards traz holders de cada cartão, ordenados por final; cartão sem mapeamento traz []', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '9999', memberId: s.bia });
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '0001', memberId: s.ana });
      const cards = await m.cards.listCards(s.householdId);
      const a = cards.find((c) => c.id === s.card);
      const b = cards.find((c) => c.id === s.other);
      expect(a?.holders.map(({ last4, memberId }) => ({ last4, memberId }))).toEqual([
        { last4: '0001', memberId: s.ana },
        { last4: '9999', memberId: s.bia },
      ]);
      expect(Object.keys(a?.holders[0] ?? {}).sort()).toEqual(['id', 'last4', 'memberId']);
      expect(b?.holders).toEqual([]);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('prepareImport devolve cardHolders do cartão da importação; conta devolve mapa vazio', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '4239', memberId: s.bia });
      await m.holders.upsertCardHolder(s.householdId, s.other, { last4: '7777', memberId: s.ana });

      const card = await m.imports.prepareImport(s.householdId, 'credit_card', s.card, 'h'.repeat(64));
      expect(card.cardHolders).toEqual(new Map([['4239', s.bia]]));

      const account = await m.imports.prepareImport(s.householdId, 'account', s.account, 'h'.repeat(64));
      expect(account.cardHolders.size).toBe(0);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('apagar o membro ou o cartão leva o mapeamento junto (cascade)', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.holders.upsertCardHolder(s.householdId, s.card, { last4: '1111', memberId: s.ana });
      await m.holders.upsertCardHolder(s.householdId, s.other, { last4: '2222', memberId: s.bia });
      await m.db
        .delete(m.schema.members)
        .where(and(eq(m.schema.members.id, s.ana), eq(m.schema.members.householdId, s.householdId)));
      await m.db
        .delete(m.schema.creditCards)
        .where(and(eq(m.schema.creditCards.id, s.other), eq(m.schema.creditCards.householdId, s.householdId)));
      expect((await m.holders.listCardHolders(s.householdId)).size).toBe(0);
    } finally {
      await cleanup(m, s.householdId);
    }
  });
});
