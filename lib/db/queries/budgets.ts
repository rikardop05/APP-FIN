/**
 * Orçamento por categoria — T-205.
 *
 * Nada aqui calcula semáforo, uso, restante nem média: `budgetStatus` e
 * `suggestBudgetFromHistory` (lib/finance/budget.ts, CONTRACTS §10) decidem. Esta
 * camada só lê o banco, entrega os dados ao motor e devolve o que ele devolveu.
 *
 * ## O que é "realizado" (ratificado em 2026-10-01)
 *
 * `spent` = transações do household com `competence = período`,
 * `kind = 'expense'`, **`status = 'posted'`** e `categoryId` não nulo.
 * `transfer`, `credit_card_payment` e `investment_contribution` ficam de fora
 * (RC-03).
 *
 * `planned` NÃO entra: a previsão de recorrência agora é linha no banco, e somar
 * `planned` ao realizado deixaria o semáforo vermelho no dia 1 do mês. Em vez
 * disso o "previsto a realizar" sai numa coluna à parte (`upcomingCents`), de
 * modo que `realizado + previsto` fecha com o dashboard (`kpis.ts` soma os dois).
 * O semáforo olha só o realizado, como o contrato manda.
 *
 * ## Quem tem orçamento
 *
 * Só FOLHA (`parent_id` não nulo) de natureza `essential` ou `non_essential`.
 * `income` não é despesa. `investment` ficaria em 0% para sempre, porque o aporte
 * é `investment_contribution` e fica fora de `spent`: um número que nunca se move
 * é pior que um erro, porque ninguém desconfia dele.
 *
 * Fronteira de household (CONVENTIONS §7): toda consulta carrega `household_id`.
 */

import { and, asc, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import type { CategoryNature } from '@/lib/db/enums';
import { budgets, categories, householdSettings, transactions } from '@/lib/db/schema';
import { addCompetence, type Competence } from '@/lib/date';
import {
  budgetStatus,
  suggestBudgetFromHistory,
  type BudgetStatusRow,
} from '@/lib/finance/budget';
import { basisPoints, cents, type BasisPoints, type Cents } from '@/lib/money';

/** Naturezas que aceitam orçamento. Ver o cabeçalho. */
export const BUDGETABLE_NATURES = ['essential', 'non_essential'] as const satisfies readonly CategoryNature[];

export class BudgetReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetReferenceError';
  }
}

/** Categoria que pode receber orçamento, com o nome da raiz para agrupar na tela. */
export interface BudgetableCategory {
  id: string;
  name: string;
  rootId: string;
  rootName: string;
  nature: CategoryNature;
}

export interface BudgetMonthRow extends BudgetStatusRow {
  categoryName: string;
  rootName: string;
  /** Soma das `planned` de despesa da categoria no mês, em módulo. Fora do semáforo. */
  upcomingCents: Cents;
}

export interface BudgetMonth {
  period: Competence;
  warnBp: BasisPoints;
  rows: BudgetMonthRow[];
}

export interface OverBudgetItem {
  categoryId: string;
  categoryName: string;
  plannedCents: Cents;
  spentCents: Cents;
  /** `null` só quando `plannedCents = 0`. */
  usageBp: BasisPoints | null;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Folhas de despesa da família, ordenadas por raiz e nome. */
export async function listBudgetableCategories(householdId: string): Promise<BudgetableCategory[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      nature: categories.nature,
      parentId: categories.parentId,
    })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        isNotNull(categories.parentId),
        inArray(categories.nature, [...BUDGETABLE_NATURES]),
      ),
    )
    .orderBy(asc(categories.name));

  const roots = await db
    .select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const rootById = new Map(roots.map((root) => [root.id, root]));

  return rows
    .flatMap((row) => {
      const root = row.parentId === null ? undefined : rootById.get(row.parentId);
      return root === undefined
        ? []
        : [
            {
              id: row.id,
              name: row.name,
              rootId: root.id,
              rootName: root.name,
              nature: row.nature,
              rootSort: root.sortOrder,
            },
          ];
    })
    .sort(
      (a, b) =>
        a.rootSort - b.rootSort ||
        a.rootName.localeCompare(b.rootName, 'pt-BR') ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
    .map(({ rootSort: _rootSort, ...rest }) => {
      void _rootSort;
      return rest;
    });
}

type SpentRow = { categoryId: string; amountCents: Cents };

/**
 * Despesa REALIZADA por categoria em UMA competência (`posted`, `expense`,
 * categorizada). A soma é com sinal (saída negativa); o piso em zero é do motor.
 */
