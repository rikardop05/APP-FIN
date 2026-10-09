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
 * Decisoes do Ricardo de 2026-10-08 no lado do banco: fatura PAGA sai do comprometido
 * (vencida e nao paga continua), parcela x compra lancada no feed do card unico, e o
 * aporte planejado ao lado do lancado. Household proprio, apagado no `finally`.
 */
async function createFixture(label: string) {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `Comprometido ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste nao foi criado.');
  const householdId = household.id;
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
      closingDay: 1,
      dueDay: 10,
      active: true,
    })
    .returning({ id: schema.creditCards.id });
  if (card === undefined) throw new Error('Cartao nao criado.');
  const cardId = card.id;

  async function statement(period: string, status: 'open' | 'closed' | 'paid') {
    const [row] = await db
      .insert(schema.statements)
      .values({ creditCardId: cardId, period, closingDate: `${period}-01`, dueDate: `${period}-10`, status, source: 'import' })
      .returning({ id: schema.statements.id });
    if (row === undefined) throw new Error('Fatura nao criada.');
    return row.id;
  }

  async function plan() {
    const [row] = await db
      .insert(schema.installmentPlans)
      .values({
        householdId,
        creditCardId: cardId,
        description: 'PARCELADO',
        totalCents: cents(-9000),
        installmentsCount: 3,
        firstCompetence: '2026-10',
        source: 'import',
      })
      .returning({ id: schema.installmentPlans.id });
    if (row === undefined) throw new Error('Plano nao criado.');
    return row.id;
  }

  async function tx(competence: string, amountCents: number, extra: Partial<typeof schema.transactions.$inferInsert> = {}) {
    await db.insert(schema.transactions).values({
      householdId,
      occurredOn: `${competence}-05`,
      competence,
      description: 'x',
      rawDescription: 'x',
      amountCents: cents(amountCents),
      kind: 'expense',
      creditCardId: cardId,
      ...extra,
    });
  }

  return {
    db,
    schema,
    householdId,
    cardId,
    statement,
    plan,
    tx,
    cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('comprometido nos cartoes: feed e motor (2026-10-08)', () => {
  it('fatura paga sai (pela propria linha e pela parcela projetada); vencida e nao paga continua; parcela x compra', async () => {
    const f = await createFixture('pago');
    try {
      const { listCommitmentTransactions } = await import('./dashboard');
      const { futureCommitment } = await import('@/lib/finance/commitment');
      const outubro = await f.statement('2026-10', 'paid');
      const novembro = await f.statement('2026-11', 'closed'); // vencida, nao marcada como paga
      const planoId = await f.plan();
      // Outubro (pago): compra lancada na fatura e parcela 1 projetada, sem statement_id.
      await f.tx('2026-10', -10000, { statementId: outubro });
      await f.tx('2026-10', -3000, { status: 'planned', installmentPlanId: planoId, installmentNumber: 1 });
      // Novembro (fechada, nao paga): compra lancada e parcela 2.
      await f.tx('2026-11', -2500, { statementId: novembro });
      await f.tx('2026-11', -3000, { status: 'planned', installmentPlanId: planoId, installmentNumber: 2 });
      // Dezembro: parcela 3, sem fatura ainda.
      await f.tx('2026-12', -3000, { status: 'planned', installmentPlanId: planoId, installmentNumber: 3 });

      const rows = await listCommitmentTransactions(f.householdId, '2026-10', 3);
      const flags = rows
        .map((row) => [row.competence, row.amountCents, row.installment, row.statementPaid])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
      expect(flags).toEqual([
        ['2026-10', -10000, false, true],
        ['2026-10', -3000, true, true],
        ['2026-11', -3000, true, false],
        ['2026-11', -2500, false, false],
        ['2026-12', -3000, true, false],
      ]);

      const result = futureCommitment({ fromCompetence: '2026-10', months: 3, cards: [], transactions: rows });
      // Outubro pago sai inteiro. Nov: -3000 + -2500 = -5500. Dez: -3000. Total -8500.
      expect(result.totalCents).toBe(-8500);
      expect(result.breakdown).toEqual({
        // Nenhuma competencia anterior com fatura em aberto.
        overdueUnpaidCents: 0,
        currentStatementCents: 0,
        // Parcelas de nov e dez: -3000 + -3000.
        laterInstallmentsCents: -6000,
        // Compra lancada na fatura de novembro.
        laterPurchasesCents: -2500,
      });
    } finally {
      await f.cleanup();
    }
  });

  it('fatura paga de OUTRO cartao no mesmo mes nao tira nada', async () => {
    const f = await createFixture('outro-cartao');
    const outro = await createFixture('outro-cartao-2');
    try {
      const { listCommitmentTransactions } = await import('./dashboard');
      await outro.statement('2026-10', 'paid');
      await f.tx('2026-10', -1000);
      const rows = await listCommitmentTransactions(f.householdId, '2026-10', 1);
      expect(rows.map((row) => row.statementPaid)).toEqual([false]);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });

  it('aporte planejado do plano vem ao lado; sem plano e null; aporte do mes conta so o lancado', async () => {
    const f = await createFixture('aporte');
    try {
      const { getDashboardData } = await import('./dashboard');
      const { monthlyKpis } = await import('@/lib/finance/kpis');
      const [account] = await f.db
        .insert(f.schema.accounts)
        .values({ householdId: f.householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: f.schema.accounts.id });
      if (account === undefined) throw new Error('Conta nao criada.');
      const naConta = { creditCardId: null, accountId: account.id, kind: 'investment_contribution' as const };
      await f.tx('2026-10', -20000, naConta);
      await f.tx('2026-10', -30000, { ...naConta, status: 'planned' });

      const semPlano = await getDashboardData(f.householdId, '2026-10-08', 3);
      expect(semPlano.plannedContributionCents).toBeNull();

      await f.db.insert(f.schema.investmentPlans).values({
        householdId: f.householdId,
        name: 'Plano',
        desiredMonthlyIncomeCents: cents(300000),
        currentMonthlyContributionCents: cents(50000),
        currentPortfolioAsOf: '2026-10-01',
      });
      const data = await getDashboardData(f.householdId, '2026-10-08', 3);
      expect(data.plannedContributionCents).toBe(50000);

      const kpis = monthlyKpis({
        competence: '2026-10',
        transactions: data.monthlyTransactions,
        futureInstallmentsCents: data.futureInstallmentsCents,
        uncategorizedCount: data.uncategorizedCount,
        plannedContributionCents: data.plannedContributionCents,
      });
      // So o lancado (20000); o previsto de 30000 fica fora. Planejado 50000 ao lado.
      expect(kpis.contributionsCents).toBe(20000);
      expect(kpis.plannedContributionCents).toBe(50000);
    } finally {
      await f.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('faturas vencidas nao pagas de competencia anterior (2026-10-08)', () => {
  it('entram com statementOverdue; mes sem fatura e fatura paga ficam fora; soma fecha no motor', async () => {
    const f = await createFixture('vencida');
    try {
      const { listCommitmentTransactions } = await import('./dashboard');
      const { futureCommitment } = await import('@/lib/finance/commitment');
      const julho = await f.statement('2026-07', 'open'); // vencida, nao paga
      const setembro = await f.statement('2026-09', 'paid');
      await f.tx('2026-07', -146901, { statementId: julho });
      await f.tx('2026-08', -5000); // mes antigo SEM fatura cadastrada: fora
      await f.tx('2026-09', -287449, { statementId: setembro }); // paga: fora
      await f.tx('2026-10', -76609); // janela

      const rows = await listCommitmentTransactions(f.householdId, '2026-10', 2);
      expect(
        rows
          .map((row) => [row.competence, row.amountCents, row.statementOverdue])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ['2026-07', -146901, true],
        ['2026-10', -76609, false],
      ]);

      const result = futureCommitment({ fromCompetence: '2026-10', months: 2, cards: [], transactions: rows });
      expect(result.breakdown.overdueUnpaidCents).toBe(-146901);
      expect(result.overdueCompetences).toEqual(['2026-07']);
      // -146901 + -76609 = -223510.
      expect(result.totalCents).toBe(-223510);
    } finally {
      await f.cleanup();
    }
  });

  it('fatura aberta de OUTRO cartao no mes antigo nao puxa as linhas deste cartao', async () => {
    const f = await createFixture('vencida-outro');
    const outro = await createFixture('vencida-outro-2');
    try {
      const { listCommitmentTransactions } = await import('./dashboard');
      await outro.statement('2026-07', 'open');
      await f.tx('2026-07', -1000); // este cartao nao tem fatura em julho
      const rows = await listCommitmentTransactions(f.householdId, '2026-10', 1);
      expect(rows).toEqual([]);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('getOverdueUnpaidStatements: aviso do Fluxo (2026-10-09)', () => {
  it('soma so as faturas anteriores existentes e nao pagas, com a regra do Comprometido', async () => {
    const f = await createFixture('aviso-fluxo');
    try {
      const { getOverdueUnpaidStatements } = await import('./dashboard');
      const julho = await f.statement('2026-07', 'closed'); // vencida, nao paga
      const agosto = await f.statement('2026-08', 'paid');
      await f.tx('2026-07', -146901, { statementId: julho });
      await f.tx('2026-07', 500, { statementId: julho }); // estorno abate
      await f.tx('2026-08', -9999, { statementId: agosto }); // paga: fora
      await f.tx('2026-09', -5000); // sem fatura cadastrada: fora
      await f.tx('2026-10', -76609); // mes corrente: nao e "anterior"

      // -146901 + 500 = -146401.
      expect(await getOverdueUnpaidStatements(f.householdId, '2026-10')).toEqual({
        totalCents: -146401,
        competences: ['2026-07'],
      });
    } finally {
      await f.cleanup();
    }
  });

  it('nada vencido: zero e lista vazia', async () => {
    const f = await createFixture('aviso-fluxo-vazio');
    try {
      const { getOverdueUnpaidStatements } = await import('./dashboard');
      expect(await getOverdueUnpaidStatements(f.householdId, '2026-10')).toEqual({ totalCents: 0, competences: [] });
    } finally {
      await f.cleanup();
    }
  });
});
