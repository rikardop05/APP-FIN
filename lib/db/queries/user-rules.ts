import { and, eq, inArray, min } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { MatchType } from '@/lib/db';
import { categories, categorizationRules, members, transactions } from '@/lib/db/schema';
import { matchRule, ruleOfferFor } from '@/lib/finance/categorization';
import { APPLY_RULES_LIMIT } from './apply-rules-limit';
import {
  applyRuleProposals,
  listRulesWithCategory,
  listUncategorized,
  toCategorizationRow,
  type RuleApplicationResult,
  type Tx,
} from './apply-rules';

/**
 * Regras criadas pelo usuario fora da tela de regras (F5): na revisao em
 * grupos, em "criar regra a partir do lancamento" e na oferta depois de
 * categorizar a mao.
 *
 * Politica UNICA (decisao do orquestrador, 2026-10-08): a regra entra no TOPO
 * da ordem, `priority = menor - 1` (pode ficar negativa). E a decisao mais
 * recente do usuario sobre aquela loja; uma regra antiga e mais ampla nao pode
 * continuar vencendo nas proximas importacoes. A tela de regras reordena e
 * normaliza quando o usuario quiser.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

type Executor = typeof db | Tx;

export type UserRuleInput = {
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  memberId: string | null;
};

/** Categoria fora do household ou com subcategorias, ou responsavel de outro household. */
export class InvalidUserRuleError extends Error {
  constructor() {
    super('Escolha uma categoria sem subcategorias e um responsável da família.');
    this.name = 'InvalidUserRuleError';
  }
}

/** O padrao (editado) nao casa as linhas que o usuario categorizou. */
export class RuleOfferPatternError extends Error {
  constructor() {
    super('O trecho precisa aparecer na descrição dos lançamentos que você categorizou.');
    this.name = 'RuleOfferPatternError';
  }
}

/** As linhas da oferta nao estao mais categorizadas, juntas, na mesma categoria. */
export class RuleOfferNoLongerValidError extends Error {
  constructor() {
    super('Os lançamentos mudaram desde a oferta. Abra-a de novo.');
    this.name = 'RuleOfferNoLongerValidError';
  }
}

async function ensureReferences(executor: Executor, householdId: string, input: UserRuleInput): Promise<void> {
  const [category] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (category === undefined) throw new InvalidUserRuleError();
  const [child] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, input.categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (child !== undefined) throw new InvalidUserRuleError();
  if (input.memberId !== null) {
    const [member] = await executor
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.householdId, householdId)))
      .limit(1);
    if (member === undefined) throw new InvalidUserRuleError();
  }
}

/** Cria a regra no topo da ordem. Devolve o id. */
export async function createUserRule(
  householdId: string,
  input: UserRuleInput,
  executor: Executor = db,
): Promise<string> {
  await ensureReferences(executor, householdId, input);
  const [current] = await executor
    .select({ min: min(categorizationRules.priority) })
    .from(categorizationRules)
    .where(eq(categorizationRules.householdId, householdId));
  // Sem regras, o topo e 0 (= 1 - 1).
  const priority = (current?.min ?? 1) - 1;
  const [created] = await executor
    .insert(categorizationRules)
    .values({ householdId, ...input, priority, hits: 0, active: true })
    .returning({ id: categorizationRules.id });
  if (created === undefined) throw new Error('Não foi possível criar a regra.');
  return created.id;
}

export type RuleOffer = {
  pattern: string;
  categoryId: string;
  categoryName: string;
  /** Outras linhas sem categoria que a regra pegaria (ate o limite); o aceite grava exatamente estas. */
  matchingIds: string[];
  /** Quantas linhas a regra pegaria ao todo (pode passar do limite). */
  total: number;
};

async function readSources(executor: Executor, householdId: string, transactionIds: readonly string[]) {
  if (transactionIds.length === 0) return [];
  return executor
    .select({
      id: transactions.id,
      description: transactions.description,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryNature: categories.nature,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, [...transactionIds])));
}

/**
 * Oferta de regra para as linhas que o usuario acabou de categorizar a mao, ou
 * `null` (ver `ruleOfferFor` no motor). Linha sem categoria ou de outro
 * household nao conta como fonte: se faltar alguma, nao ha oferta.
 *
 * `pattern` = padrao editado no dialogo: o efeito e recalculado para ele, e
 * padrao que nao casa as linhas de origem da `null`. `limit` corta a lista
 * (o aceite grava no maximo isso); `total` diz quantas seriam.
 */
export async function getRuleOffer(
  householdId: string,
  transactionIds: readonly string[],
  options: { pattern?: string; limit?: number } = {},
): Promise<RuleOffer | null> {
  const ids = [...new Set(transactionIds)];
  const [sources, rules, candidates] = await Promise.all([
    readSources(db, householdId, ids),
    listRulesWithCategory(db, householdId),
    listUncategorized(householdId),
  ]);
  const [first] = sources;
  if (first === undefined || sources.length !== ids.length) return null;

  const offer = ruleOfferFor({
    rules,
    // O innerJoin com categories garante categoria; o `?? ''` so satisfaz o
    // tipo da coluna, que e anulavel.
    sources: sources.map((source) => ({
      id: source.id,
      description: source.description,
      kind: source.kind,
      categoryId: source.categoryId ?? '',
    })),
    categoryNature: first.categoryNature,
    candidates: candidates.map(toCategorizationRow),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
  });
  if (offer === null || first.categoryId === null) return null;
  return {
    pattern: offer.pattern,
    categoryId: first.categoryId,
    categoryName: first.categoryName,
    matchingIds: offer.matchingIds.slice(0, options.limit ?? APPLY_RULES_LIMIT),
    total: offer.matchingIds.length,
  };
}

/**
 * Aceite da oferta, numa transacao: cria a regra (no topo) com a categoria das
 * linhas de origem e grava EXATAMENTE as linhas da oferta pela aplicacao de
 * regras, que confere cada uma de novo e pula o que mudou.
 *
 * Lanca `RuleOfferNoLongerValidError` se as linhas de origem nao estiverem
 * mais todas categorizadas na mesma categoria, e `RuleOfferPatternError` se o
 * padrao (editado) nao casar todas elas; nada e gravado.
 */
export async function acceptRuleOffer(
  householdId: string,
  input: { transactionIds: string[]; pattern: string; matchingIds: string[] },
): Promise<RuleApplicationResult & { ruleId: string }> {
  return db.transaction(async (tx) => {
    const ids = [...new Set(input.transactionIds)];
    const sources = await readSources(tx, householdId, ids);
    const categoryIds = new Set(sources.map((source) => source.categoryId));
    const [categoryId] = [...categoryIds];
    if (sources.length === 0 || sources.length !== ids.length || categoryIds.size !== 1 || categoryId === undefined || categoryId === null) {
      throw new RuleOfferNoLongerValidError();
    }

    const rule = { pattern: input.pattern.trim(), matchType: 'contains' as const, categoryId, memberId: null };
    // O padrao pode ter sido editado no dialogo: tem de casar as linhas que o
    // usuario categorizou, senao a regra nao representa a decisao dele.
    const probe = { ...rule, id: 'probe', priority: 0, active: true };
    if (rule.pattern === '' || sources.some((source) => matchRule([probe], source.description) === null)) {
      throw new RuleOfferPatternError();
    }

    const ruleId = await createUserRule(householdId, rule, tx);
    const result = await applyRuleProposals(
      householdId,
      input.matchingIds.map((transactionId) => ({ transactionId, ruleId, categoryId })),
      tx,
    );
    return { ...result, ruleId };
  });
}
