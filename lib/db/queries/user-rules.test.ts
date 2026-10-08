import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local, o teste fica pulado.
  }
}

/**
 * F5: regra criada pelo usuario (politica unica: entra no topo) e a oferta de
 * regra depois de categorizar a mao, com aceite atomico.
 */
async function createFixture(label: string) {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `F5 regras ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste nao foi criado.');
  const householdId = household.id;

  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  const [member] = await db
    .insert(schema.members)
    .values({ householdId, name: 'Pessoa', email: `f5-${label}-${householdId}@teste.local`, color: '#000000' })
    .returning({ id: schema.members.id });
  const [mercado, casa, alimentacao, salario] = await db
    .insert(schema.categories)
    .values([
      { householdId, name: 'Mercado', nature: 'essential' },
      { householdId, name: 'Casa', nature: 'non_essential' },
      { householdId, name: 'Alimentacao', nature: 'essential' },
      { householdId, name: 'Salario', nature: 'income' },
    ])
    .returning({ id: schema.categories.id });
  if (!account || !member || !mercado || !casa || !alimentacao || !salario) throw new Error('Fixture incompleta.');
  await db.insert(schema.categories).values({ householdId, name: 'Delivery', nature: 'non_essential', parentId: alimentacao.id });
  const accountId = account.id;

  async function rule(pattern: string, categoryId: string, priority: number) {
    const [row] = await db
      .insert(schema.categorizationRules)
      .values({ householdId, pattern, matchType: 'contains', categoryId, priority, hits: 0 })
      .returning({ id: schema.categorizationRules.id });
    if (row === undefined) throw new Error('Regra nao criada.');
    return row.id;
  }

  async function tx(description: string, extra: Partial<typeof schema.transactions.$inferInsert> = {}) {
    const [row] = await db
      .insert(schema.transactions)
      .values({
        householdId,
        occurredOn: '2026-09-05',
        competence: '2026-09',
        description,
        rawDescription: description,
        amountCents: cents(-1000),
        kind: 'expense',
        accountId,
        ...extra,
      })
      .returning({ id: schema.transactions.id });
    if (row === undefined) throw new Error('Lancamento nao criado.');
    return row.id;
  }

  async function read(id: string) {
    const [row] = await db
      .select({ categoryId: schema.transactions.categoryId, categoryRuleId: schema.transactions.categoryRuleId })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id));
    return row;
  }

  async function rules() {
    return db
      .select({
        id: schema.categorizationRules.id,
        pattern: schema.categorizationRules.pattern,
        categoryId: schema.categorizationRules.categoryId,
        memberId: schema.categorizationRules.memberId,
        priority: schema.categorizationRules.priority,
      })
      .from(schema.categorizationRules)
      .where(eq(schema.categorizationRules.householdId, householdId))
      .orderBy(asc(schema.categorizationRules.priority), asc(schema.categorizationRules.id));
  }

  return {
    db,
    schema,
    householdId,
    memberId: member.id,
    mercadoId: mercado.id,
    casaId: casa.id,
    alimentacaoId: alimentacao.id,
    salarioId: salario.id,
    rule,
    tx,
    read,
    rules,
    cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('createUserRule (F5)', () => {
  it('entra no TOPO da ordem: prioridade = menor - 1', async () => {
    const f = await createFixture('topo');
    try {
      const { createUserRule } = await import('./user-rules');
      await f.rule('antiga', f.casaId, 3);
      await f.rule('outra', f.casaId, 7);
      const id = await createUserRule(f.householdId, { pattern: 'nova', matchType: 'contains', categoryId: f.mercadoId, memberId: f.memberId });
      const rules = await f.rules();
      // menor era 3: 3 - 1 = 2.
      expect(rules[0]).toEqual({ id, pattern: 'nova', categoryId: f.mercadoId, memberId: f.memberId, priority: 2 });
    } finally {
      await f.cleanup();
    }
  });

  it('household sem regras: primeira regra fica com prioridade 0', async () => {
    const f = await createFixture('primeira');
    try {
      const { createUserRule } = await import('./user-rules');
      await createUserRule(f.householdId, { pattern: 'nova', matchType: 'contains', categoryId: f.mercadoId, memberId: null });
      expect((await f.rules()).map((r) => r.priority)).toEqual([0]);
    } finally {
      await f.cleanup();
    }
  });

  it('recusa categoria agrupamento, categoria ou membro de outro household', async () => {
    const f = await createFixture('invalida');
    const outro = await createFixture('invalida-outro');
    try {
      const { createUserRule, InvalidUserRuleError } = await import('./user-rules');
      const base = { pattern: 'x', matchType: 'contains' as const, memberId: null };
      await expect(createUserRule(f.householdId, { ...base, categoryId: f.alimentacaoId })).rejects.toThrow(InvalidUserRuleError);
      await expect(createUserRule(f.householdId, { ...base, categoryId: outro.mercadoId })).rejects.toThrow(InvalidUserRuleError);
      await expect(
        createUserRule(f.householdId, { ...base, categoryId: f.mercadoId, memberId: outro.memberId }),
      ).rejects.toThrow(InvalidUserRuleError);
      expect(await f.rules()).toEqual([]);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('getRuleOffer / acceptRuleOffer (F5)', () => {
  it('oferta: padrao, categoria e as outras sem categoria que a regra pegaria', async () => {
    const f = await createFixture('oferta');
    try {
      const { getRuleOffer } = await import('./user-rules');
      const fonte = await f.tx('[final 4239] IRMAOS BOA', { categoryId: f.mercadoId });
      const outra = await f.tx('IRMAOS BOA');
      await f.tx('OUTRA LOJA');

      expect(await getRuleOffer(f.householdId, [fonte])).toEqual({
        pattern: 'irmaos boa',
        categoryId: f.mercadoId,
        categoryName: 'Mercado',
        matchingIds: [outra],
      });
    } finally {
      await f.cleanup();
    }
  });

  it('sem oferta: linha sem categoria, ja coberta por regra, ou de outro household', async () => {
    const f = await createFixture('sem-oferta');
    const outro = await createFixture('sem-oferta-outro');
    try {
      const { getRuleOffer } = await import('./user-rules');
      const semCategoria = await f.tx('IRMAOS BOA');
      await f.rule('kabum', f.mercadoId, 1);
      const coberta = await f.tx('KABUM', { categoryId: f.mercadoId });
      const alheia = await outro.tx('IRMAOS BOA', { categoryId: outro.mercadoId });

      expect(await getRuleOffer(f.householdId, [semCategoria])).toBeNull();
      expect(await getRuleOffer(f.householdId, [coberta])).toBeNull();
      expect(await getRuleOffer(f.householdId, [alheia])).toBeNull();
      expect(await getRuleOffer(f.householdId, [])).toBeNull();
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('aceite: cria a regra no topo e categoriza EXATAMENTE as linhas da oferta, numa transacao', async () => {
    const f = await createFixture('aceite');
    try {
      const { acceptRuleOffer } = await import('./user-rules');
      await f.rule('irmaos', f.casaId, 5);
      const fonte = await f.tx('IRMAOS BOA', { categoryId: f.mercadoId });
      const outra = await f.tx('IRMAOS BOA (2)');
      const naoOfertada = await f.tx('IRMAOS BOA LTDA');

      const result = await acceptRuleOffer(f.householdId, {
        transactionIds: [fonte],
        pattern: 'irmaos boa',
        matchingIds: [outra],
      });
      expect(result).toMatchObject({ applied: 1, skipped: 0, propagated: 0 });
      const rules = await f.rules();
      expect(rules[0]).toMatchObject({ id: result.ruleId, pattern: 'irmaos boa', categoryId: f.mercadoId, priority: 4 });
      expect(await f.read(outra)).toEqual({ categoryId: f.mercadoId, categoryRuleId: result.ruleId });
      // Casaria, mas nao estava na oferta que o usuario viu.
      expect(await f.read(naoOfertada)).toEqual({ categoryId: null, categoryRuleId: null });
      // A linha de origem foi categorizada a mao e continua assim.
      expect(await f.read(fonte)).toEqual({ categoryId: f.mercadoId, categoryRuleId: null });
    } finally {
      await f.cleanup();
    }
  });

  it('aceite com linhas de origem que nao valem mais (sem categoria, categorias diferentes): recusado sem gravar', async () => {
    const f = await createFixture('aceite-invalido');
    try {
      const { acceptRuleOffer, RuleOfferNoLongerValidError } = await import('./user-rules');
      const semCategoria = await f.tx('IRMAOS BOA');
      const a = await f.tx('IRMAOS BOA', { categoryId: f.mercadoId });
      const b = await f.tx('IRMAOS BOA', { categoryId: f.casaId });

      await expect(
        acceptRuleOffer(f.householdId, { transactionIds: [semCategoria], pattern: 'irmaos boa', matchingIds: [] }),
      ).rejects.toThrow(RuleOfferNoLongerValidError);
      await expect(
        acceptRuleOffer(f.householdId, { transactionIds: [a, b], pattern: 'irmaos boa', matchingIds: [] }),
      ).rejects.toThrow(RuleOfferNoLongerValidError);
      expect(await f.rules()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('confirmReviewGroup: rastro respeita natureza x tipo (F5)', () => {
  it('regra de receita mais prioritaria nao rouba o rastro de uma despesa', async () => {
    const f = await createFixture('rastro-natureza');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      await f.rule('pix', f.salarioId, 0);
      const pixJoao = await f.rule('pix joao', f.casaId, 1);
      const enviado = await f.tx('PIX JOAO');

      await confirmReviewGroup(f.householdId, { transactionIds: [enviado], categoryId: f.casaId, newRulePattern: null });
      // "pix" (Salario) nao cabe numa despesa: a vencedora que cabe e "pix joao".
      expect(await f.read(enviado)).toEqual({ categoryId: f.casaId, categoryRuleId: pixJoao });
    } finally {
      await f.cleanup();
    }
  });
});
