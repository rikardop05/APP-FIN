import { parseBRL, type Cents } from '@/lib/money';

/**
 * Um campo do formulário: texto livre em reais (`''` = sem orçamento nesta
 * categoria; `'0'` = orçamento zero, que é informação).
 */
export type BudgetFieldValues = Record<string, string>;

export type BuiltSaveBody =
  | { ok: true; body: { period: string; items: { categoryId: string; plannedCents: Cents }[] } }
  | { ok: false; invalidCategoryIds: string[] };

/**
 * Monta o corpo do `PUT /api/budgets` EXATAMENTE como a tela o envia. Mora num
 * módulo puro porque o teste de fronteira (`app/api/budgets/body-shape.test.ts`)
 * importa esta mesma função e valida o resultado contra o schema real da rota:
 * duas pontas de um contrato que nenhuma ferramenta compara sozinha foram a causa
 * de três telas quebradas com o gate verde.
 *
 * Campo vazio vira "sem orçamento" (não entra em `items`, então é apagado do
 * mês). Campo com texto que `parseBRL` não entende, ou negativo, é INVÁLIDO: não
 * é descartado em silêncio, devolve a lista para a tela apontar.
 */
export function buildSaveBody(period: string, fields: BudgetFieldValues): BuiltSaveBody {
  const items: { categoryId: string; plannedCents: Cents }[] = [];
  const invalidCategoryIds: string[] = [];
  for (const [categoryId, text] of Object.entries(fields)) {
    if (text.trim() === '') continue;
    const parsed = parseBRL(text);
    if (parsed === null || parsed < 0) {
      invalidCategoryIds.push(categoryId);
      continue;
    }
    items.push({ categoryId, plannedCents: parsed });
  }
  if (invalidCategoryIds.length > 0) return { ok: false, invalidCategoryIds };
  return { ok: true, body: { period, items } };
}
