import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  categories,
  categorizationRules,
  installmentPlans,
  transactions,
} from '@/lib/db/schema';
import {
  previewRule,
  type CategorizationRow,
  type Rule,
} from '@/lib/finance/categorization';
import { cents, type Cents } from '@/lib/money';
import { APPLY_RULES_LIMIT } from './apply-rules-limit';
import { incrementRuleHits } from './auto-categorization';

/**
 * Aplicar regras aos lancamentos que JA existem (F3 da categorizacao
 * automatica), em dois passos: previa e gravacao.
 *
 * A previa usa `previewRule` do motor puro, e a gravacao grava EXATAMENTE os
 * itens que o usuario confirmou — nunca roda `categorizeBatch` de novo
 * (CONTRACTS §6.1): uma regra antiga de prioridade maior pegaria a linha, e o
 * "pega N" que o usuario viu ficaria errado.
 *
 * Regra nunca sobrescreve categoria: so linha com `category_id` null, e a
 * condicao e repetida no UPDATE, entao quem categorizou entre a previa e o
 * gravar ganha.
 *
 * Ficam FORA, alem do filtro do motor (so gasto e receita, sem valor zero):
 * - previsao cumprida (`reconciled`), que nao entra em total nenhum;
 * - previsao de recorrencia (despesa fixa, receita): a categoria dela vem da
 *   definicao da recorrencia, e a proxima reposicao das previsoes desfaria a
 *   da regra;
 * - parcela de parcelamento que JA tem categoria: quem decide e o plano, nao a
 *   regra.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export { APPLY_RULES_LIMIT };

export type RuleApplicationProposal = {
  transactionId: string;
  occurredOn: string;
  description: string;
  amountCents: Cents;
  ruleId: string;
  rulePattern: string;
  categoryId: string;
  categoryName: string;
};

export type RuleApplicationPreview = {
  /** Ate `limit` propostas, na ordem da lista de lancamentos. */
  proposals: RuleApplicationProposal[];
  /** Quantas linhas as regras pegariam ao todo (pode passar do limite). */
  total: number;
};

/** A categoria vai junto: se a regra foi editada desde a previa, o item e pulado. */
export type RuleApplicationItem = { transactionId: string; ruleId: string; categoryId: string };

export type RuleApplicationResult = {
  /** Linhas gravadas pela regra. */
  applied: number;
  /** Itens que nao valiam mais na hora de gravar (ver `applyRuleProposals`). */
  skipped: number;
  /** Parcelas sem categoria que receberam a categoria pelo parcelamento. */
  propagated: number;
};

/** A regra pedida nao existe no household. */
export class RuleToApplyNotFoundError extends Error {
  constructor() {
    super('Regra não encontrada.');
    this.name = 'RuleToApplyNotFoundError';
  }
}

type RuleRow = Rule & { categoryName: string; categoryNature: string };

