import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { categories, installmentPlans, transactions } from '@/lib/db/schema';
import { categoryFitsKind, groupUncategorized, matchRule } from '@/lib/finance/categorization';
import type { CategoryNature } from '@/lib/db/enums';
import type { Cents } from '@/lib/money';
import {
  listRulesWithCategory,
  listUncategorized,
  propagateToUncategorizedPlan,
  toCategorizationRow,
  type RuleRow,
} from './apply-rules';
import { incrementRuleHits } from './auto-categorization';
import { createUserRule } from './user-rules';

/**
 * Revisao dos nao categorizados em grupos (F4 da categorizacao automatica).
 *
 * A leitura usa os MESMOS cortes da aplicacao de regras (`apply-rules.ts`):
 * sem categoria, fora de previsao cumprida, de previsao de recorrencia e de
 * parcelamento ja categorizado. O agrupamento e do motor puro
 * (`groupUncategorized`).
 *
 * Confirmar um grupo e uma decisao do usuario: grava a categoria escolhida e,
 * se pedido, cria a regra com o padrao (editado) numa transacao so.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

const SAMPLE_SIZE = 3;

export type ReviewGroup = {
  /** Chave estavel para a tela: regra ou padrao, mais o sentido. */
  key: string;
  pattern: string;
  direction: 'out' | 'in';
  transactionIds: string[];
  count: number;
  totalCents: Cents;
  /** Ate 3 descricoes distintas, na ordem da lista de lancamentos. */
  sampleDescriptions: string[];
  ruleId: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
};

export type ReviewGroupConfirmation = {
  transactionIds: string[];
  categoryId: string;
  /** Padrao da regra a criar (`contains`); null = so categorizar. */
  newRulePattern: string | null;
};

export type ReviewGroupResult = {
  categorized: number;
  /** Linhas que nao valiam mais (categorizadas no meio, de outro household, fora da revisao). */
  skipped: number;
  /** Parcelas sem categoria que receberam a categoria pelo parcelamento. */
  propagated: number;
  /** Regra criada; null quando nao foi pedida. */
  ruleId: string | null;
};

/** A categoria nao cabe no tipo das linhas: receita x despesa (`categoryFitsKind`). */
export class ReviewCategoryKindError extends Error {
  constructor() {
    super('Essa categoria não serve para esses lançamentos: receita vai para categoria de receita, e despesa para as demais.');
    this.name = 'ReviewCategoryKindError';
  }
}

/** A categoria nao e do household ou nao e folha. */
export class ReviewCategoryInvalidError extends Error {
  constructor() {
    super('Escolha uma categoria válida, que não tenha subcategorias.');
    this.name = 'ReviewCategoryInvalidError';
  }
}

