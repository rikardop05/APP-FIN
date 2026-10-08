import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  categories,
  categorizationRules,
  installmentPlans,
  transactions,
} from '@/lib/db/schema';

/**
 * Escrita da categorizacao automatica (F2) — o lado de banco do motor puro de
 * `lib/finance/categorization.ts`.
 *
 * As duas funcoes aceitam o executor de quem chama: a importacao roda numa
 * transacao so (CONVENTIONS §7) e o incremento de `hits` tem de entrar e sair
 * junto com o lote. Sem executor, usam a conexao padrao.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class InstallmentPlanNotFoundError extends Error {
  constructor() {
    super('Parcelamento não encontrado.');
    this.name = 'InstallmentPlanNotFoundError';
  }
}

/**
 * A categoria nao pertence ao household, tem filhas (nao e folha) ou e de
 * receita (parcelamento e despesa).
 */
export class InvalidPlanCategoryError extends Error {
  constructor() {
    super('Escolha uma categoria válida, que não tenha subcategorias.');
    this.name = 'InvalidPlanCategoryError';
  }
}

/**
 * Soma `n` ao `hits` de cada regra: `{ [ruleId]: n }`. Devolve quantas regras
 * foram atualizadas.
 *
 * Incremento no banco (`hits = hits + n`), nunca ler-somar-gravar: duas
 * importacoes simultaneas nao podem perder contagem. Contagem `<= 0` e ignorada
 * (nao existe "desfazer uso"), e regra de outro household nao e tocada.
 */
export async function incrementRuleHits(
  householdId: string,
  hitsByRuleId: Readonly<Record<string, number>>,
  executor: Executor = db,
): Promise<number> {
  let updated = 0;
  for (const [ruleId, count] of Object.entries(hitsByRuleId)) {
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    const rows = await executor
      .update(categorizationRules)
      .set({ hits: sql`${categorizationRules.hits} + ${count}` })
      .where(
        and(
          eq(categorizationRules.id, ruleId),
          eq(categorizationRules.householdId, householdId),
        ),
      )
      .returning({ id: categorizationRules.id });
    updated += rows.length;
  }
  return updated;
}

async function ensureExpenseLeafCategory(
  executor: Executor,
  householdId: string,
  categoryId: string,
): Promise<void> {
  const [row] = await executor
    .select({ nature: categories.nature })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (!row || row.nature === 'income') throw new InvalidPlanCategoryError();

  const [child] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  if (child) throw new InvalidPlanCategoryError();
}

/**
 * Grava a categoria do parcelamento e a propaga para as parcelas — TODAS, de
 * qualquer status (`posted`, `planned`, `reconciled`). Devolve quantas parcelas
 * mudaram.
 *
 * ## Regra de propagacao
 *
 * Uma parcela **acompanha o plano** quando a categoria dela e `null`, e igual
 * a categoria que o plano tinha ANTES desta chamada, ou veio de uma regra
 * (`category_rule_id` preenchido). So essas recebem a nova. Protegida e so a
 * categoria posta a mao: diferente da do plano e sem rastro de regra.
 *
 * Consequencias, de proposito:
 * - Troca A -> B: parcelas em A (que seguiam o plano) e as categorizadas por
 *   regra vao para B; a parcela posta a mao em C fica em C.
 * - Parcela que ja esta na categoria nova nao e tocada (nem perde o rastro da
 *   regra) e nao conta: reaplicar A -> A devolve 0.
 * - Parcela posta a mao na MESMA categoria do plano e indistinguivel de uma que
 *   seguia o plano, e passa a segui-lo. Nao ha perda: no momento ela concordava.
 * - `categoryId = null` limpa o plano e as parcelas que o seguiam.
 * - Parcela que muda por aqui perde `category_rule_id`: a categoria passa a vir
 *   do plano, nao da regra.
 *
 * Plano e parcelas mudam numa transacao, com o plano travado (`FOR UPDATE`):
 * duas trocas simultaneas nao leem a mesma "categoria anterior".
 */
export async function setInstallmentPlanCategory(
  householdId: string,
  planId: string,
  categoryId: string | null,
  executor: Executor = db,
): Promise<number> {
  return executor.transaction(async (tx) => {
    const [plan] = await tx
      .select({ categoryId: installmentPlans.categoryId })
      .from(installmentPlans)
      .where(and(eq(installmentPlans.id, planId), eq(installmentPlans.householdId, householdId)))
      .for('update')
      .limit(1);
    if (!plan) throw new InstallmentPlanNotFoundError();

    if (categoryId !== null) await ensureExpenseLeafCategory(tx, householdId, categoryId);

    await tx
      .update(installmentPlans)
      .set({ categoryId })
      .where(and(eq(installmentPlans.id, planId), eq(installmentPlans.householdId, householdId)));

    const followsPlan = or(
      isNull(transactions.categoryId),
      isNotNull(transactions.categoryRuleId),
      plan.categoryId === null ? undefined : eq(transactions.categoryId, plan.categoryId),
    );

    const changed = await tx
      .update(transactions)
      .set({ categoryId, categoryRuleId: null })
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.installmentPlanId, planId),
          followsPlan,
          // Ja na categoria nova: nada a fazer, nao conta.
          categoryId === null
            ? isNotNull(transactions.categoryId)
            : sql`${transactions.categoryId} is distinct from ${categoryId}`,
        ),
      )
      .returning({ id: transactions.id });
    return changed.length;
  });
}
