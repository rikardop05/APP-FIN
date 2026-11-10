import { getBudgetMonth, listBudgetableCategories } from '@/lib/db/queries/budgets';

/**
 * O que `GET` e `PUT /api/budgets` devolvem: o mês (semáforo do motor sobre o
 * realizado), o gasto das categorias sem orçamento, o total do mês e as folhas orçáveis. O `PUT` devolve o mês já recarregado, então
 * a tela faz um só `.parse` (`budgetMonthResponseSchema`) nos dois caminhos.
 */
export async function loadBudgetMonthResponse(householdId: string, period: string) {
  // As folhas orçáveis são lidas UMA vez: a consulta do mês usa a mesma leitura para saber
  // quais categorias sem orçamento ela pode devolver em `unbudgeted`.
  const budgetable = listBudgetableCategories(householdId);
  const [month, categories] = await Promise.all([getBudgetMonth(householdId, period, budgetable), budgetable]);
  return { ...month, categories };
}
