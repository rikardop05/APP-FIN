import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { CategoryNature } from '@/lib/db';
import {
  budgets,
  categorizationRules,
  categories,
  installmentPlans,
  recurringExpenses,
  transactions,
} from '@/lib/db/schema';

/**
 * Queries de categorias — T-114.
 *
 * Duas regras de dominio moram aqui, porque dependem do banco e nao cabem num
 * CHECK (DATA-MODEL §2, categories):
 *
 * 1. **Dois niveis.** `parent_id` so pode apontar para uma raiz (`parent_id`
 *    null). Uma subcategoria de subcategoria e recusada na borda.
 * 2. **`nature` pertence a folha.** A raiz e agrupamento e pode ter filhas de
 *    naturezas diferentes ("Alimentacao" com "Mercado" essencial e
 *    "Restaurantes" nao essencial). A raiz so carrega uma `nature` para o caso
 *    de lancamento anexado direto nela; como a tela de raiz nao oferece esse
 *    campo, o servidor aplica `DEFAULT_ROOT_NATURE`.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7) e recebe o id como primeiro
 * parametro.
 */

/**
 * **SUPOSICAO** (achado 4 da revisao): a tela de raiz nao oferece `nature`, mas
 * a coluna e `not null`. Este default preenche a raiz. Ele **nao e dado** — a
 * natureza pertence a folha; so existe para o caso de lancamento anexado direto
 * na raiz, que a UI nao faz. A tela nao exibe a natureza da raiz como se fosse
 * classificacao real.
 */
export const DEFAULT_ROOT_NATURE: CategoryNature = 'non_essential';

export type CategoryListItem = {
  id: string;
  name: string;
  parentId: string | null;
  nature: CategoryNature;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  children: CategoryListItem[];
};

/** Entrada de criacao. `parentId` define a hierarquia, so na criacao. */
export type CategoryCreate = {
  name: string;
  /** `null` = raiz. Nunca aponta para uma folha (2 niveis). */
  parentId: string | null;
  /** Obrigatoria na folha; na raiz o servidor aplica o default. */
  nature: CategoryNature | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
};

/** Entrada de atualizacao. **Sem `parentId`**: a hierarquia nao muda. */
export type CategoryUpdate = {
  name: string;
  nature: CategoryNature | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
};

/** `parent_id` aponta para uma folha: criaria um 3o nivel. */
export class CategoryDepthError extends Error {
  constructor() {
    super('Uma subcategoria não pode ter outra subcategoria abaixo dela.');
    this.name = 'CategoryDepthError';
  }
}

/** Folha sem natureza — a classificacao do lancamento ficaria indefinida. */
export class CategoryNatureRequiredError extends Error {
  constructor() {
    super('Informe a natureza da subcategoria.');
    this.name = 'CategoryNatureRequiredError';
  }
}

/** A raiz pai informada nao existe no household. */
export class InvalidCategoryParentError extends Error {
  constructor() {
    super('Categoria pai inválida.');
    this.name = 'InvalidCategoryParentError';
  }
}

/** A categoria tem filhas e nao pode ser excluida sem excluir a subarvore. */
export class CategoryHasChildrenError extends Error {
  constructor() {
    super('Exclua primeiro as subcategorias desta categoria.');
    this.name = 'CategoryHasChildrenError';
  }
}

/** A categoria esta em uso por lancamento, regra, orcamento ou plano. */
export class CategoryInUseError extends Error {
  constructor() {
    super('Esta categoria está em uso e não pode ser excluída.');
    this.name = 'CategoryInUseError';
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super('Categoria não encontrada.');
    this.name = 'CategoryNotFoundError';
  }
}

function toNode(row: {
  id: string;
  name: string;
  parentId: string | null;
  nature: CategoryNature;
  icon: string | null;
  color: string | null;
  sortOrder: number;
}): CategoryListItem {
  return { ...row, children: [] };
}

/**
 * Arvore de categorias do household: raizes (ordenadas por `sort_order`, nome)
 * com as folhas dentro. A tela monta o seletor a partir daqui.
 */