async function listRulesWithCategory(executor: Executor, householdId: string): Promise<RuleRow[]> {
  return executor
    .select({
      id: categorizationRules.id,
      pattern: categorizationRules.pattern,
      matchType: categorizationRules.matchType,
      categoryId: categorizationRules.categoryId,
      categoryName: categories.name,
      categoryNature: categories.nature,
      memberId: categorizationRules.memberId,
      priority: categorizationRules.priority,
      active: categorizationRules.active,
    })
    .from(categorizationRules)
    .innerJoin(categories, eq(categories.id, categorizationRules.categoryId))
    .where(eq(categorizationRules.householdId, householdId))
    // A ordem do motor: priority asc, id asc.
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

/** Linha que a regra pode categorizar (ver o cabecalho do modulo). */
const eligibleForRules = and(
  isNull(transactions.categoryId),
  ne(transactions.status, 'reconciled'),
  isNull(transactions.recurringExpenseId),
  isNull(transactions.incomeId),
  or(isNull(transactions.installmentPlanId), isNull(installmentPlans.categoryId)),
);

async function listUncategorized(householdId: string) {
  return db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .leftJoin(installmentPlans, eq(installmentPlans.id, transactions.installmentPlanId))
    .where(and(eq(transactions.householdId, householdId), eligibleForRules))
    .orderBy(desc(transactions.occurredOn), asc(transactions.createdAt), asc(transactions.id));
}

function toCategorizationRow(row: {
  id: string;
  description: string;
  amountCents: number;
  kind: CategorizationRow['kind'];
  categoryId: string | null;
}): CategorizationRow {
  return {
    id: row.id,
    description: row.description,
    amountCents: cents(row.amountCents),
    kind: row.kind,
    categoryId: row.categoryId,
  };
}

/**
 * O que as regras categorizariam agora.
 *
 * - `ruleId` informado: previa so daquela regra ("esta regra pega N"), mesmo
 *   que outra de prioridade maior tambem case — e a oferta logo apos criar.
 * - `ruleId` null: todas as regras ativas, cada linha para a PRIMEIRA regra
 *   (priority asc, id asc) cuja `previewRule` a inclui.
 *
 * Lanca `RuleToApplyNotFoundError` se a regra nao for do household.
 */
export async function previewRuleApplication(
  householdId: string,
  ruleId: string | null,
  limit: number = APPLY_RULES_LIMIT,
): Promise<RuleApplicationPreview> {
  const [allRules, candidates] = await Promise.all([
    listRulesWithCategory(db, householdId),
    listUncategorized(householdId),
  ]);

  let rules = allRules;
  if (ruleId !== null) {
    rules = allRules.filter((rule) => rule.id === ruleId);
    if (rules.length === 0) throw new RuleToApplyNotFoundError();
  }

  const rows = candidates.map(toCategorizationRow);
  const winner = new Map<string, RuleRow>();
  for (const rule of rules) {
    for (const id of previewRule(rule, rows)) {
      if (!winner.has(id)) winner.set(id, rule);
    }
  }

  const proposals = candidates.flatMap((row) => {
    const rule = winner.get(row.id);
    if (rule === undefined) return [];
    return [
      {
        transactionId: row.id,
        occurredOn: row.occurredOn,
        description: row.description,
        amountCents: cents(row.amountCents),
        ruleId: rule.id,
        rulePattern: rule.pattern,
        categoryId: rule.categoryId,
        categoryName: rule.categoryName,
      },
    ];
  });
  return { proposals: proposals.slice(0, limit), total: proposals.length };
}

/**
 * Leva a categoria ao parcelamento SEM categoria e as parcelas dele que estao
 * SEM categoria. Nao usa `setInstallmentPlanCategory` de proposito: aquela
 * regra (F2) tambem move parcelas com rastro de regra, e aqui a previa mostrou
 * so as linhas marcadas — parcela que ja tem categoria, de regra ou a mao, nao
 * pode mudar sem aparecer na previa (achado do Corvo).
 *
 * Categoria de receita nao vai para o plano (parcelamento e despesa).
 */
async function propagateToUncategorizedPlan(
  tx: Tx,
  householdId: string,
  planId: string,
  categoryId: string,
  categoryNature: string,
): Promise<number> {
  if (categoryNature === 'income') return 0;
  const [plan] = await tx
    .select({ categoryId: installmentPlans.categoryId })
    .from(installmentPlans)
    .where(and(eq(installmentPlans.id, planId), eq(installmentPlans.householdId, householdId)))
    .for('update')
    .limit(1);
  if (plan === undefined || plan.categoryId !== null) return 0;

  await tx
    .update(installmentPlans)
    .set({ categoryId })
    .where(and(eq(installmentPlans.id, planId), eq(installmentPlans.householdId, householdId)));
  const changed = await tx
    .update(transactions)
    .set({ categoryId, categoryRuleId: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.installmentPlanId, planId),
        isNull(transactions.categoryId),
      ),
    )
    .returning({ id: transactions.id });
  return changed.length;
}

