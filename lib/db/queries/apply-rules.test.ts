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
  const accountId = account.id;
  const cardId = card.id;

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
        accountId,
        ...extra,
      })
      .returning({ id: schema.transactions.id });
    if (row === undefined) throw new Error('Lancamento nao criado.');
    return row.id;
  }

  async function plan(description: string, installmentsCount: number, categoryId: string | null = null) {
    const [row] = await db
      .insert(schema.installmentPlans)
      .values({
        householdId,
        creditCardId: cardId,
        description,
        totalCents: cents(-1000 * installmentsCount),
        installmentsCount,
        firstCompetence: '2026-09',
        categoryId,
        source: 'import',
      })
      .returning({ id: schema.installmentPlans.id });
    if (row === undefined) throw new Error('Plano nao criado.');
    return row.id;
  }

  async function recurring(categoryId: string) {
    const [row] = await db
      .insert(schema.recurringExpenses)
      .values({
        householdId,
        description: 'IRMAOS BOA',
        expectedCents: cents(-1000),
        categoryId,
        dueDay: 5,
        startsOn: '2026-01-01',
        accountId,
      })
      .returning({ id: schema.recurringExpenses.id });
    if (row === undefined) throw new Error('Recorrencia nao criada.');
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

  async function planCategory(planId: string) {
    const [row] = await db
      .select({ categoryId: schema.installmentPlans.categoryId })
      .from(schema.installmentPlans)
      .where(eq(schema.installmentPlans.id, planId));
    return row?.categoryId;
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
    cardId,
    memberId: member.id,
    mercadoId: mercado.id,
    casaId: casa.id,
    rule,
    tx,
    plan,
    recurring,
    read,
    planCategory,
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

      const { proposals, total } = await previewRuleApplication(f.householdId, null);
      expect(total).toBe(2);
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

      const { proposals } = await previewRuleApplication(f.householdId, nova);
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
      expect(await previewRuleApplication(f.householdId, inativa)).toEqual({ proposals: [], total: 0 });
      expect(await previewRuleApplication(f.householdId, null)).toEqual({ proposals: [], total: 0 });
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('previsao de recorrencia nao entra: a categoria dela vem da definicao da recorrencia', async () => {
    const f = await createFixture('previa-recorrencia');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      await f.rule('irmaos', f.mercadoId, 1);
      const recorrencia = await f.recurring(f.casaId);
      await f.tx('IRMAOS BOA', { status: 'planned', recurringExpenseId: recorrencia });
      const real = await f.tx('IRMAOS BOA');

      const { proposals } = await previewRuleApplication(f.householdId, null);
      expect(proposals.map((p) => p.transactionId)).toEqual([real]);
    } finally {
      await f.cleanup();
    }
  });

  it('parcela de parcelamento JA categorizado nao entra: quem decide e o plano', async () => {
    const f = await createFixture('previa-plano');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      await f.rule('geladeira', f.mercadoId, 1);
      const categorizado = await f.plan('GELADEIRA', 2, f.casaId);
      const semCategoria = await f.plan('GELADEIRA', 2);
      const onCard = { accountId: null, creditCardId: f.cardId };
      await f.tx('GELADEIRA', { ...onCard, installmentPlanId: categorizado, installmentNumber: 1 });
      const livre = await f.tx('GELADEIRA', { ...onCard, installmentPlanId: semCategoria, installmentNumber: 1 });

      const { proposals } = await previewRuleApplication(f.householdId, null);
      expect(proposals.map((p) => p.transactionId)).toEqual([livre]);
    } finally {
      await f.cleanup();
    }
  });

  it('lancamento real vem antes da parcela projetada, mesmo com data mais antiga', async () => {
    // Com o limite, uma previa ordenada so por data poria na frente as
    // parcelas futuras, e o que ja aconteceu ficaria de fora.
    const f = await createFixture('previa-ordem');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      await f.rule('irmaos', f.mercadoId, 1);
      const futura = await f.tx('IRMAOS BOA (2/2)', { occurredOn: '2026-12-05', competence: '2026-12', status: 'planned', rawDescription: '' });
      const real = await f.tx('IRMAOS BOA', { occurredOn: '2026-09-05' });

      const { proposals } = await previewRuleApplication(f.householdId, null);
      expect(proposals.map((p) => p.transactionId)).toEqual([real, futura]);
    } finally {
      await f.cleanup();
    }
  });

  it('previa limitada: devolve ate o limite e informa o total', async () => {
    const f = await createFixture('previa-limite');
    try {
      const { previewRuleApplication } = await import('./apply-rules');
      await f.rule('irmaos', f.mercadoId, 1);
      const ids: string[] = [];
      for (let n = 0; n < 3; n += 1) ids.push(await f.tx('IRMAOS BOA'));

      const { proposals, total } = await previewRuleApplication(f.householdId, null, 2);
      expect(total).toBe(3);
      expect(proposals.map((p) => p.transactionId)).toEqual(ids.slice(0, 2));
    } finally {
      await f.cleanup();
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
        { transactionId: a, ruleId: regra, categoryId: f.mercadoId },
        { transactionId: b, ruleId: regra, categoryId: f.mercadoId },
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
      const item = (transactionId: string) => ({ transactionId, ruleId: regra, categoryId: f.mercadoId });

      const result = await applyRuleProposals(f.householdId, [
        item(categorizadaNoMeio),
        item(naoCasaMais),
        item(alheia),
        item(pagamento),
        item(boa),
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

  it('regra desativada, de outro household ou com categoria editada desde a previa: item pulado', async () => {
    const f = await createFixture('regra-mudou');
    const outro = await createFixture('regra-mudou-outro');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const inativa = await f.rule('irmaos', f.mercadoId, 1, { active: false });
      const alheia = await outro.rule('irmaos', outro.mercadoId, 1);
      // A previa mostrou "-> Casa"; a regra foi editada para Mercado antes do gravar.
      const editada = await f.rule('loja', f.mercadoId, 2);
      const a = await f.tx('IRMAOS BOA');
      const b = await f.tx('IRMAOS LTDA');
      const c = await f.tx('LOJA X');

      const result = await applyRuleProposals(f.householdId, [
        { transactionId: a, ruleId: inativa, categoryId: f.mercadoId },
        { transactionId: b, ruleId: alheia, categoryId: outro.mercadoId },
        { transactionId: c, ruleId: editada, categoryId: f.casaId },
      ]);
      expect(result).toEqual({ applied: 0, skipped: 3, propagated: 0 });
      expect(await f.read(a)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      expect(await f.read(c)).toEqual({ categoryId: null, categoryRuleId: null, memberId: null });
      expect(await outro.hits(alheia)).toBe(0);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('parcela gravada leva o plano e as parcelas SEM categoria; hits conta so a real', async () => {
    const f = await createFixture('parcela');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('kabum', f.mercadoId, 1);
      const plano = await f.plan('KaBuM! - NuPay', 3);
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('KaBuM! - NuPay', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KaBuM! - NuPay (2/3)', { ...onCard, installmentNumber: 2, status: 'planned', rawDescription: '' });
      const p3 = await f.tx('KaBuM! - NuPay (3/3)', { ...onCard, installmentNumber: 3, status: 'planned', rawDescription: '' });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra, categoryId: f.mercadoId }]);
      // p1 gravada pela regra; p2 e p3 seguem o plano.
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 2 });
      expect(await f.planCategory(plano)).toBe(f.mercadoId);
      expect(await f.read(p1)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: regra });
      // A categoria das outras vem do plano, nao da regra.
      expect(await f.read(p2)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: null });
      expect(await f.read(p3)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: null });
      expect(await f.hits(regra)).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it('propagacao NAO mexe em parcela que ja tem categoria, nem com rastro de outra regra', async () => {
    // Achado do Corvo: parcelas 1-2 categorizadas na importacao pela regra
    // "loja antiga" (Casa, com rastro); a 3 sem categoria recebe "kabum"
    // (Mercado). A previa mostrou UMA linha: so ela e as parcelas sem
    // categoria podem mudar.
    const f = await createFixture('parcela-irmas');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const loja = await f.rule('loja antiga', f.casaId, 1);
      const regra = await f.rule('kabum', f.mercadoId, 2);
      const plano = await f.plan('KABUM', 4);
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('KABUM', { ...onCard, installmentNumber: 1, categoryId: f.casaId, categoryRuleId: loja });
      const p2 = await f.tx('KABUM', { ...onCard, installmentNumber: 2, categoryId: f.casaId, categoryRuleId: loja });
      const p3 = await f.tx('KABUM', { ...onCard, installmentNumber: 3 });
      const p4 = await f.tx('KABUM (4/4)', { ...onCard, installmentNumber: 4, status: 'planned', rawDescription: '' });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p3, ruleId: regra, categoryId: f.mercadoId }]);
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 1 });
      expect(await f.read(p1)).toMatchObject({ categoryId: f.casaId, categoryRuleId: loja });
      expect(await f.read(p2)).toMatchObject({ categoryId: f.casaId, categoryRuleId: loja });
      expect(await f.read(p3)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: regra });
      expect(await f.read(p4)).toMatchObject({ categoryId: f.mercadoId, categoryRuleId: null });
    } finally {
      await f.cleanup();
    }
  });

  it('parcela de plano ja categorizado e pulada: a categoria e a do plano, nao a da regra', async () => {
    const f = await createFixture('parcela-plano-categorizado');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('geladeira', f.mercadoId, 1);
      const plano = await f.plan('GELADEIRA', 2, f.casaId);
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('GELADEIRA', { ...onCard, installmentNumber: 1 });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra, categoryId: f.mercadoId }]);
      expect(result).toEqual({ applied: 0, skipped: 1, propagated: 0 });
      expect(await f.read(p1)).toMatchObject({ categoryId: null });
      expect(await f.planCategory(plano)).toBe(f.casaId);
    } finally {
      await f.cleanup();
    }
  });

  it('regra de categoria de receita numa parcela: a parcela grava, o plano de despesa nao muda', async () => {
    const f = await createFixture('parcela-receita');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const [receita] = await f.db
        .insert(f.schema.categories)
        .values({ householdId: f.householdId, name: 'Reembolsos', nature: 'income' })
        .returning({ id: f.schema.categories.id });
      if (receita === undefined) throw new Error('Categoria nao criada.');
      const regra = await f.rule('kabum', receita.id, 1);
      const plano = await f.plan('KABUM', 2);
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('KABUM', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KABUM (2/2)', { ...onCard, installmentNumber: 2, status: 'planned', rawDescription: '' });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra, categoryId: receita.id }]);
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 0 });
      expect(await f.read(p1)).toMatchObject({ categoryId: receita.id, categoryRuleId: regra });
      expect(await f.read(p2)).toMatchObject({ categoryId: null });
      expect(await f.planCategory(plano)).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it('categoria da regra que virou agrupamento (ganhou filha) nao vai para o plano', async () => {
    const f = await createFixture('parcela-nao-folha');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('kabum', f.mercadoId, 1);
      // Depois de criada a regra, "Mercado" ganhou uma subcategoria.
      await f.db
        .insert(f.schema.categories)
        .values({ householdId: f.householdId, name: 'Hortifruti', nature: 'essential', parentId: f.mercadoId });
      const plano = await f.plan('KABUM', 2);
      const onCard = { accountId: null, creditCardId: f.cardId, installmentPlanId: plano };
      const p1 = await f.tx('KABUM', { ...onCard, installmentNumber: 1 });
      const p2 = await f.tx('KABUM (2/2)', { ...onCard, installmentNumber: 2, status: 'planned', rawDescription: '' });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: p1, ruleId: regra, categoryId: f.mercadoId }]);
      expect(result).toEqual({ applied: 1, skipped: 0, propagated: 0 });
      expect(await f.read(p2)).toMatchObject({ categoryId: null });
      expect(await f.planCategory(plano)).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it('previsao de recorrencia e pulada', async () => {
    const f = await createFixture('gravar-recorrencia');
    try {
      const { applyRuleProposals } = await import('./apply-rules');
      const regra = await f.rule('irmaos', f.mercadoId, 1);
      const recorrencia = await f.recurring(f.casaId);
      const prevista = await f.tx('IRMAOS BOA', { status: 'planned', recurringExpenseId: recorrencia });

      const result = await applyRuleProposals(f.householdId, [{ transactionId: prevista, ruleId: regra, categoryId: f.mercadoId }]);
      expect(result).toEqual({ applied: 0, skipped: 1, propagated: 0 });
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
