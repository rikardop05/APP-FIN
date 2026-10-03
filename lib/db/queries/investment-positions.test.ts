import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { basisPoints, cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes de banco ficam pulados.
  }
}

/**
 * T-404: posições reais e aporte efetivo contra o SQL real, e a resposta da rota (sem a
 * sessão). A matemática (aderência, diferença em bp) é testada à mão em
 * `lib/finance/positions.test.ts`; aqui se prova a montagem: janela, sinais, âncora da
 * curva, um registro por dia, D4. Household PRÓPRIO, apagado no `finally`, com a checagem
 * barulhenta de que sumiu.
 */

const TODAY = '2026-10-15';

async function modules() {
  const [{ db }, schema, positions, investment, { loadPositionsResponse }, { applySnapshotToPlan }, { domainFailure }, { parseSnapshotBody }, motor] =
    await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./investment-positions'),
      import('./investment'),
      import('@/app/api/investment/positions/load'),
      import('@/app/api/investment/positions/use-as-portfolio'),
      import('@/app/api/investment/positions/domain-errors'),
      import('@/app/api/investment/positions/body'),
      import('@/lib/finance/investment'),
    ]);
  return { db, schema, positions, investment, loadPositionsResponse, applySnapshotToPlan, domainFailure, parseSnapshotBody, motor };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function newHousehold(m: Modules, name: string): Promise<string> {
  const [household] = await m.db.insert(m.schema.households).values({ name }).returning({ id: m.schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  return household.id;
}

async function cleanup(m: Modules, householdId: string) {
  await m.db.delete(m.schema.transactions).where(eq(m.schema.transactions.householdId, householdId));
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
  const left = await m.db.select({ id: m.schema.households.id }).from(m.schema.households).where(eq(m.schema.households.id, householdId));
  if (left.length > 0) throw new Error(`Limpeza falhou: o household de teste ${householdId} continua no banco.`);
}

const PLAN = {
  name: 'Independência',
  desiredMonthlyIncomeCents: cents(1_000_000),
  currentPortfolioCents: cents(5_000_000),
  currentMonthlyContributionCents: cents(200_000),
  inflationBp: basisPoints(450),
  incomeTaxBp: basisPoints(1500),
  targetDate: null,
};

describe.skipIf(process.env.DATABASE_URL === undefined)('posições reais de investimento (banco real)', () => {
  it('aporte efetivo: só investment_contribution posted, líquido e nunca negativo; janela 12 fechados + corrente; aderência', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-404 posições test');
    const otherId = await newHousehold(m, 'T-404 posições test (outra casa)');
    try {
      await m.investment.createInvestmentPlan(householdId, PLAN, TODAY);
      // Patrimônio do plano datado antes da janela: os 12 meses fechados entram na aderência.
      await m.db.execute(sql`update investment_plans set current_portfolio_as_of = '2025-06-15' where household_id = ${householdId}`);
      const [account] = await m.db.insert(m.schema.accounts).values({ householdId, name: 'Corretora', kind: 'brokerage', openingDate: '2025-01-01' }).returning({ id: m.schema.accounts.id });
      const [foreignAccount] = await m.db.insert(m.schema.accounts).values({ householdId: otherId, name: 'Alheia', kind: 'checking', openingDate: '2025-01-01' }).returning({ id: m.schema.accounts.id });
      if (account === undefined || foreignAccount === undefined) throw new Error('Conta não foi criada.');
      const tx = (competence: string, amountCents: number, extra: Partial<typeof m.schema.transactions.$inferInsert> = {}) => ({
        householdId,
        accountId: account.id,
        occurredOn: `${competence}-10`,
        competence,
        description: 'Aporte',
        rawDescription: '',
        amountCents,
        kind: 'investment_contribution' as const,
        status: 'posted' as const,
        ...extra,
      });
      await m.db.insert(m.schema.transactions).values([
        tx('2026-09', -200_000),
        // Agosto: aporte de 100.000 e resgate de 50.000 no mesmo mês -> líquido 50.000.
        tx('2026-08', -100_000),
        tx('2026-08', 50_000),
        // Julho: só resgate -> 0, nunca negativo.
        tx('2026-07', 30_000),
        // Não contam: previsto, despesa comum, outra casa, fora da janela.
        tx('2026-09', -999_000, { status: 'planned' }),
        tx('2026-09', -777_000, { kind: 'expense' }),
        { ...tx('2026-09', -555_000), householdId: otherId, accountId: foreignAccount.id },
        tx('2025-09', -444_000),
      ]);

      const response = await m.loadPositionsResponse(householdId, TODAY);
      expect(response.currentCompetence).toBe('2026-10');
      expect(response.contributions).toHaveLength(13);
      expect(response.contributions[0]?.competence).toBe('2025-10');
      expect(response.contributions.at(-1)?.competence).toBe('2026-10');
      const actual = Object.fromEntries(response.contributions.map((month) => [month.competence, month.actualCents]));
      expect(actual).toMatchObject({ '2026-09': 200_000, '2026-08': 50_000, '2026-07': 0, '2026-10': 0, '2025-10': 0 });

      // 200.000/200.000 = 10.000 bp; 50.000/200.000 = 2.500 bp. Resumo dos 12 fechados:
      // 250.000 / (200.000 × 12) = 0,1041666 -> 1.042 bp; 11 meses abaixo (só setembro bateu).
      const months = Object.fromEntries((response.adherence?.months ?? []).map((month) => [month.competence, month]));
      expect(months['2026-09']).toMatchObject({ adherenceBp: 10_000, belowPlan: false, inProgress: false });
      expect(months['2026-08']).toMatchObject({ adherenceBp: 2_500, belowPlan: true });
      expect(months['2026-10']).toMatchObject({ inProgress: true });
      expect(response.adherence?.summary).toEqual({ closedMonths: 12, averageAdherenceBp: 1_042, monthsBelowPlan: 11 });

      // Outra casa: sem plano -> aderência e comparação null, mas o aporte dela aparece.
      const other = await m.loadPositionsResponse(otherId, TODAY);
      expect(other.plan).toBeNull();
      expect(other.adherence).toBeNull();
      expect(other.comparison).toBeNull();
      expect(other.contributions.find((month) => month.competence === '2026-09')?.actualCents).toBe(555_000);
    } finally {
      await cleanup(m, householdId);
      await cleanup(m, otherId);
    }
  }, 30_000);

  it('registros: um por dia (de novo = edita), curva ancorada na data do patrimônio (D7), comparação e D4', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-404 posições test');
    try {
      await m.investment.createInvestmentPlan(householdId, PLAN, TODAY);
      expect((await m.investment.getInvestmentPlan(householdId))?.plan.currentPortfolioAsOf).toBe(TODAY);
      // Patrimônio do plano datado de 10/07: a âncora da curva é 2026-07 (não a criação).
      await m.db.execute(sql`update investment_plans set current_portfolio_as_of = '2026-07-10', created_at = '2025-01-01T00:00:00Z' where household_id = ${householdId}`);
      expect(await m.positions.getPlanStartCompetence(householdId)).toBe('2026-07');

      const first = await m.positions.saveSnapshot(householdId, { asOf: '2026-09-30', portfolioCents: cents(5_500_000), note: null });
      expect(first.replaced).toBe(false);
      const again = await m.positions.saveSnapshot(householdId, { asOf: '2026-09-30', portfolioCents: cents(5_700_000), note: 'extrato' });
      expect(again).toEqual({ id: first.id, replaced: true });
      const early = await m.positions.saveSnapshot(householdId, { asOf: '2026-06-30', portfolioCents: cents(4_800_000), note: null });
      expect(await m.positions.listSnapshots(householdId)).toEqual([
        { id: early.id, asOf: '2026-06-30', portfolioCents: 4_800_000, note: null },
        { id: first.id, asOf: '2026-09-30', portfolioCents: 5_700_000, note: 'extrato' },
      ]);

      const response = await m.loadPositionsResponse(householdId, TODAY);
      expect(response.plan).toEqual({
        plannedMonthlyCents: 200_000,
        currentPortfolioCents: 5_000_000,
        startCompetence: '2026-07',
        currentPortfolioAsOf: '2026-07-10',
      });
      // Aderência só desde a criação do plano (jul..out): 3 meses fechados, não 12; a lista de
      // aportes continua com a janela inteira.
      expect(response.adherence?.months.map((month) => month.competence)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
      expect(response.adherence?.summary.closedMonths).toBe(3);
      expect(response.contributions).toHaveLength(13);
      const [before, compared] = response.comparison ?? [];
      expect(before).toMatchObject({ asOf: '2026-06-30', status: 'before_plan' });
      expect(before?.byScenario.every((item) => item.projectedCents === null)).toBe(true);
      // 2026-09 é o ponto 2 da curva que começa em 2026-07: FV(2) do motor, por cenário.
      expect(compared).toMatchObject({ asOf: '2026-09-30', competence: '2026-09', status: 'compared', portfolioCents: 5_700_000 });
      const moderate = compared?.byScenario.find((item) => item.label === 'moderate');
      const projected = m.motor.futureValue(cents(5_000_000), cents(200_000), basisPoints(500), 2);
      expect(moderate).toMatchObject({ projectedCents: projected, diffCents: 5_700_000 - projected });
      expect(compared?.byScenario.map((item) => item.label)).toEqual(['conservative', 'moderate', 'optimistic']);

      // Data já usada por OUTRO registro: 409. Registro inexistente: 404.
      const taken = await m.positions.updateSnapshot(householdId, early.id, { asOf: '2026-09-30', portfolioCents: cents(1), note: null }).catch((error: unknown) => error);
      expect(m.domainFailure(taken)).toEqual({ status: 409, error: 'Já existe um registro de posição em 2026-09-30. Edite esse registro.' });
      const missing = await m.positions.deleteSnapshot(householdId, '00000000-0000-4000-8000-000000000000').catch((error: unknown) => error);
      expect(m.domainFailure(missing)?.status).toBe(404);
      await m.positions.updateSnapshot(householdId, early.id, { asOf: '2026-06-29', portfolioCents: cents(4_900_000), note: 'corrigido' });

      // Registrar NÃO mexeu no plano (D4); o passo explícito copia.
      expect((await m.investment.getInvestmentPlan(householdId))?.plan.currentPortfolioCents).toBe(5_000_000);
      await m.applySnapshotToPlan(householdId, first.id, TODAY);
      expect((await m.investment.getInvestmentPlan(householdId))?.plan).toMatchObject({
        currentPortfolioCents: 5_700_000,
        currentPortfolioAsOf: '2026-09-30',
      });
      // D7: a curva passa a partir do patrimônio novo NA data dele; o registro de 30/09 está no
      // ponto 0 (patrimônio sem rendimento ainda), então bate exato com a projeção.
      const anchored = await m.loadPositionsResponse(householdId, TODAY);
      expect(anchored.plan?.startCompetence).toBe('2026-09');
      // A data exata identifica o registro copiado, mesmo com outro registro no mesmo mês.
      await m.positions.saveSnapshot(householdId, { asOf: '2026-09-15', portfolioCents: cents(5_700_000), note: null });
      const sameMonth = await m.loadPositionsResponse(householdId, TODAY);
      expect(sameMonth.plan?.currentPortfolioAsOf).toBe('2026-09-30');
      expect(sameMonth.snapshots.filter((row) => row.asOf === sameMonth.plan?.currentPortfolioAsOf)).toHaveLength(1);
      expect(anchored.comparison?.find((row) => row.asOf === '2026-09-30')?.byScenario.every((item) => item.diffCents === 0)).toBe(true);

      await m.positions.deleteSnapshot(householdId, early.id);
      expect((await m.positions.listSnapshots(householdId)).map((row) => row.asOf)).toEqual(['2026-09-15', '2026-09-30']);
    } finally {
      await cleanup(m, householdId);
    }
  }, 30_000);

  it('D4 sem plano é 404; registro de outra casa não é visível nem editável', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-404 posições test');
    const otherId = await newHousehold(m, 'T-404 posições test (outra casa)');
    try {
      const saved = await m.positions.saveSnapshot(householdId, { asOf: '2026-09-30', portfolioCents: cents(100), note: null });
      const noPlan = await m.applySnapshotToPlan(householdId, saved.id, TODAY).catch((error: unknown) => error);
      expect(m.domainFailure(noPlan)).toEqual({ status: 404, error: 'Ainda não há plano de investimento.' });
      const foreign = await m.positions.updateSnapshot(otherId, saved.id, { asOf: '2026-09-29', portfolioCents: cents(1), note: null }).catch((error: unknown) => error);
      expect(m.domainFailure(foreign)?.status).toBe(404);
      expect(await m.positions.listSnapshots(otherId)).toEqual([]);
    } finally {
      await cleanup(m, householdId);
      await cleanup(m, otherId);
    }
  }, 30_000);
});

describe('corpo do registro (sem banco)', () => {
  it('data no futuro, valor negativo e observação vazia', async () => {
    const { parseSnapshotBody } = await import('@/app/api/investment/positions/body');
    expect(parseSnapshotBody({ asOf: '2026-10-15', portfolioCents: 100, note: '  ' }, TODAY)).toEqual({
      ok: true,
      input: { asOf: '2026-10-15', portfolioCents: 100, note: null },
    });
    expect(parseSnapshotBody({ asOf: '2026-10-16', portfolioCents: 100, note: null }, TODAY)).toEqual({
      ok: false,
      error: 'A data da posição não pode estar no futuro.',
    });
    expect(parseSnapshotBody({ asOf: '2026-10-01', portfolioCents: -1, note: null }, TODAY)).toEqual({
      ok: false,
      error: 'Informe o total investido (zero ou mais).',
    });
    expect(parseSnapshotBody({ asOf: '2026-02-30', portfolioCents: 1, note: null }, TODAY).ok).toBe(false);
  });
});
