import { eq } from 'drizzle-orm';
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
 * F3: aplicar regras aos lancamentos que JA existem, com previa antes de gravar.
 * Integracao: o que se prova e o filtro por household, a corrida "alguem
 * categorizou entre a previa e o gravar" e a propagacao no parcelamento.
 */
async function createFixture(label: string) {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `F3 aplicar ${label}` })
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
  const [member] = await db
    .insert(schema.members)
    .values({ householdId, name: 'Pessoa', email: `f3-${label}-${householdId}@teste.local`, color: '#000000' })
    .returning({ id: schema.members.id });
  const [mercado, casa] = await db
    .insert(schema.categories)
    .values([
      { householdId, name: 'Mercado', nature: 'essential' },
      { householdId, name: 'Casa', nature: 'non_essential' },
    ])
    .returning({ id: schema.categories.id });
  if (!account || !card || !member || !mercado || !casa) throw new Error('Fixture incompleta.');

  async function rule(pattern: string, categoryId: string, priority: number, extra: { memberId?: string; active?: boolean } = {}) {
    const [row] = await db
      .insert(schema.categorizationRules)
      .values({ householdId, pattern, matchType: 'contains', categoryId, priority, hits: 0, ...extra })
      .returning({ id: schema.categorizationRules.id });
    if (row === undefined) throw new Error('Regra nao criada.');
    return row.id;
  }

  async function tx(
    description: string,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) {
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
        accountId: account!.id,
        ...extra,
      })
      .returning({ id: schema.transactions.id });
    if (row === undefined) throw new Error('Lancamento nao criado.');
    return row.id;
  }

  async function read(id: string) {
    const [row] = await db
      .select({
        categoryId: schema.transactions.categoryId,
        categoryRuleId: schema.transactions.categoryRuleId,
        memberId: schema.transactions.memberId,
      })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id));
    return row;
  }

  async function hits(ruleId: string) {
    const [row] = await db
      .select({ hits: schema.categorizationRules.hits })
      .from(schema.categorizationRules)
      .where(eq(schema.categorizationRules.id, ruleId));
    return row?.hits;
  }

  return {
    db,
    schema,
    householdId,
    cardId: card.id,
    memberId: member.id,
    mercadoId: mercado.id,
    casaId: casa.id,
    rule,
    tx,
    read,
    hits,
    cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('previewRuleApplication (F3)', () => {
  it('todas as regras: cada linha revisavel vai para a primeira regra por prioridade', async () => {
    const f = await createFixture('previa-todas');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      const especifica = await f.rule('irmaos boa', f.mercadoId, 1);
      const geral = await f.rule('irmaos', f.casaId, 2);
      const a = await f.tx('[final 4239] IRMAOS BOA');
      const b = await f.tx('IRMAOS LTDA');
      await f.tx('IRMAOS BOA', { categoryId: f.casaId }); // ja categorizada
      await f.tx('IRMAOS BOA', { kind: 'credit_card_payment' }); // nao revisavel
      await f.tx('IRMAOS BOA', { amountCents: cents(0) }); // valor zero
      await f.tx('OUTRA LOJA'); // nenhuma regra

      const proposals = await previewRuleApplication(f.householdId, null);
      expect(proposals.map((p) => [p.transactionId, p.ruleId, p.categoryId])).toEqual([
        [a, especifica, f.mercadoId],
        [b, geral, f.casaId],
      ]);
      expect(proposals[0]).toMatchObject({ rulePattern: 'irmaos boa', categoryName: 'Mercado', amountCents: -1000 });
    } finally {
      await f.cleanup();
    }
  });

  it('uma regra so: previa da regra nova, mesmo que outra de prioridade maior case', async () => {
    const f = await createFixture('previa-uma');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      await f.rule('irmaos boa', f.mercadoId, 1);
      const nova = await f.rule('irmaos', f.casaId, 2);
      const a = await f.tx('IRMAOS BOA');
      const b = await f.tx('IRMAOS LTDA');

      const proposals = await previewRuleApplication(f.householdId, nova);
      expect(proposals.map((p) => [p.transactionId, p.ruleId])).toEqual([
        [a, nova],
        [b, nova],
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it('regra de outro household e regra inativa nao propoem nada', async () => {
    const f = await createFixture('previa-isolada');
    const outro = await createFixture('previa-isolada-outro');
    try {
      const { previewRuleApplication, RuleToApplyNotFoundError } = await import('./apply-rules');
      const alheia = await outro.rule('irmaos', outro.casaId, 1);
      const inativa = await f.rule('irmaos', f.casaId, 1, { active: false });
      await f.tx('IRMAOS BOA');

      await expect(previewRuleApplication(f.householdId, alheia)).rejects.toThrow(RuleToApplyNotFoundError);
      expect(await previewRuleApplication(f.householdId, inativa)).toEqual([]);
      expect(await previewRuleApplication(f.householdId, null)).toEqual([]);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('applyRuleProposals (F3)', () => {
  it('grava exatamente os itens confirmados, com rastro da regra, membro sugerido e hits', async () => {
    const f = await createFixture('gravar');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('irmaos', f.mercadoId, 1, { memberId: f.memberId });
      const a = await f.tx('IRMAOS BOA');
      const b = await f.tx('IRMAOS BOA (2)');
      const naoMarcada = await f.tx('IRMAOS LTDA'); // casaria, mas o usuario desmarcou

      const result = await applyRuleProposals(f.householdId, [
        { transactionId: a, ruleId: regra },
        { transactionId: b, ruleId: regra },
      ]);
      expect(result).toEqual({ applied: 2, skipped: 0, propagated: 0 });
      expect(await f.read(a)).toEqual({ categoryId: f.mercadoId, categoryRuleId: regra, memberId: f.memberId });
      expect(await f.read(b)).toEqual({ categoryId: f.mercadoId, categoryRuleId: regra, memberId: f.memberId });
      expect(await f.read(naoMarcada)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      // 0 + 2 linhas reais.
      expect(await f.hits(regra)).toBe(2);
    } finally {
      await f.cleanup();
    }
  });

  it('pula o que mudou entre a previa e o gravar, sem sobrescrever nada', async () => {
    const f = await createFixture('corrida');
    const outro = await createFixture('corrida-outro');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('irmaos', f.mercadoId, 1);
      const categorizadaNoMeio = await f.tx('IRMAOS BOA', { categoryId: f.casaId });
      const naoCasaMais = await f.tx('OUTRA LOJA');
      const alheia = await outro.tx('IRMAOS BOA');
      const pagamento = await f.tx('IRMAOS BOA', { kind: 'credit_card_payment' });
      const boa = await f.tx('IRMAOS BOA');

      const result = await applyRuleProposals(f.householdId, [
        { transactionId: categorizadaNoMeio, ruleId: regra },
        { transactionId: naoCasaMais, ruleId: regra },
        { transactionId: alheia, ruleId: regra },
        { transactionId: pagamento, ruleId: regra },
        { transactionId: boa, ruleId: regra },
      ]);
      expect(result).toEqual({ applied: 1, skipped: 4, propagated: 0 });
      // Categoria posta a mao nunca e sobrescrita.
      expect(await f.read(categorizadaNoMeio)).toEqual({ categoryId: f.casaId, categoryRuleId: null, memberId: null });
      expect(await f.read(naoCasaMais)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      expect(await outro.read(alheia)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      expect(await f.hits(regra)).toBe(1);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('regra desativada ou de outro household entre a previa e o gravar: item pulado', async () => {
    const f = await createFixture('regra-mudou');
    const outro = await createFixture('regra-mudou-outro');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const inativa = await f.rule('irmaos', f.mercadoId, 1, { active: false });
      const alheia = await outro.rule('irmaos', outro.mercadoId, 1);
      const a = await f.tx('IRMAOS BOA');
      const b = await f.tx('IRMAOS LTDA');

      const result = await applyRuleProposals(f.householdId, [
        { transactionId: a, ruleId: inativa },
        { transactionId: b, ruleId: alheia },
      ]);
      expect(result).toEqual({ applied: 0, skipped: 2, propagated: 0 });
      expect(await f.read(a)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      expect(await outro.hits(alheia)).toBe(0);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('parcela categorizada propaga para o plano e as parcelas futuras; hits conta so a real', async () => {
    const f = await createFixture('parcela');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('kabum', f.mercadoId, 1);
      const [plan] = await f.db
        .insert(f.schema.installmentPlans)
        .values({
          householdId: f.householdId,
          creditCardId: f.cardId,
          description: 'KaBuM! - NuPay',
          totalCents: cents(-3000),
          installmentsCount: 3,
          firstCompetence: '2026-09',
          source: 'import',
        })
        .returning({ id: f.schema.installmentPlans.id });
      if (plan === undefined) throw new Error('Plano nao criado.');
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plan.id };
      const p1 = await f.tx('KaBuM! - NuPay', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KaBuM! - NuPay (2/3)', { ...onCard, installmentNumber: 2, status: 'planned', rawDescription: '' });
      const p3 = await f.tx('KaBuM! - NuPay (3/3)', { ...onCard, installmentNumber: 3, status: 'planned', rawDescription: '' });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra }]);
      // p1 gravada pela regra; p2 e p3 seguem o plano.
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 2 });
      const [planRow] = await f.db
        .select({ categoryId: f.schema.installmentPlans.categoryId })
        .from(f.schema.installmentPlans)
        .where(eq(f.schema.installmentPlans.id, plan.id));
      expect(planRow?.categoryId).toBe(f.mercadoId);
      expect(await f.read(p1)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: regra });
      // A categoria das futuras vem do plano, nao da regra (CONTRACTS §6.2).
      expect(await f.read(p2)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: null });
      expect(await f.read(p3)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: null });
      expect(await f.hits(regra)).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it('parcela de plano que ja tem categoria nao muda o plano', async () => {
    const f = await createFixture('parcela-plano-categorizado');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('kabum', f.mercadoId, 1);
      const [plan] = await f.db
        .insert(f.schema.installmentPlans)
        .values({
          householdId: f.householdId,
          creditCardId: f.cardId,
          description: 'KABUM',
          totalCents: cents(-2000),
          installmentsCount: 2,
          firstCompetence: '2026-09',
          categoryId: f.casaId,
          source: 'import',
        })
        .returning({ id: f.schema.installmentPlans.id });
      if (plan === undefined) throw new Error('Plano nao criado.');
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plan.id };
      const p1 = await f.tx('KABUM', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KABUM (2/2)', { ...onCard, installmentNumber: 2, categoryId: f.casaId });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra }]);
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 0 });
      expect(await f.read(p2)).toMatchObject({ categoryId: f.casaId });
    } finally {
      await f.cleanup();
    }
  });

  it('lista vazia nao grava nada', async () => {
    const f = await createFixture('vazia');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      expect(await applyRuleProposals(f.householdId, [])).toEqual({ applied: 0, skipped: 0, propagated: 0 });
    } finally {
      await f.cleanup();
    }
  });
});
