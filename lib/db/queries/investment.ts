import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import type { ScenarioLabel } from '@/lib/db';
import { investmentPlans, investmentScenarios, transactions } from '@/lib/db/schema';
import type { Competence, IsoDate } from '@/lib/date';
import { essentialAverageWindow } from '@/lib/finance/goals';
import { basisPoints, cents, type BasisPoints, type Cents } from '@/lib/money';

import { lockHousehold } from './recurring-planned-write';

/**
 * Plano de investimento e cenários — T-302. Só seleção e gravação; toda conta
 * (alvo, meses, aporte por horizonte, curva) mora em `lib/finance/investment.ts`.
 *
 * **Um plano por household.** O DATA-MODEL não diz se há vários (a tabela tem `name`, mas
 * nenhum "ativo"); o SPEC §5.6 fala de UM planejador ("o usuário informa…"). Sem índice
 * único no schema, a regra é garantida aqui: `createInvestmentPlan` toma a trava do
 * household e recusa o segundo (`InvestmentPlanExistsError`).
 *
 * Os 3 cenários nascem com os defaults do DATA-MODEL, na mesma transação do plano.
 */

export const SCENARIO_LABELS: readonly ScenarioLabel[] = ['conservative', 'moderate', 'optimistic'];

/** DATA-MODEL §2: conservative 300/300 · moderate 500/400 · optimistic 700/500. */
export const DEFAULT_SCENARIOS: readonly {
  label: ScenarioLabel;
  realReturnBp: BasisPoints;
  withdrawalBp: BasisPoints;
}[] = [
  { label: 'conservative', realReturnBp: basisPoints(300), withdrawalBp: basisPoints(300) },
  { label: 'moderate', realReturnBp: basisPoints(500), withdrawalBp: basisPoints(400) },
  { label: 'optimistic', realReturnBp: basisPoints(700), withdrawalBp: basisPoints(500) },
];

export type InvestmentPlanInput = {
  name: string;
  /** Em R$ de hoje. */
  desiredMonthlyIncomeCents: Cents;
  currentPortfolioCents: Cents;
  currentMonthlyContributionCents: Cents;
  inflationBp: BasisPoints;
  incomeTaxBp: BasisPoints;
  targetDate: IsoDate | null;
};

export type InvestmentScenarioInput = {
  label: ScenarioLabel;
  realReturnBp: BasisPoints;
  withdrawalBp: BasisPoints;
};

export type InvestmentPlanRow = InvestmentPlanInput & {
  id: string;
  /**
   * Data a que `currentPortfolioCents` se refere (D7 do T-404): âncora da curva de comparação
   * com as posições reais. Gravada pelo servidor (criação, PUT que muda o patrimônio, D4);
   * não vem do corpo.
   */
  currentPortfolioAsOf: IsoDate;
};

export type InvestmentScenarioRow = InvestmentScenarioInput & { id: string };

export class InvestmentPlanNotFoundError extends Error {
  constructor() {
    super('Ainda não há plano de investimento.');
    this.name = 'InvestmentPlanNotFoundError';
  }
}

export class InvestmentPlanExistsError extends Error {
  constructor() {
    super('Já existe um plano de investimento.');
    this.name = 'InvestmentPlanExistsError';
  }
}

function safeCents(value: string | number): Cents {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error('Valor monetário fora do intervalo seguro.');
  return cents(numeric);
}

const LABEL_ORDER = new Map(SCENARIO_LABELS.map((label, index) => [label, index]));

/** O plano do household com os cenários na ordem conservador → otimista; `null` se não há. */
export async function getInvestmentPlan(
  householdId: string,
): Promise<{ plan: InvestmentPlanRow; scenarios: InvestmentScenarioRow[] } | null> {
  const [plan] = await db
    .select()
    .from(investmentPlans)
    .where(eq(investmentPlans.householdId, householdId))
    .orderBy(asc(investmentPlans.createdAt))
    .limit(1);
  if (plan === undefined) return null;
  const scenarios = await db
    .select({
      id: investmentScenarios.id,
      label: investmentScenarios.label,
      realReturnBp: investmentScenarios.realReturnBp,
      withdrawalBp: investmentScenarios.withdrawalBp,
    })
    .from(investmentScenarios)
    .where(eq(investmentScenarios.investmentPlanId, plan.id));
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      desiredMonthlyIncomeCents: safeCents(plan.desiredMonthlyIncomeCents),
      currentPortfolioCents: safeCents(plan.currentPortfolioCents),
      currentMonthlyContributionCents: safeCents(plan.currentMonthlyContributionCents),
      inflationBp: basisPoints(plan.inflationBp),
      incomeTaxBp: basisPoints(plan.incomeTaxBp),
      targetDate: plan.targetDate,
      currentPortfolioAsOf: plan.currentPortfolioAsOf,
    },
    scenarios: scenarios
      .map((row) => ({
        id: row.id,
        label: row.label,
        realReturnBp: basisPoints(row.realReturnBp),
        withdrawalBp: basisPoints(row.withdrawalBp),
      }))
      .sort((a, b) => (LABEL_ORDER.get(a.label) ?? 0) - (LABEL_ORDER.get(b.label) ?? 0)),
  };
}

