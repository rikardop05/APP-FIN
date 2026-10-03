import { eq } from 'drizzle-orm';
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
 * T-302: plano de investimento e cenários contra o SQL real, e a resposta da rota (sem a
 * sessão: `load`, `compute`, `schemas` e `domain-errors` não importam o Auth.js).
 * Household PRÓPRIO, apagado no `finally`, com a checagem barulhenta de que sumiu.
 */

const TODAY = '2026-10-15';

const GATE_PLAN = {
  name: 'Independência',
  desiredMonthlyIncomeCents: cents(1_000_000),
  currentPortfolioCents: cents(5_000_000),
  currentMonthlyContributionCents: cents(200_000),
  inflationBp: basisPoints(450),
  incomeTaxBp: basisPoints(1500),
  targetDate: null,
};

async function modules() {
  const [{ db }, schema, queries, { loadInvestmentResponse }, { domainFailure }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./investment'),
    import('@/app/api/investment/load'),
    import('@/app/api/investment/domain-errors'),
  ]);
  return { db, schema, queries, loadInvestmentResponse, domainFailure };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function newHousehold(m: Modules, name: string): Promise<string> {
  const [household] = await m.db.insert(m.schema.households).values({ name }).returning({ id: m.schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  return household.id;
}

async function cleanup(m: Modules, householdId: string) {
  // Plano e cenários saem em cascata com o household.
  await m.db.delete(m.schema.households).where(eq(m.schema.households.id, householdId));
  const left = await m.db
    .select({ id: m.schema.households.id })
    .from(m.schema.households)
    .where(eq(m.schema.households.id, householdId));
  if (left.length > 0) throw new Error(`Limpeza falhou: o household de teste ${householdId} continua no banco.`);
}

describe.skipIf(process.env.DATABASE_URL === undefined)('plano de investimento (banco real)', () => {
  it('sem plano: GET devolve plan null e nenhum cenário; PUT sem plano é 404', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-302 investimento test');
    try {
      const response = await m.loadInvestmentResponse(householdId, TODAY);
      expect(response).toEqual({
        fromCompetence: '2026-10',
        horizonsYears: [5, 10, 15, 20],
        plan: null,
        scenarios: [],
        surplus: { averageMonthlyCents: null, monthsWithData: 0, windowFrom: '2026-07', windowTo: '2026-09' },
      });

      const error = await m.queries.updateInvestmentPlan(householdId, GATE_PLAN, [], TODAY).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(m.queries.InvestmentPlanNotFoundError);
      expect(m.domainFailure(error)).toEqual({ status: 404, error: 'Ainda não há plano de investimento.' });
    } finally {
      await cleanup(m, householdId);
    }
  });

  it('criar: plano + 3 cenários com os defaults do DATA-MODEL; um só por household (409)', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-302 investimento test');
    const otherId = await newHousehold(m, 'T-302 investimento test (outra casa)');
    try {
      await m.queries.createInvestmentPlan(householdId, GATE_PLAN, TODAY);
      const stored = await m.queries.getInvestmentPlan(householdId);
      expect(stored?.plan).toMatchObject(GATE_PLAN);
      expect(stored?.scenarios.map(({ label, realReturnBp, withdrawalBp }) => [label, realReturnBp, withdrawalBp])).toEqual([
        ['conservative', 300, 300],
        ['moderate', 500, 400],
        ['optimistic', 700, 500],
      ]);

      // Segundo plano: recusado, e nada novo gravado.
      const error = await m.queries.createInvestmentPlan(householdId, GATE_PLAN, TODAY).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(m.queries.InvestmentPlanExistsError);
      expect(m.domainFailure(error)).toEqual({ status: 409, error: 'Já existe um plano de investimento.' });
      const plans = await m.db
        .select({ id: m.schema.investmentPlans.id })
        .from(m.schema.investmentPlans)
        .where(eq(m.schema.investmentPlans.householdId, householdId));
      expect(plans).toHaveLength(1);

      // Fronteira de household: a outra casa não vê o plano.
      expect(await m.queries.getInvestmentPlan(otherId)).toBeNull();
    } finally {
      await cleanup(m, householdId);
      await cleanup(m, otherId);
    }
  });

  it('GET: saída do motor já calculada (caso do gate, conferido no laudo T-301) e curva até 20 anos', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-302 investimento test');
    try {
      await m.queries.createInvestmentPlan(householdId, GATE_PLAN, TODAY);
      const response = await m.loadInvestmentResponse(householdId, TODAY);
      expect(response.fromCompetence).toBe('2026-10');
      expect(response.scenarios.map((scenario) => scenario.label)).toEqual(['conservative', 'moderate', 'optimistic']);
      // Números da tabela do gate (.notas/t301-tabela-cenarios.md, conferidos num oráculo independente).
      expect(response.scenarios.map((scenario) => scenario.result.targetPortfolioCents)).toEqual([
        400_000_000, 300_000_000, 240_000_000,
      ]);
      expect(response.scenarios.map((scenario) => scenario.result.monthsWithCurrentContribution)).toEqual([699, 459, 341]);
      expect(response.scenarios[1]?.result.requiredByHorizon).toEqual([
        { years: 5, contributionCents: 4_329_781 },
        { years: 10, contributionCents: 1_890_708 },
        { years: 15, contributionCents: 1_093_575 },
        { years: 20, contributionCents: 706_581 },
      ]);
      expect(response.scenarios.map((scenario) => scenario.result.projectedIncomeWithCurrentPlanCents)).toEqual([
        186_004, 314_758, 503_565,
      ]);
      const curve = response.scenarios[1]?.curve ?? [];
      expect(curve).toHaveLength(241);
      expect(curve[0]).toMatchObject({ competence: '2026-10', portfolioCents: 5_000_000 });
      expect(curve[240]).toMatchObject({ competence: '2046-10', portfolioCents: 94_427_386, passiveIncomeCents: 314_758 });
    } finally {
      await cleanup(m, householdId);
    }
  });

  it('PUT: premissas do plano e dos cenários persistem e o GET recalcula com elas', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-302 investimento test');
    try {
      await m.queries.createInvestmentPlan(householdId, GATE_PLAN, TODAY);
      const edited = {
        ...GATE_PLAN,
        name: 'Aposentadoria',
        currentMonthlyContributionCents: cents(300_000),
        inflationBp: basisPoints(400),
        incomeTaxBp: basisPoints(1000),
        targetDate: '2046-10-01',
      };
      await m.queries.updateInvestmentPlan(householdId, edited, [
        { label: 'conservative', realReturnBp: basisPoints(250), withdrawalBp: basisPoints(350) },
        { label: 'moderate', realReturnBp: basisPoints(450), withdrawalBp: basisPoints(400) },
        { label: 'optimistic', realReturnBp: basisPoints(-100), withdrawalBp: basisPoints(500) },
      ], '2026-11-20');
      const stored = await m.queries.getInvestmentPlan(householdId);
      expect(stored?.plan).toMatchObject(edited);
      // D7 (T-404): o patrimônio não mudou nesta edição, então a data dele fica a da criação.
      expect(stored?.plan.currentPortfolioAsOf).toBe(TODAY);
      // Mudou o patrimônio: ele passa a valer no dia da edição.
      await m.queries.updateInvestmentPlan(householdId, { ...edited, currentPortfolioCents: cents(6_000_000) }, [], '2026-12-01');
      expect((await m.queries.getInvestmentPlan(householdId))?.plan).toMatchObject({ currentPortfolioCents: 6_000_000, currentPortfolioAsOf: '2026-12-01' });
      await m.queries.updateInvestmentPlan(householdId, edited, [], TODAY);
      expect(stored?.scenarios.map(({ label, realReturnBp, withdrawalBp }) => [label, realReturnBp, withdrawalBp])).toEqual([
        ['conservative', 250, 350],
        ['moderate', 450, 400],
        ['optimistic', -100, 500],
      ]);
      const response = await m.loadInvestmentResponse(householdId, TODAY);
      // 1.000.000 * 12 / 0,035 = 342.857.142,86 -> 342.857.143.
      expect(response.scenarios[0]?.result.targetPortfolioCents).toBe(342_857_143);
      expect(response.scenarios[2]?.realReturnBp).toBe(-100);
    } finally {
      await cleanup(m, householdId);
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('sobra real para o RF-INV-05 (banco real)', () => {
  it('só receita e despesa contam; aporte, transferência, reconciled e o mês corrente não; mês sem lançamento fica fora', async () => {
    const m = await modules();
    const householdId = await newHousehold(m, 'T-304 sobra test');
    try {
      const [account] = await m.db
        .insert(m.schema.accounts)
        .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: m.schema.accounts.id });
      if (account === undefined) throw new Error('Conta não foi criada.');
      const base = { householdId, rawDescription: '', accountId: account.id, description: 'x' } as const;
      const day = (competence: string) => ({ competence, occurredOn: `${competence}-10`, cashDate: `${competence}-10` });
      const [real] = await m.db
        .insert(m.schema.transactions)
        .values({ ...base, ...day('2026-09'), amountCents: -100_000, kind: 'expense', status: 'posted' })
        .returning({ id: m.schema.transactions.id });
      if (real === undefined) throw new Error('Lançamento não foi criado.');
      await m.db.insert(m.schema.transactions).values([
        // Setembro: receita 500.000, despesa -100.000 (acima) -> sobra 400.000.
        { ...base, ...day('2026-09'), amountCents: 500_000, kind: 'income', status: 'posted' },
        // Não contam: aporte, transferência, pagamento de fatura, a previsão já cumprida e a
        // previsão que não se realizou (planned em mês fechado não é sobra que existiu).
        { ...base, ...day('2026-09'), amountCents: 700_000, kind: 'income', status: 'planned' },
        { ...base, ...day('2026-09'), amountCents: -40_000, kind: 'expense', status: 'planned' },
        // Julho: só previsão -> continua mês SEM histórico (fora da média).
        { ...base, ...day('2026-07'), amountCents: 123_456, kind: 'income', status: 'planned' },
        { ...base, ...day('2026-09'), amountCents: -200_000, kind: 'investment_contribution', status: 'posted' },
        { ...base, ...day('2026-09'), amountCents: -70_000, kind: 'transfer', status: 'posted' },
        { ...base, ...day('2026-09'), amountCents: -30_000, kind: 'credit_card_payment', status: 'posted' },
        { ...base, ...day('2026-09'), amountCents: -100_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: real.id },
        // Agosto: só um aporte -> mês COM histórico, sobra 0.
        { ...base, ...day('2026-08'), amountCents: -50_000, kind: 'investment_contribution', status: 'posted' },
        // Julho: nada (fora da média). Outubro (corrente) e junho (antes da janela): fora.
        { ...base, ...day('2026-10'), amountCents: -999_999, kind: 'expense', status: 'posted' },
        { ...base, ...day('2026-06'), amountCents: 888_888, kind: 'income', status: 'posted' },
      ]);

      const data = await m.queries.getSurplusData(householdId, TODAY);
      expect(data).toEqual({
        from: '2026-07',
        to: '2026-09',
        months: [
          { competence: '2026-08', surplusCents: 0 },
          { competence: '2026-09', surplusCents: 400_000 },
        ],
      });

      // Média (0 + 400.000) / 2 = 200.000; com o plano do gate e prazo em 2046-10 (240 meses),
      // o médio exige 706.581: não cabe, faltam 506.581.
      await m.queries.createInvestmentPlan(householdId, { ...GATE_PLAN, targetDate: '2046-10-01' }, TODAY);
      const response = await m.loadInvestmentResponse(householdId, TODAY);
      expect(response.surplus).toEqual({ averageMonthlyCents: 200_000, monthsWithData: 2, windowFrom: '2026-07', windowTo: '2026-09' });
      const moderate = response.scenarios[1];
      expect(moderate?.requiredForTargetDate).toEqual({ months: 240, contributionCents: 706_581 });
      expect(moderate?.feasibility).toMatchObject({
        basis: { kind: 'targetDate', months: 240 },
        requiredCents: 706_581,
        gapCents: 506_581,
        feasible: false,
      });
    } finally {
      // `reconciled_by_transaction_id` é RESTRICT: reabre antes de o household levar tudo.
      await m.db
        .update(m.schema.transactions)
        .set({ status: 'planned', reconciledByTransactionId: null })
        .where(eq(m.schema.transactions.householdId, householdId));
      await m.db.delete(m.schema.transactions).where(eq(m.schema.transactions.householdId, householdId));
      await cleanup(m, householdId);
    }
  });
});

describe('validação do corpo e erros de domínio (sem banco)', () => {
  it('Zod barra o que o motor não aceita, com mensagem em português', async () => {
    const { planBodySchema, planUpdateBodySchema } = await import('@/app/api/investment/schemas');
    const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
      result.error?.issues[0]?.message;

    expect(planBodySchema.safeParse(GATE_PLAN).success).toBe(true);
    expect(firstMessage(planBodySchema.safeParse({ ...GATE_PLAN, currentMonthlyContributionCents: -1 }))).toBe(
      'O aporte mensal não pode ser negativo.',
    );
    expect(firstMessage(planBodySchema.safeParse({ ...GATE_PLAN, currentPortfolioCents: -1 }))).toBe(
      'O patrimônio atual não pode ser negativo.',
    );
    expect(planBodySchema.safeParse({ ...GATE_PLAN, desiredMonthlyIncomeCents: 1.5 }).success).toBe(false);

    const scenarios = [
      { label: 'conservative', realReturnBp: 300, withdrawalBp: 300 },
      { label: 'moderate', realReturnBp: 500, withdrawalBp: 400 },
      { label: 'optimistic', realReturnBp: 700, withdrawalBp: 500 },
    ];
    expect(planUpdateBodySchema.safeParse({ ...GATE_PLAN, scenarios }).success).toBe(true);
    const withScenario = (patch: object) =>
      planUpdateBodySchema.safeParse({ ...GATE_PLAN, scenarios: [{ ...scenarios[0], ...patch }, scenarios[1], scenarios[2]] });
    expect(firstMessage(withScenario({ withdrawalBp: 0 }))).toBe(
      'A taxa de retirada precisa ser maior que 0 % e até 100 % ao ano.',
    );
    expect(firstMessage(withScenario({ realReturnBp: -10_000 }))).toBe(
      'O retorno real precisa ficar acima de -100 % e até 100 % ao ano.',
    );
    expect(withScenario({ realReturnBp: -9_999 }).success).toBe(true);
    expect(
      firstMessage(planUpdateBodySchema.safeParse({ ...GATE_PLAN, scenarios: [scenarios[0], scenarios[0], scenarios[2]] })),
    ).toBe('Cada cenário (conservador, médio, otimista) deve aparecer uma vez.');
    expect(planUpdateBodySchema.safeParse({ ...GATE_PLAN, scenarios: scenarios.slice(0, 2) }).success).toBe(false);
  });

  it('premissa que passa no Zod mas estoura o motor vira 400, nunca 500', async () => {
    const [{ assertComputable, InvestmentPremiseError }, { domainFailure }, { DEFAULT_SCENARIOS }] = await Promise.all([
      import('@/app/api/investment/compute'),
      import('@/app/api/investment/domain-errors'),
      import('./investment'),
    ]);
    // Patrimônio de R$ 50 tri a 7 % por 20 anos: o valor futuro sai do inteiro seguro.
    const error = (() => {
      try {
        assertComputable(
          { ...GATE_PLAN, currentPortfolioCents: cents(5_000_000_000_000_000) },
          DEFAULT_SCENARIOS,
          '2026-10',
        );
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(InvestmentPremiseError);
    expect(domainFailure(error)?.status).toBe(400);
    expect(domainFailure(error)?.error).toMatch(/^Premissas fora do alcance do cálculo: /);
    expect(domainFailure(new Error('qualquer'))).toBeNull();
    // RangeError de outra origem (por exemplo, dado corrompido lido do banco) NÃO vira 400.
    expect(domainFailure(new RangeError('valor corrompido'))).toBeNull();
  });
});