export async function listCategories(householdId: string): Promise<CategoryListItem[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      nature: categories.nature,
      icon: categories.icon,
      color: categories.color,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const nodes = new Map<string, CategoryListItem>();
  const roots: CategoryListItem[] = [];
  for (const row of rows) nodes.set(row.id, toNode(row));

  for (const row of rows) {
    const node = nodes.get(row.id);
    if (node === undefined) continue;
    if (row.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(row.parentId);
    if (parent === undefined) {
      // Dado orfao nao some em silencio: aparece como raiz para o usuario
      // perceber. Nao deveria acontecer com a FK em vigor.
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  return roots;
}

async function ensureParentIsRoot(
  householdId: string,
  parentId: string,
): Promise<void> {
  const [parent] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, parentId), eq(categories.householdId, householdId)))
    .limit(1);

  if (!parent) throw new InvalidCategoryParentError();
  if (parent.parentId !== null) throw new CategoryDepthError();
}

export async function createCategory(
  householdId: string,
  input: CategoryCreate,
): Promise<void> {
  if (input.parentId !== null) {
    await ensureParentIsRoot(householdId, input.parentId);
    // Defensivo: o Zod ja exige natureza na folha. Aqui a mensagem fala de
    // natureza, nao de profundidade (achado 3 da revisao).
    if (input.nature === null) throw new CategoryNatureRequiredError();
  }

  await db.insert(categories).values({
    householdId,
    name: input.name,
    parentId: input.parentId,
    // Folha exige natureza (guardada acima); raiz usa o default.
    nature: input.nature ?? DEFAULT_ROOT_NATURE,
    icon: input.icon,
    color: input.color,
    sortOrder: input.sortOrder,
  });
}

export async function updateCategory(
  householdId: string,
  id: string,
  input: CategoryUpdate,
): Promise<void> {
  const [current] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .limit(1);
  if (!current) throw new CategoryNotFoundError();

  // Raiz nao troca de natureza pela tela (nao oferece o campo): preserva a que
  // ja tem. Folha atualiza; sem natureza no corpo, preserva a atual.
  const nature = current.parentId === null ? undefined : (input.nature ?? undefined);

  await db
    .update(categories)
    .set({
      name: input.name,
      icon: input.icon,
      color: input.color,
      sortOrder: input.sortOrder,
      ...(nature === undefined ? {} : { nature }),
    })
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
}

/**
 * Exclui uma categoria. Recusa quando ela tem filhas ou esta em uso — as FKs
 * `restrict`/`NO ACTION` tambem recusariam, mas o erro de banco nao explica ao
 * usuario o que fazer.
 */
export async function deleteCategory(householdId: string, id: string): Promise<void> {
  const [current] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .limit(1);
  if (!current) throw new CategoryNotFoundError();

  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, id), eq(categories.householdId, householdId)))
    .limit(1);
  if (child) throw new CategoryHasChildrenError();

  const referenceQueries = await Promise.all([
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.categoryId, id), eq(transactions.householdId, householdId)))
      .limit(1),
    db
      .select({ id: categorizationRules.id })
      .from(categorizationRules)
      .where(
        and(eq(categorizationRules.categoryId, id), eq(categorizationRules.householdId, householdId)),
      )
      .limit(1),
    db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.categoryId, id), eq(budgets.householdId, householdId)))
      .limit(1),
    db
      .select({ id: installmentPlans.id })
      .from(installmentPlans)
      .where(
        and(eq(installmentPlans.categoryId, id), eq(installmentPlans.householdId, householdId)),
      )
      .limit(1),
    db
      .select({ id: recurringExpenses.id })
      .from(recurringExpenses)
      .where(
        and(eq(recurringExpenses.categoryId, id), eq(recurringExpenses.householdId, householdId)),
      )
      .limit(1),
  ]);
  if (referenceQueries.some((rows) => rows.length > 0)) throw new CategoryInUseError();

  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
}
