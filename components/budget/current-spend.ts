import type { Cents } from '@/lib/money';

import { toFieldText } from './labels';
import type { BudgetFieldValues } from './save-body';

/**
 * "Usar o gasto deste mês como ponto de partida": o texto de cada campo a preencher.
 *
 * O número é o GASTO ESPERADO de cada categoria (realizado + previsto), exatamente como o motor
 * devolveu em `rows` e `unbudgeted`; aqui não há conta, só a escolha de qual número copiar. É o
 * esperado, e não só o realizado, porque é o esperado que a cor mede (decisão 10b): com o
 * realizado, toda categoria com despesa fixa ainda por vir nasceria estourada.
 *
 * Só PREENCHE: categoria sem gasto esperado fica como está, e nada é gravado.
 */
export function currentSpendFields(month: {
  categories: readonly { id: string }[];
  rows: readonly { categoryId: string; expectedCents: Cents }[];
  unbudgeted: readonly { categoryId: string; expectedCents: Cents }[];
}): BudgetFieldValues {
  const known = new Set(month.categories.map((category) => category.id));
  const fields: BudgetFieldValues = {};
  for (const item of [...month.rows, ...month.unbudgeted]) {
    if (!known.has(item.categoryId) || item.expectedCents <= 0) continue;
    fields[item.categoryId] = toFieldText(item.expectedCents);
  }
  return fields;
}
