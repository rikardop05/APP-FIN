import { addCompetence, competenceStart, toCompetence } from '@/lib/date';
// SÓ o tipo: o módulo do motor puxa `node:crypto` (via `dedupe`) e não pode entrar no navegador.
// As sugestões são calculadas no servidor (`page.tsx`) e chegam aqui prontas.
import type { RecurrenceSuggestion } from '@/lib/finance/recurrence-suggestions';
import { cents, formatBRL } from '@/lib/money';

import { firstLeafId, leafCategoryName, type LeafCategoryGroup } from './recurring-form';
import type { IncomeFormInput, RecurringExpenseFormInput } from './schemas';

/**
 * Bloco "Sugestões pelo histórico" de `/orcamento/recorrentes` (Lote 2, item 8): o texto da
 * evidência e o formulário PREENCHIDO a partir de uma sugestão. Nada aqui grava: "Cadastrar" abre
 * o formulário existente com estes valores, e a pessoa confirma. Puro e fora do `.tsx` porque o
 * vitest deste repo não transforma JSX.
 */

export type { RecurrenceSuggestion };

const MONTH_ABBREVIATIONS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const;

/**
 * Meses da evidência em pt-BR: `['2026-09','2026-10','2026-11']` -> `"set, out e nov"`. Quando os
 * meses atravessam o ano, cada um leva o ano (`"dez/2026 e jan/2027"`), senão "jan" ficaria ambíguo.
 */
export function evidenceMonthsText(months: readonly string[]): string {
  const sameYear = new Set(months.map((month) => month.slice(0, 4))).size <= 1;
  const names = months.map((month) => {
    const name = MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1] ?? month;
    return sameYear ? name : `${name}/${month.slice(0, 4)}`;
  });
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1] ?? ''}`;
}

/** Valor no campo do formulário: sem sinal e sem `R$`, como a tela já mostra ao editar. */
function amountInputText(amountCents: number): string {
  return formatBRL(cents(Math.abs(amountCents))).replace(/^R\$\s*/, '').trim();
}

/**
 * Data de início sugerida. Se a conta JÁ apareceu no mês de hoje, a regra começa no dia 1 do mês
 * que vem: começar hoje poderia gerar uma previsão para este mês de algo que já foi lançado (dia
 * sugerido 27, lançado no dia 25, hoje dia 26), e o mês contaria a conta duas vezes. Se ainda não
 * apareceu neste mês, começa hoje, e a primeira ocorrência é o próximo dia sugerido.
 */
export function suggestedStartsOn(suggestion: Pick<RecurrenceSuggestion, 'months'>, today: string): string {
  const current = toCompetence(today);
  return suggestion.months.includes(current) ? competenceStart(addCompetence(current, 1)) : today;
}

type Option = { id: string; name: string };

/**
 * Formulário de DESPESA FIXA preenchido. O que a sugestão não tem como saber fica no padrão do
 * formulário novo: frequência mensal, sem fim, sem reajuste.
 *
 * - Categoria: a mais frequente no histórico, se for uma subcategoria que o seletor oferece; senão
 *   a primeira oferecida (o histórico pode estar sem categoria ou em categoria de receita).
 * - Destino: o cartão ou a conta mais frequente, se ainda estiver ativo; senão a primeira conta.
 */
export function expenseFormFromSuggestion(
  suggestion: RecurrenceSuggestion,
  options: { categories: readonly LeafCategoryGroup[]; accounts: readonly Option[]; cards: readonly Option[] },
  today: string,
): RecurringExpenseFormInput {
  const categoryId =
    suggestion.categoryId !== null && leafCategoryName(options.categories, suggestion.categoryId) !== null
      ? suggestion.categoryId
      : firstLeafId(options.categories);
  const card = options.cards.find((item) => item.id === suggestion.creditCardId);
  const account = options.accounts.find((item) => item.id === suggestion.accountId);
  const creditCardId = card?.id ?? null;
  const accountId = creditCardId !== null ? null : (account?.id ?? options.accounts[0]?.id ?? null);
  return {
    description: suggestion.description.trim().slice(0, 240),
    amountInput: amountInputText(suggestion.medianCents),
    categoryId,
    dueDay: String(suggestion.suggestedDay),
    frequency: 'monthly',
    accountId,
    creditCardId,
    startsOn: suggestedStartsOn(suggestion, today),
    endsOn: null,
    annualAdjustmentPercent: '',
  };
}

/**
 * Formulário de RECEITA preenchido. O tipo fica em "Outro": o histórico não diz se é salário ou
 * aluguel, e a pessoa escolhe ao confirmar. Responsável e conta: os mais frequentes, se ainda
 * existirem nas opções; senão os primeiros.
 */
export function incomeFormFromSuggestion(
  suggestion: RecurrenceSuggestion,
  options: { members: readonly Option[]; accounts: readonly Option[] },
  today: string,
): IncomeFormInput {
  const member = options.members.find((item) => item.id === suggestion.memberId);
  const account = options.accounts.find((item) => item.id === suggestion.accountId);
  return {
    description: suggestion.description.trim().slice(0, 240),
    amountInput: amountInputText(suggestion.medianCents),
    kind: 'other',
    memberId: member?.id ?? options.members[0]?.id ?? '',
    accountId: account?.id ?? options.accounts[0]?.id ?? '',
    receiveDay: String(suggestion.suggestedDay),
    frequency: 'monthly',
    oneOffCompetence: null,
    startsOn: suggestedStartsOn(suggestion, today),
    endsOn: null,
  };
}

/** Sugestões ainda à vista: as que a pessoa não ignorou nem cadastrou nesta sessão. */
export function visibleSuggestions(
  suggestions: readonly RecurrenceSuggestion[],
  dismissedKeys: readonly string[],
): RecurrenceSuggestion[] {
  return suggestions.filter((suggestion) => !dismissedKeys.includes(suggestion.key));
}