/** Grupos da tela "Revisar sem categoria", na ordem do motor (maior |total| primeiro). */
export async function listReviewGroups(householdId: string): Promise<ReviewGroup[]> {
  const [rules, candidates] = await Promise.all([
    listRulesWithCategory(db, householdId),
    listUncategorized(householdId),
  ]);
  const rows = candidates.map(toCategorizationRow);
  const descriptions = new Map(rows.map((row) => [row.id, row.description]));
  const categoryNames = new Map(rules.map((rule) => [rule.categoryId, rule.categoryName]));

  return groupUncategorized(rows, rules).map((group) => {
    const direction = group.totalCents < 0 ? 'out' : 'in';
    const samples = [...new Set(group.ids.map((id) => descriptions.get(id) ?? ''))].slice(0, SAMPLE_SIZE);
    return {
      key: `${direction}|${group.ruleId === null ? `pattern:${group.pattern}` : `rule:${group.ruleId}`}`,
      pattern: group.pattern,
      direction,
      transactionIds: group.ids,
      count: group.ids.length,
      totalCents: group.totalCents,
      sampleDescriptions: samples,
      ruleId: group.ruleId,
      suggestedCategoryId: group.suggestedCategoryId,
      suggestedCategoryName:
        group.suggestedCategoryId === null ? null : (categoryNames.get(group.suggestedCategoryId) ?? null),
    };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function ensureLeafCategory(tx: Tx, householdId: string, categoryId: string): Promise<CategoryNature> {
  const [row] = await tx
    .select({ id: categories.id, nature: categories.nature })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (row === undefined) throw new ReviewCategoryInvalidError();
  const [child] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (child !== undefined) throw new ReviewCategoryInvalidError();
  return row.nature;
}

/**
 * Confirma um grupo: categoriza as linhas e, com `newRulePattern`, cria a regra.
 *
 * Cada linha e conferida de novo, travada: so muda linha do household, sem
 * categoria e dentro dos cortes da revisao; as demais contam em `skipped`.
 *
 * Rastro (`category_rule_id`), com a mesma definicao da importacao: a regra
 * vencedora para a descricao (ja contando a regra nova) aponta para a
 * categoria escolhida. Linha do grupo que o padrao editado nao casa e
 * categorizada sem rastro — a decisao foi do usuario, nao da regra.
 * `hits` soma so linha REAL (`posted`) com rastro.
 *
 * Parcela de parcelamento sem categoria leva a categoria ao plano e as
 * parcelas sem categoria (mesma propagacao da aplicacao de regras).
 *
 * Lanca `ReviewCategoryInvalidError` (categoria alheia ou nao folha) e
 * `ReviewCategoryKindError` (receita x despesa) antes de gravar qualquer coisa.
 * Se nenhuma linha vale mais, a regra pedida nao e criada.
 */
export async function confirmReviewGroup(
  householdId: string,
  input: ReviewGroupConfirmation,
): Promise<ReviewGroupResult> {
  const pattern = input.newRulePattern === null ? null : input.newRulePattern.trim();

  return db.transaction(async (tx) => {
    const nature = await ensureLeafCategory(tx, householdId, input.categoryId);
    const transactionIds = [...new Set(input.transactionIds)];
    const locked =
      transactionIds.length === 0
        ? []
        : await tx
            .select({
              id: transactions.id,
              description: transactions.description,
              amountCents: transactions.amountCents,
              kind: transactions.kind,
              status: transactions.status,
              installmentPlanId: transactions.installmentPlanId,
            })
            .from(transactions)
            .leftJoin(installmentPlans, eq(installmentPlans.id, transactions.installmentPlanId))
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactions.id, transactionIds),
                isNull(transactions.categoryId),
                sql`${transactions.status} <> 'reconciled'`,
                isNull(transactions.recurringExpenseId),
                isNull(transactions.incomeId),
                sql`(${transactions.installmentPlanId} is null or ${installmentPlans.categoryId} is null)`,
                // Mesmo filtro do motor: so gasto e receita, sem valor zero.
                inArray(transactions.kind, ['expense', 'income']),
                sql`${transactions.amountCents} <> 0`,
              ),
            )
            .for('update', { of: transactions });

    // Natureza x tipo conferida no servidor, nao so na tela: o grupo inteiro e
    // recusado antes de qualquer gravacao.
    if (locked.some((row) => !categoryFitsKind(nature, row.kind))) throw new ReviewCategoryKindError();
    // Nada a categorizar (tudo mudou desde a tela): nao cria a regra pedida.
    if (locked.length === 0) return { categorized: 0, skipped: transactionIds.length, propagated: 0, ruleId: null };

    // Regra do usuario entra no topo da ordem (politica unica, `user-rules.ts`).
    const ruleId =
      pattern === null || pattern === ''
        ? null
        : await createUserRule(householdId, { pattern, matchType: 'contains', categoryId: input.categoryId, memberId: null }, tx);
    const rules: RuleRow[] = await listRulesWithCategory(tx, householdId);

    let categorized = 0;
    const hitsByRuleId: Record<string, number> = {};
    const plans = new Set<string>();
    for (const row of locked) {
      // So regra cuja categoria cabe no tipo da linha disputa o rastro: uma
      // "pix" -> Salario de prioridade maior nao rouba o rastro de um Pix enviado.
      const fitting = rules.filter((rule) => categoryFitsKind(rule.categoryNature, row.kind));
      const winner = matchRule(fitting, row.description);
      const traceRuleId = winner !== null && winner.categoryId === input.categoryId ? winner.id : null;
      const updated = await tx
        .update(transactions)
        .set({ categoryId: input.categoryId, categoryRuleId: traceRuleId, updatedAt: sql`now()` })
        .where(and(eq(transactions.id, row.id), eq(transactions.householdId, householdId), isNull(transactions.categoryId)))
        .returning({ id: transactions.id });
      if (updated.length === 0) continue;
      categorized += 1;
      if (traceRuleId !== null && row.status === 'posted') {
        hitsByRuleId[traceRuleId] = (hitsByRuleId[traceRuleId] ?? 0) + 1;
      }
      if (row.installmentPlanId !== null) plans.add(row.installmentPlanId);
    }

    let propagated = 0;
    for (const planId of plans) {
      propagated += await propagateToUncategorizedPlan(tx, householdId, planId, input.categoryId, nature);
    }

    await incrementRuleHits(householdId, hitsByRuleId, tx);
    return { categorized, skipped: transactionIds.length - categorized, propagated, ruleId };
  });
}
