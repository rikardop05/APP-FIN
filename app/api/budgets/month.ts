import { getBudgetMonth, listBudgetableCategories } from '@/lib/db/queries/budgets';

/**
 * O que `GET` e `PUT /api/budgets` devolvem: o mês (semáforo do motor sobre o
 * realizado) mais as folhas orçáveis. O `PUT` devolve o mês já recarregado, então
 * a tela faz um só `.parse` (`budgetMonthResponseSchema`) nos dois caminhos.
 */
export async function loadBudgetMonthResponse(householdId: string, period: string) {
  const [month, categories] = await Promise.all([
    getBudgetMonth(householdId, period),
    listBudgetableCategories(householdId),
  ]);
  return { ...month, categories };
}