/**
 * Grava os itens confirmados na previa, numa transacao so.
 *
 * Cada item e conferido de novo, com a linha travada. E PULADO — nunca gravado
 * com outra regra ou outra categoria — o item cuja linha nao e do household,
 * ja tem categoria, saiu das elegiveis (ver o cabecalho), ou cuja regra
 * (ausente, inativa, de outro household, com categoria diferente da que a
 * previa mostrou) nao vale mais. Linha gravada leva `category_rule_id` e, se
 * estiver sem responsavel, o responsavel sugerido pela regra.
 *
 * Parcela gravada de parcelamento sem categoria leva a categoria ao plano e as
 * parcelas dele sem categoria (`propagated`).
 *
 * `hits` soma so linha REAL (`posted`): parcela projetada nao e uso da regra.
 */
export async function applyRuleProposals(
  householdId: string,
  items: readonly RuleApplicationItem[],
): Promise<RuleApplicationResult> {
  if (items.length === 0) return { applied: 0, skipped: 0, propagated: 0 };

  return db.transaction(async (tx) => {
    const rules = new Map(
      (await listRulesWithCategory(tx, householdId)).map((rule) => [rule.id, rule]),
    );
    const transactionIds = [...new Set(items.map((item) => item.transactionId))];
    const locked = await tx
      .select({
        id: transactions.id,
        description: transactions.description,
        amountCents: transactions.amountCents,
        kind: transactions.kind,
        status: transactions.status,
        categoryId: transactions.categoryId,
        installmentPlanId: transactions.installmentPlanId,
        recurringExpenseId: transactions.recurringExpenseId,
        incomeId: transactions.incomeId,
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, transactionIds)))
      .for('update');
    const rowsById = new Map(locked.map((row) => [row.id, row]));

    const planIds = [...new Set(locked.flatMap((row) => (row.installmentPlanId === null ? [] : [row.installmentPlanId])))];
    const categorizedPlans = new Set(
      planIds.length === 0
        ? []
        : (
            await tx
              .select({ id: installmentPlans.id })
              .from(installmentPlans)
              .where(
                and(
                  eq(installmentPlans.householdId, householdId),
                  inArray(installmentPlans.id, planIds),
                  isNotNull(installmentPlans.categoryId),
                ),
              )
          ).map((plan) => plan.id),
    );

    let applied = 0;
    let propagated = 0;
    const hitsByRuleId: Record<string, number> = {};
    const plansToPropagate = new Map<string, RuleRow>();

    for (const item of items) {
      const row = rowsById.get(item.transactionId);
      const rule = rules.get(item.ruleId);
      if (row === undefined || rule === undefined) continue;
      if (rule.categoryId !== item.categoryId) continue;
      if (
        row.status === 'reconciled' ||
        row.recurringExpenseId !== null ||
        row.incomeId !== null ||
        (row.installmentPlanId !== null && categorizedPlans.has(row.installmentPlanId))
      ) {
        continue;
      }
      if (previewRule(rule, [toCategorizationRow(row)]).length !== 1) continue;

      const updated = await tx
        .update(transactions)
        .set({
          categoryId: rule.categoryId,
          categoryRuleId: rule.id,
          memberId: sql`coalesce(${transactions.memberId}, ${rule.memberId})`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(transactions.id, row.id),
            eq(transactions.householdId, householdId),
            isNull(transactions.categoryId),
          ),
        )
        .returning({ id: transactions.id });
      if (updated.length === 0) continue;

      applied += 1;
      if (row.status === 'posted') hitsByRuleId[rule.id] = (hitsByRuleId[rule.id] ?? 0) + 1;
      if (row.installmentPlanId !== null && !plansToPropagate.has(row.installmentPlanId)) {
        plansToPropagate.set(row.installmentPlanId, rule);
      }
    }

    for (const [planId, rule] of plansToPropagate) {
      propagated += await propagateToUncategorizedPlan(tx, householdId, planId, rule.categoryId, rule.categoryNature);
    }

    await incrementRuleHits(householdId, hitsByRuleId, tx);
    return { applied, skipped: items.length - applied, propagated };
  });
}