async function readSpent(householdId: string, competence: Competence): Promise<SpentRow[]> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.competence, competence),
        eq(transactions.kind, 'expense'),
        eq(transactions.status, 'posted'),
        isNotNull(transactions.categoryId),
      ),
    )
    .groupBy(transactions.categoryId);
  return rows.flatMap((row) =>
    row.categoryId === null ? [] : [{ categoryId: row.categoryId, amountCents: cents(Number(row.total)) }],
  );
}

/** Despesa PREVISTA ainda não realizada por categoria na competência (`planned`). */
async function readUpcoming(householdId: string, competence: Competence): Promise<Map<string, Cents>> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.competence, competence),
        eq(transactions.kind, 'expense'),
        eq(transactions.status, 'planned'),
        isNotNull(transactions.categoryId),
      ),
    )
    .groupBy(transactions.categoryId);
  const result = new Map<string, Cents>();
  for (const row of rows) {
    if (row.categoryId === null) continue;
    // Saída é negativa; mostra-se em módulo, com piso em zero (CONTRACTS §14).
    const net = Number(row.total);
    result.set(row.categoryId, cents(net < 0 ? -net : 0));
  }
  return result;
}

async function readWarnBp(householdId: string): Promise<BasisPoints> {
  const [row] = await db
    .select({ budgetWarnBp: householdSettings.budgetWarnBp })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId))
    .limit(1);
  if (row === undefined) throw new Error('Configurações da família não encontradas. Rode o seed.');
  return basisPoints(row.budgetWarnBp);
}

/** Orçamento do mês: semáforo (do motor) sobre o realizado, mais o previsto. */
export async function getBudgetMonth(householdId: string, period: Competence): Promise<BudgetMonth> {
  const [budgetRows, spent, upcoming, warnBp] = await Promise.all([
    db
      .select({
        categoryId: budgets.categoryId,
        plannedCents: budgets.plannedCents,
        categoryName: categories.name,
        parentId: categories.parentId,
      })
      .from(budgets)
      .innerJoin(categories, eq(categories.id, budgets.categoryId))
      .where(and(eq(budgets.householdId, householdId), eq(budgets.period, period))),
    readSpent(householdId, period),
    readUpcoming(householdId, period),
    readWarnBp(householdId),
  ]);

  const rootNames = await rootNameMap(
    householdId,
    budgetRows.flatMap((row) => (row.parentId === null ? [] : [row.parentId])),
  );

  // Ordem estável: raiz e depois nome (a mesma da tela). O motor mantém a ordem recebida.
  const ordered = [...budgetRows].sort(
    (a, b) =>
      (rootNames.get(a.parentId ?? '') ?? '').localeCompare(rootNames.get(b.parentId ?? '') ?? '', 'pt-BR') ||
      a.categoryName.localeCompare(b.categoryName, 'pt-BR'),
  );

  const status = budgetStatus({
    budgets: ordered.map((row) => ({ categoryId: row.categoryId, plannedCents: cents(row.plannedCents) })),
    spent,
    warnBp,
  });

  const byId = new Map(ordered.map((row) => [row.categoryId, row]));
  return {
    period,
    warnBp,
    rows: status.map((row) => {
      const meta = byId.get(row.categoryId);
      return {
        ...row,
        categoryName: meta?.categoryName ?? '',
        rootName: rootNames.get(meta?.parentId ?? '') ?? '',
        upcomingCents: upcoming.get(row.categoryId) ?? cents(0),
      };
    }),
  };
}

async function rootNameMap(householdId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), inArray(categories.id, [...new Set(ids)])));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Orçamentos estourados no mês — o que o painel (T-208) consome.
 *
 * **Estourado = `light === 'red'` devolvido por `budgetStatus`, NÃO uma
 * comparação refeita.** Uma segunda comparação divergiria do semáforo da tela de
 * orçamento, e o painel diria "estourado" sobre linha que o orçamento mostra
 * amarela. Isso inclui `plannedCents = 0` com gasto (orçamento explícito de zero
 * violado), coerente com o §10. Mesmo realizado (`posted`) da tela.
 *
 * Ordem: maior uso primeiro; `usageBp = null` (orçamento zero) antes de todos.
 */
export async function listOverBudget(
  householdId: string,
  competence: Competence,
): Promise<OverBudgetItem[]> {
  const month = await getBudgetMonth(householdId, competence);
  return month.rows
    .filter((row) => row.light === 'red')
    .map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      plannedCents: row.plannedCents,
      spentCents: row.spentCents,
      usageBp: row.usageBp,
    }))
    .sort((a, b) => {
      if (a.usageBp === null && b.usageBp === null) return a.categoryName.localeCompare(b.categoryName, 'pt-BR');
      if (a.usageBp === null) return -1;
      if (b.usageBp === null) return 1;
      return b.usageBp - a.usageBp || a.categoryName.localeCompare(b.categoryName, 'pt-BR');
    });
}

export type SuggestionMode = 'previous' | 'avg3';

