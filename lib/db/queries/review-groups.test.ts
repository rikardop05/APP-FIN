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
 * F4: revisao dos nao categorizados em grupos. Integracao: o que se prova e a
 * leitura com os mesmos cortes da aplicacao de regras, e que confirmar um
 * grupo grava categoria, regra nova, rastro e hits numa transacao so.
 */
async function createFixture(label: string) {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `F4 revisar ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste nao foi criado.');
  const householdId = household.id;

  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  const [card] = await db
    .insert(schema.creditCards)
    .values({
      householdId,
      name: 'Cartao',
      bank: null,
      brand: 'other',
      holderMemberId: null,
      paymentAccountId: null,
      creditLimitCents: null,
      closingDay: 10,
      dueDay: 20,
      active: true,
    })
    .returning({ id: schema.creditCards.id });
  const [mercado, casa, alimentacao] = await db
    .insert(schema.categories)
    .values([
      { householdId, name: 'Mercado', nature: 'essential' },
      { householdId, name: 'Casa', nature: 'non_essential' },
      { householdId, name: 'Alimentacao', nature: 'essential' },
    ])
    .returning({ id: schema.categories.id });
  if (!account || !card || !mercado || !casa || !alimentacao) throw new Error('Fixture incompleta.');
  // "Alimentacao" vira agrupamento: tem filha, nao e destino de lancamento.
  await db.insert(schema.categories).values({ householdId, name: 'Delivery', nature: 'non_essential', parentId: alimentacao.id });
  const accountId = account.id;
  const cardId = card.id;

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

  async function plan(description: string, categoryId: string | null = null) {
    const [row] = await db
      .insert(schema.installmentPlans)
      .values({
        householdId,
        creditCardId: cardId,
        description,
        totalCents: cents(-2000),
        installmentsCount: 2,
        firstCompetence: '2026-09',
        categoryId,
        source: 'import',
      })
      .returning({ id: schema.installmentPlans.id });
    if (row === undefined) throw new Error('Plano nao criado.');
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
        priority: schema.categorizationRules.priority,
        hits: schema.categorizationRules.hits,
      })
      .from(schema.categorizationRules)
      .where(eq(schema.categorizationRules.householdId, householdId))
      .orderBy(asc(schema.categorizationRules.priority), asc(schema.categorizationRules.id));
  }

  return {
    db,
    schema,
    householdId,
    cardId,
    accountId,
    mercadoId: mercado.id,
    casaId: casa.id,
    alimentacaoId: alimentacao.id,
    rule,
    tx,
    plan,
    read,
    rules,
    cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('listReviewGroups (F4)', () => {
  it('agrupa os revisaveis por loja, maior valor primeiro, com amostra e categoria sugerida', async () => {
    const f = await createFixture('listar');
    try {
      const { listReviewGroups } = await import('./review-groups');
      const kabum = await f.rule('kabum', f.mercadoId, 1);
      const ib1 = await f.tx('[final 4239] IRMAOS BOA', { amountCents: cents(-10000) });
      const ib2 = await f.tx('IRMAOS BOA', { amountCents: cents(-2550), occurredOn: '2026-09-20' });
      const kb = await f.tx('KABUM ONLINE', { amountCents: cents(-4000) });
      const pix = await f.tx('PIX MARIA', { amountCents: cents(50000), kind: 'income' });
      await f.tx('IRMAOS BOA', { categoryId: f.casaId }); // ja categorizada
      await f.tx('PAGAMENTO FATURA', { kind: 'credit_card_payment' }); // fora da revisao

      const groups = await listReviewGroups(f.householdId);
      expect(groups.map((g) => [g.pattern, g.transactionIds, g.totalCents, g.direction])).toEqual([
        ['pix maria', [pix], 50000, 'in'],
        // -10000 + -2550 = -12550; a lista vem por data desc, a de 20/09 primeiro.
        ['irmaos boa', [ib2, ib1], -12550, 'out'],
        ['kabum', [kb], -4000, 'out'],
      ]);
      expect(groups[1]).toMatchObject({
        count: 2,
        sampleDescriptions: ['IRMAOS BOA', '[final 4239] IRMAOS BOA'],
        ruleId: null,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
      });
      expect(groups[2]).toMatchObject({ ruleId: kabum, suggestedCategoryId: f.mercadoId, suggestedCategoryName: 'Mercado' });
    } finally {
      await f.cleanup();
    }
  });

  it('amostra traz no maximo 3 descricoes distintas', async () => {
    const f = await createFixture('amostra');
    try {
      const { listReviewGroups } = await import('./review-groups');
      for (const sufixo of ['', ' 1', ' 2', ' 3', ' 4']) await f.tx(`LOJA X${sufixo}`);
      await f.tx('LOJA X');

      const [group] = await listReviewGroups(f.householdId);
      expect(group?.count).toBe(6);
      expect(group?.sampleDescriptions).toHaveLength(3);
      expect(new Set(group?.sampleDescriptions).size).toBe(3);
    } finally {
      await f.cleanup();
    }
  });

  it('regra de categoria de receita nao sugere a si mesma para um Pix enviado', async () => {
    const f = await createFixture('listar-natureza');
    try {
      const { listReviewGroups } = await import('./review-groups');
      const [salario] = await f.db
        .insert(f.schema.categories)
        .values({ householdId: f.householdId, name: 'Salario', nature: 'income' })
        .returning({ id: f.schema.categories.id });
      if (salario === undefined) throw new Error('Categoria nao criada.');
      const pix = await f.rule('pix', salario.id, 1);
      await f.tx('PIX MARIA', { amountCents: cents(-300) });
      await f.tx('PIX MARIA', { amountCents: cents(500), kind: 'income' });

      const groups = await listReviewGroups(f.householdId);
      expect(groups.map((g) => [g.direction, g.ruleId, g.suggestedCategoryId])).toEqual([
        ['in', pix, salario.id],
        ['out', null, null],
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it('household sem nada a revisar devolve lista vazia', async () => {
    const f = await createFixture('vazio');
    try {
      const { listReviewGroups } = await import('./review-groups');
      expect(await listReviewGroups(f.householdId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('confirmReviewGroup (F4)', () => {
  it('com regra nova: cria a regra no topo, categoriza o grupo, grava rastro e hits', async () => {
    const f = await createFixture('confirmar-regra');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      // Regra antiga e mais ampla, apontando para outra categoria: a nova,
      // decidida agora pelo usuario, tem de vencer nas proximas importacoes.
      const antiga = await f.rule('irmaos', f.casaId, 0);
      const a = await f.tx('[final 4239] IRMAOS BOA');
      const b = await f.tx('IRMAOS BOA (2/3)', { status: 'planned', rawDescription: '' });
      // No grupo, mas o padrao editado nao a casa: categoriza sem rastro.
      const c = await f.tx('IRMAOS B. LTDA');

      const result = await confirmReviewGroup(f.householdId, {
        transactionIds: [a, b, c],
        categoryId: f.mercadoId,
        newRulePattern: '  irmaos boa ',
      });

      expect(result.categorized).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.propagated).toBe(0);
      const rules = await f.rules();
      expect(rules.map((r) => [r.pattern, r.categoryId])).toEqual([
        ['irmaos boa', f.mercadoId],
        ['irmaos', f.casaId],
      ]);
      expect(rules[0]?.id).toBe(result.ruleId);
      expect(rules[0]?.priority).toBeLessThan(0);
      expect(await f.read(a)).toEqual({ categoryId: f.mercadoId, categoryRuleId: result.ruleId });
      expect(await f.read(b)).toEqual({ categoryId: f.mercadoId, categoryRuleId: result.ruleId });
      expect(await f.read(c)).toEqual({ categoryId: f.mercadoId, categoryRuleId: null });
      // So a linha real (a) e uso da regra nova; a antiga nao ganhou nada.
      expect(rules[0]?.hits).toBe(1);
      expect(rules.find((r) => r.id === antiga)?.hits).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it('sem regra nova: grupo de regra existente confirmado leva o rastro dela e soma hits', async () => {
    const f = await createFixture('confirmar-existente');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      const kabum = await f.rule('kabum', f.mercadoId, 1);
      const a = await f.tx('KABUM');
      const b = await f.tx('OUTRA LOJA');

      const result = await confirmReviewGroup(f.householdId, { transactionIds: [a, b], categoryId: f.mercadoId, newRulePattern: null });
      expect(result).toEqual({ categorized: 2, skipped: 0, propagated: 0, ruleId: null });
      expect(await f.read(a)).toEqual({ categoryId: f.mercadoId, categoryRuleId: kabum });
      // Nenhuma regra casa: categoria a mao.
      expect(await f.read(b)).toEqual({ categoryId: f.mercadoId, categoryRuleId: null });
      expect((await f.rules()).map((r) => r.hits)).toEqual([1]);
    } finally {
      await f.cleanup();
    }
  });

  it('usuario escolheu categoria diferente da regra existente: sem rastro, sem hits', async () => {
    const f = await createFixture('confirmar-diferente');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      await f.rule('kabum', f.mercadoId, 1);
      const a = await f.tx('KABUM');

      await confirmReviewGroup(f.householdId, { transactionIds: [a], categoryId: f.casaId, newRulePattern: null });
      expect(await f.read(a)).toEqual({ categoryId: f.casaId, categoryRuleId: null });
      expect((await f.rules()).map((r) => r.hits)).toEqual([0]);
    } finally {
      await f.cleanup();
    }
  });

  it('pula linha ja categorizada, de outro household ou fora da revisao, sem sobrescrever', async () => {
    const f = await createFixture('confirmar-corrida');
    const outro = await createFixture('confirmar-corrida-outro');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      const categorizada = await f.tx('LOJA', { categoryId: f.casaId });
      const alheia = await outro.tx('LOJA');
      const pagamento = await f.tx('LOJA', { kind: 'credit_card_payment' });
      const boa = await f.tx('LOJA');

      const result = await confirmReviewGroup(f.householdId, {
        transactionIds: [categorizada, alheia, pagamento, boa],
        categoryId: f.mercadoId,
        newRulePattern: null,
      });
      expect(result).toEqual({ categorized: 1, skipped: 3, propagated: 0, ruleId: null });
      expect(await f.read(categorizada)).toMatchObject({ categoryId: f.casaId });
      expect(await outro.read(alheia)).toMatchObject({ categoryId: null });
      expect(await f.read(pagamento)).toMatchObject({ categoryId: null });
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('categoria invalida (de outro household ou agrupamento) e recusada e nada e gravado', async () => {
    const f = await createFixture('confirmar-invalida');
    const outro = await createFixture('confirmar-invalida-outro');
    try {
      const { confirmReviewGroup, ReviewCategoryInvalidError } = await import('./review-groups');
      const a = await f.tx('LOJA');

      await expect(
        confirmReviewGroup(f.householdId, { transactionIds: [a], categoryId: outro.mercadoId, newRulePattern: 'loja' }),
      ).rejects.toThrow(ReviewCategoryInvalidError);
      await expect(
        confirmReviewGroup(f.householdId, { transactionIds: [a], categoryId: f.alimentacaoId, newRulePattern: 'loja' }),
      ).rejects.toThrow(ReviewCategoryInvalidError);
      expect(await f.read(a)).toMatchObject({ categoryId: null });
      expect(await f.rules()).toEqual([]);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('categoria de receita num grupo de despesa e recusada no servidor, sem gravar nada', async () => {
    const f = await createFixture('confirmar-natureza');
    try {
      const { confirmReviewGroup, ReviewCategoryKindError } = await import('./review-groups');
      const [receita] = await f.db
        .insert(f.schema.categories)
        .values({ householdId: f.householdId, name: 'Reembolsos', nature: 'income' })
        .returning({ id: f.schema.categories.id });
      if (receita === undefined) throw new Error('Categoria nao criada.');
      const despesa = await f.tx('LOJA');
      const entrada = await f.tx('PIX MARIA', { kind: 'income', amountCents: cents(5000) });

      await expect(
        confirmReviewGroup(f.householdId, { transactionIds: [despesa], categoryId: receita.id, newRulePattern: 'loja' }),
      ).rejects.toThrow(ReviewCategoryKindError);
      await expect(
        confirmReviewGroup(f.householdId, { transactionIds: [entrada], categoryId: f.mercadoId, newRulePattern: null }),
      ).rejects.toThrow(ReviewCategoryKindError);
      expect(await f.read(despesa)).toMatchObject({ categoryId: null });
      expect(await f.read(entrada)).toMatchObject({ categoryId: null });
      expect(await f.rules()).toEqual([]);

      // Receita em categoria de receita passa.
      const ok = await confirmReviewGroup(f.householdId, { transactionIds: [entrada], categoryId: receita.id, newRulePattern: null });
      expect(ok.categorized).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it('nada a categorizar (todas puladas): a regra pedida NAO e criada', async () => {
    const f = await createFixture('confirmar-nada');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      const jaCategorizada = await f.tx('LOJA', { categoryId: f.casaId });

      const result = await confirmReviewGroup(f.householdId, {
        transactionIds: [jaCategorizada],
        categoryId: f.mercadoId,
        newRulePattern: 'loja',
      });
      expect(result).toEqual({ categorized: 0, skipped: 1, propagated: 0, ruleId: null });
      expect(await f.rules()).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it('parcela confirmada leva a categoria ao plano sem categoria e as parcelas sem categoria', async () => {
    const f = await createFixture('confirmar-parcela');
    try {
      const { confirmReviewGroup } = await import('./review-groups');
      const plano = await f.plan('KABUM');
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('KABUM', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KABUM (2/2)', { ...onCard, installmentNumber: 2, status: 'planned', rawDescription: '' });

      const result = await confirmReviewGroup(f.householdId, { transactionIds: [p1], categoryId: f.mercadoId, newRulePattern: null });
      expect(result).toEqual({ categorized: 1, skipped: 0, propagated: 1, ruleId: null });
      expect(await f.read(p2)).toMatchObject({ categoryId: f.mercadoId });
    } finally {
      await f.cleanup();
    }
  });
});