/**
 * Cria o plano e os 3 cenários com os defaults, numa transação. Um por household. O
 * patrimônio informado vale em `today` (`current_portfolio_as_of`, D7 do T-404).
 */
export async function createInvestmentPlan(
  householdId: string,
  input: InvestmentPlanInput,
  today: IsoDate,
): Promise<string> {
  return db.transaction(async (tx) => {
    // A trava serializa dois POSTs simultâneos: o segundo enxerga o primeiro e recusa.
    await lockHousehold(tx, householdId);
    const [existing] = await tx
      .select({ id: investmentPlans.id })
      .from(investmentPlans)
      .where(eq(investmentPlans.householdId, householdId))
      .limit(1);
    if (existing !== undefined) throw new InvestmentPlanExistsError();

    const [plan] = await tx
      .insert(investmentPlans)
      .values({ householdId, ...input, currentPortfolioAsOf: today })
      .returning({ id: investmentPlans.id });
    if (plan === undefined) throw new Error('Não foi possível criar o plano.');
    await tx
      .insert(investmentScenarios)
      .values(DEFAULT_SCENARIOS.map((scenario) => ({ investmentPlanId: plan.id, ...scenario })));
    return plan.id;
  });
}

/**
 * Substitui as premissas do plano e de cada cenário enviado (por `label`). Cenário ausente
 * no banco é recriado, para um plano antigo incompleto se curar na edição.
 *
 * D7 do T-404: se o patrimônio atual MUDOU, ele passa a valer em `today`
 * (`current_portfolio_as_of`); se não mudou, a data fica (editar o nome não move a âncora).
 */
export async function updateInvestmentPlan(
  householdId: string,
  input: InvestmentPlanInput,
  scenarios: readonly InvestmentScenarioInput[],
  today: IsoDate,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ currentPortfolioCents: investmentPlans.currentPortfolioCents })
      .from(investmentPlans)
      .where(eq(investmentPlans.householdId, householdId))
      .limit(1)
      .for('update');
    if (current === undefined) throw new InvestmentPlanNotFoundError();
    const portfolioChanged = Number(current.currentPortfolioCents) !== input.currentPortfolioCents;
    const [plan] = await tx
      .update(investmentPlans)
      .set(portfolioChanged ? { ...input, currentPortfolioAsOf: today } : input)
      .where(eq(investmentPlans.householdId, householdId))
      .returning({ id: investmentPlans.id });
    if (plan === undefined) throw new InvestmentPlanNotFoundError();
    for (const scenario of scenarios) {
      const updated = await tx
        .update(investmentScenarios)
        .set({ realReturnBp: scenario.realReturnBp, withdrawalBp: scenario.withdrawalBp })
        .where(
          and(
            eq(investmentScenarios.investmentPlanId, plan.id),
            eq(investmentScenarios.label, scenario.label),
          ),
        )
        .returning({ id: investmentScenarios.id });
      if (updated.length === 0) {
        await tx.insert(investmentScenarios).values({ investmentPlanId: plan.id, ...scenario });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Sobra real (T-304, RF-INV-05)
// ---------------------------------------------------------------------------

export type SurplusData = {
  from: Competence;
  to: Competence;
  /** Uma entrada por mês da janela com ALGUM lançamento; `surplusCents` = receita − despesa. */
  months: { competence: Competence; surplusCents: Cents }[];
};

/**
 * Sobra (receita − despesa) de cada mês FECHADO da janela, a mesma da média essencial do
 * T-305 (`essentialAverageWindow`: os 3 meses antes do corrente). Só `posted` (decisão do
 * Orquestrador, 2026-10-02): previsão (`planned`) de mês fechado que não se realizou não é
 * sobra que existiu, e `reconciled` é a mesma despesa que o `posted` já traz. NÃO usa
 * `COUNTED_STATUSES`, que inclui `planned`. Entram só `income` e `expense`:
 * aporte (`investment_contribution`) é PARA ONDE a sobra vai, e transferência e pagamento de
 * fatura só movem dinheiro entre contas (a compra no cartão já é `expense`).
 *
 * Como na média essencial, só aparecem os meses com ALGUM lançamento `posted` (de qualquer tipo): é o
 * que separa "sobra zero" de "mês sem histórico", que não entra na média. A média em si é
 * `averageMonthlySurplus` (`app/api/investment/compute.ts`, pura).
 */
export async function getSurplusData(householdId: string, today: IsoDate): Promise<SurplusData> {
  const { from, to } = essentialAverageWindow(today);
  const rows = await db
    .select({
      competence: transactions.competence,
      surplus: sql<string>`coalesce(sum(case when ${transactions.kind} in ('income', 'expense') then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, 'posted'),
        gte(transactions.competence, from),
        lte(transactions.competence, to),
      ),
    )
    .groupBy(transactions.competence)
    .orderBy(asc(transactions.competence));
  return {
    from,
    to,
    months: rows.map((row) => ({ competence: row.competence, surplusCents: safeCents(row.surplus) })),
  };
}