const SUGGESTION_MONTHS: Record<SuggestionMode, number> = { previous: 1, avg3: 3 };

/**
 * Sugestão de orçamento para `period` a partir do REALIZADO dos meses anteriores.
 * **Só leitura.** Nenhum caminho daqui grava o sugerido: quem grava é a pessoa,
 * ao confirmar (`replaceBudgets`).
 *
 * A janela termina no mês ANTERIOR ao orçado (`anchor`), passado explicitamente ao
 * motor: sem isso "repetir o mês anterior" repetiria o de dois meses atrás quando
 * o anterior esteve vazio, em silêncio (ver `suggestBudgetFromHistory`).
 */
export async function getBudgetSuggestion(
  householdId: string,
  period: Competence,
  mode: SuggestionMode,
): Promise<{ categoryId: string; suggestedCents: Cents }[]> {
  const months = SUGGESTION_MONTHS[mode];
  const anchor = addCompetence(period, -1);
  const from = addCompetence(period, -months);

  const [rows, allowed] = await Promise.all([
    db
      .select({
        competence: transactions.competence,
        categoryId: transactions.categoryId,
        total: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.competence, from),
          lte(transactions.competence, anchor),
          eq(transactions.kind, 'expense'),
          eq(transactions.status, 'posted'),
          isNotNull(transactions.categoryId),
        ),
      )
      .groupBy(transactions.competence, transactions.categoryId),
    listBudgetableCategories(householdId),
  ]);

  const allowedIds = new Set(allowed.map((category) => category.id));
  const history = rows.flatMap((row) =>
    row.categoryId === null || !allowedIds.has(row.categoryId)
      ? []
      : [{ competence: row.competence, categoryId: row.categoryId, amountCents: cents(Number(row.total)) }],
  );
  return suggestBudgetFromHistory(history, { months, anchor });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export interface BudgetItemInput {
  categoryId: string;
  plannedCents: Cents;
}

/**
 * Substitui o CONJUNTO de orçamentos do mês, numa transação: faz upsert dos itens
 * recebidos e apaga os do mês que não vieram. O formulário é o mês inteiro; uma
 * categoria apagada na tela precisa sumir do banco, senão o orçamento fantasma
 * continua pintando semáforo sem ninguém ver.
 *
 * `plannedCents = 0` é aceito: significa "não quero gastar nada" — informação, não
 * ausência.
 *
 * Valida na fronteira, com mensagem legível: categoria da família, folha e de
 * natureza orçável. Sem `DO NOTHING`: `onConflictDoUpdate` no
 * `unique (household, period, category)`.
 */
export async function replaceBudgets(
  householdId: string,
  period: Competence,
  items: readonly BudgetItemInput[],
): Promise<void> {
  const ids = items.map((item) => item.categoryId);
  if (new Set(ids).size !== ids.length) {
    throw new BudgetReferenceError('Há categorias repetidas no orçamento.');
  }
  for (const item of items) {
    if (!Number.isSafeInteger(item.plannedCents) || item.plannedCents < 0) {
      throw new BudgetReferenceError('O valor do orçamento não pode ser negativo.');
    }
  }

  await db.transaction(async (tx) => {
    if (ids.length > 0) {
      const found = await tx
        .select({ id: categories.id, parentId: categories.parentId, nature: categories.nature })
        .from(categories)
        .where(and(eq(categories.householdId, householdId), inArray(categories.id, ids)));
      if (found.length !== ids.length) {
        throw new BudgetReferenceError('Categoria não encontrada.');
      }
      for (const category of found) {
        if (category.parentId === null) {
          throw new BudgetReferenceError('O orçamento é por subcategoria, não por categoria raiz.');
        }
        if (!(BUDGETABLE_NATURES as readonly CategoryNature[]).includes(category.nature)) {
          throw new BudgetReferenceError(
            category.nature === 'income'
              ? 'Receita não tem orçamento: orçamento é limite de despesa.'
              : 'Investimento não tem orçamento: o aporte fica fora do gasto e o percentual ficaria sempre em 0%.',
          );
        }
      }
    }

    await tx
      .delete(budgets)
      .where(
        ids.length === 0
          ? and(eq(budgets.householdId, householdId), eq(budgets.period, period))
          : and(
              eq(budgets.householdId, householdId),
              eq(budgets.period, period),
              notInArray(budgets.categoryId, ids),
            ),
      );

    if (items.length > 0) {
      await tx
        .insert(budgets)
        .values(
          items.map((item) => ({
            householdId,
            period,
            categoryId: item.categoryId,
            plannedCents: item.plannedCents,
          })),
        )
        .onConflictDoUpdate({
          target: [budgets.householdId, budgets.period, budgets.categoryId],
          set: { plannedCents: sql`excluded.planned_cents` },
        });
    }
  });
}
