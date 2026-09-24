import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { MatchType } from '@/lib/db';
import { categorizationRules, categories, members } from '@/lib/db/schema';

/**
 * Queries de regras de categorizacao — T-114.
 *
 * A ordem de avaliacao do motor (`lib/finance/categorization.ts`, T-104) e
 * **`priority` ascendente, `id` ascendente como desempate**. A reordenacao da
 * tela grava `priority` = posicao na lista, e esta query devolve na mesma ordem
 * — se as duas divergissem, o criterio "alterar prioridade reflete na proxima
 * categorizacao" passaria no teste e nao existiria no produto.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

export type RuleListItem = {
  id: string;
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  categoryName: string;
  memberId: string | null;
  memberName: string | null;
  priority: number;
  hits: number;
  active: boolean;
};

export type RuleMutation = {
  pattern: string;
  matchType: MatchType;
  categoryId: string;
  memberId: string | null;
  active: boolean;
  /** `null` no create = entra no fim da ordem. */
  priority: number | null;
};

/** A categoria ou o responsavel informado nao pertence ao household. */
export class InvalidRuleReferenceError extends Error {
  constructor() {
    super('Categoria ou responsável inválido.');
    this.name = 'InvalidRuleReferenceError';
  }
}

/**
 * A regra aponta para uma categoria que **tem filhas**. A regra categoriza o
 * lancamento, e o lancamento cai na folha (DATA-MODEL §2, categories): apontar
 * para uma raiz com filhas jogaria o gasto na natureza errada, em silencio
 * (achado 2 da revisao).
 */
export class RuleCategoryNotLeafError extends Error {
  constructor() {
    super('Escolha uma categoria que não tenha subcategorias.');
    this.name = 'RuleCategoryNotLeafError';
  }
}

export class RuleNotFoundError extends Error {
  constructor() {
    super('Regra não encontrada.');
    this.name = 'RuleNotFoundError';
  }
}

/** A lista de reordenacao nao contem exatamente as regras do household. */
export class InvalidRuleOrderError extends Error {
  constructor() {
    super('A ordem enviada não corresponde às regras cadastradas.');
    this.name = 'InvalidRuleOrderError';
  }
}

async function ensureCategoryBelongs(householdId: string, categoryId: string): Promise<void> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (!row) throw new InvalidRuleReferenceError();

  // A regra aponta para a folha: categoria com filhas e agrupamento, nao destino.
  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (child) throw new RuleCategoryNotLeafError();
}

async function ensureMemberBelongs(
  householdId: string,
  memberId: string | null,
): Promise<void> {
  if (memberId === null) return;
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.householdId, householdId)))
    .limit(1);
  if (!row) throw new InvalidRuleReferenceError();
}

/** Regras do household na ordem que o motor avalia. */
export async function listRules(householdId: string): Promise<RuleListItem[]> {
  return db
    .select({
      id: categorizationRules.id,
      pattern: categorizationRules.pattern,
      matchType: categorizationRules.matchType,
      categoryId: categorizationRules.categoryId,
      categoryName: categories.name,
      memberId: categorizationRules.memberId,
      memberName: members.name,
      priority: categorizationRules.priority,
      hits: categorizationRules.hits,
      active: categorizationRules.active,
    })
    .from(categorizationRules)
    .innerJoin(categories, eq(categories.id, categorizationRules.categoryId))
    .leftJoin(members, eq(members.id, categorizationRules.memberId))
    .where(eq(categorizationRules.householdId, householdId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

async function nextPriority(householdId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${categorizationRules.priority}), 0)` })
    .from(categorizationRules)
    .where(eq(categorizationRules.householdId, householdId));
  return Number(row?.value ?? 0) + 1;
}

export async function createRule(householdId: string, input: RuleMutation): Promise<void> {
  await ensureCategoryBelongs(householdId, input.categoryId);
  await ensureMemberBelongs(householdId, input.memberId);

  await db.insert(categorizationRules).values({
    householdId,
    pattern: input.pattern,
    matchType: input.matchType,
    categoryId: input.categoryId,
    memberId: input.memberId,
    active: input.active,
    priority: input.priority ?? (await nextPriority(householdId)),
  });
}

export async function updateRule(
  householdId: string,
  id: string,
  input: RuleMutation,
): Promise<void> {
  const [current] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.householdId, householdId)))
    .limit(1);
  if (!current) throw new RuleNotFoundError();

  await ensureCategoryBelongs(householdId, input.categoryId);
  await ensureMemberBelongs(householdId, input.memberId);

  await db
    .update(categorizationRules)
    .set({
      pattern: input.pattern,
      matchType: input.matchType,
      categoryId: input.categoryId,
      memberId: input.memberId,
      active: input.active,
      // A prioridade so muda pela reordenacao; o formulario nao a envia.
      ...(input.priority === null ? {} : { priority: input.priority }),
    })
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.householdId, householdId)));
}

export async function deleteRule(householdId: string, id: string): Promise<void> {
  const [current] = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.householdId, householdId)))
    .limit(1);
  if (!current) throw new RuleNotFoundError();

  await db
    .delete(categorizationRules)
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.householdId, householdId)));
}

/**
 * Grava a nova ordem: `priority` = indice na lista. Exige a lista **completa**
 * das regras do household — ordem parcial deixaria regras fora com prioridade
 * antiga, colidindo com as novas em silencio.
 *
 * A escrita roda numa transacao: ou a ordem inteira entra, ou nenhuma prioridade
 * muda.
 */
export async function reorderRules(householdId: string, orderedIds: string[]): Promise<void> {
  const existing = await db
    .select({ id: categorizationRules.id })
    .from(categorizationRules)
    .where(eq(categorizationRules.householdId, householdId));
  const existingIds = new Set(existing.map((row) => row.id));

  const unique = new Set(orderedIds);
  if (
    orderedIds.length !== existingIds.size ||
    unique.size !== orderedIds.length ||
    orderedIds.some((id) => !existingIds.has(id))
  ) {
    throw new InvalidRuleOrderError();
  }

  await db.transaction(async (tx) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index];
      if (id === undefined) continue;
      await tx
        .update(categorizationRules)
        .set({ priority: index })
        .where(
          and(eq(categorizationRules.id, id), eq(categorizationRules.householdId, householdId)),
        );
    }
  });
}
