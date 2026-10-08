import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
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
import {
  incrementRuleHits,
  InvalidPlanCategoryError,
  setInstallmentPlanCategory,
} from './auto-categorization';

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
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

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

export type RuleApplicationItem = { transactionId: string; ruleId: string };

export type RuleApplicationResult = {
  /** Linhas gravadas pela regra. */
  applied: number;
  /** Itens que nao valiam mais na hora de gravar (ver `applyRuleProposals`). */
  skipped: number;
  /** Parcelas futuras que receberam a categoria pelo parcelamento. */
  propagated: number;
};

/** A regra pedida nao existe no household. */
export class RuleToApplyNotFoundError extends Error {
  constructor() {
    super('Regra não encontrada.');
    this.name = 'RuleToApplyNotFoundError';
  }
}

type RuleRow = Rule & { categoryName: string };

async function listRulesWithCategory(executor: Executor, householdId: string): Promise<RuleRow[]> {
  return executor
    .select({
      id: categorizationRules.id,
      pattern: categorizationRules.pattern,
      matchType: categorizationRules.matchType,
      categoryId: categorizationRules.categoryId,
      categoryName: categories.name,
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

/**
 * Candidatas: sem categoria e fora de previsao cumprida (`reconciled` nao
 * entra em total nenhum). O filtro fino (kind, valor zero) e do motor puro.
 */
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
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.categoryId),
        ne(transactions.status, 'reconciled'),
      ),
    )
    .orderBy(desc(transactions.occurredOn), asc(transactions.createdAt), asc(transactions.id));
}

function toCategorizationRow(row: Awaited<ReturnType<typeof listUncategorized>>[number]): CategorizationRow {
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
): Promise<RuleApplicationProposal[]> {
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

  return candidates.flatMap((row) => {
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
}

/**
 * Grava os itens confirmados na previa, numa transacao so.
 *
 * Cada item e conferido de novo, com a linha travada: item cuja linha nao e do
 * household, ja tem categoria, e previsao cumprida, ou que a regra (ausente,
 * inativa, de outro household) nao casa mais e PULADO — nunca gravado com
 * outra regra. Linha gravada leva `category_rule_id` e, se estiver sem
 * responsavel, o responsavel sugerido pela regra.
 *
 * Parcela gravada cujo parcelamento esta sem categoria propaga a categoria
 * para o plano e as demais parcelas (`setInstallmentPlanCategory`). Plano que
 * ja tem categoria nao e mexido: a categoria dele e decisao anterior.
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
      })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, transactionIds)))
      .for('update');
    const rowsById = new Map(locked.map((row) => [row.id, row]));

    let applied = 0;
    let propagated = 0;
    const hitsByRuleId: Record<string, number> = {};
    const plansToPropagate = new Map<string, string>();

    for (const item of items) {
      const row = rowsById.get(item.transactionId);
      const rule = rules.get(item.ruleId);
      if (row === undefined || rule === undefined || row.status === 'reconciled') continue;
      const stillMatches = previewRule(rule, [
        { ...row, amountCents: cents(row.amountCents) },
      ]).length === 1;
      if (!stillMatches) continue;

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
        plansToPropagate.set(row.installmentPlanId, rule.categoryId);
      }
    }

    for (const [planId, categoryId] of plansToPropagate) {
      const [plan] = await tx
        .select({ categoryId: installmentPlans.categoryId })
        .from(installmentPlans)
        .where(and(eq(installmentPlans.id, planId), eq(installmentPlans.householdId, householdId)))
        .limit(1);
      if (plan === undefined || plan.categoryId !== null) continue;
      try {
        propagated += await setInstallmentPlanCategory(householdId, planId, categoryId, tx);
      } catch (error) {
        // Categoria de receita num parcelamento: a parcela fica gravada, o plano
        // nao muda. Qualquer outro erro derruba a transacao inteira.
        if (!(error instanceof InvalidPlanCategoryError)) throw error;
      }
    }

    await incrementRuleHits(householdId, hitsByRuleId, tx);
    return { applied, skipped: items.length - applied, propagated };
  });
}
