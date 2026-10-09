import { formatDateBR } from '@/lib/date';

/**
 * Filtros da lista de lançamentos (impeccable distill): ficam recolhidos atrás de um botão que diz
 * QUANTOS estão ativos, aplicam sozinhos (sem botão "Filtrar") e, com o painel fechado, um resumo
 * em texto diz quais são. Lógica pura, fora do .tsx (o vitest não transforma JSX).
 */

export type TransactionFilterValues = {
  from: string;
  to: string;
  categoryId: string;
  accountId: string;
  creditCardId: string;
  memberId: string;
  search: string;
  uncategorized: boolean;
};

export const EMPTY_FILTERS: TransactionFilterValues = {
  from: '',
  to: '',
  categoryId: '',
  accountId: '',
  creditCardId: '',
  memberId: '',
  search: '',
  uncategorized: false,
};

type NamedOptions = {
  categories: readonly { id: string; name: string }[];
  accounts: readonly { id: string; name: string }[];
  cards: readonly { id: string; name: string }[];
  members: readonly { id: string; name: string }[];
};

/** Quantos filtros estão ativos: o período conta UM (mesmo com as duas datas), cada outro campo conta um. */
export function activeFilterCount(filters: TransactionFilterValues): number {
  return [
    filters.from !== '' || filters.to !== '',
    filters.categoryId !== '',
    filters.accountId !== '',
    filters.creditCardId !== '',
    filters.memberId !== '',
    filters.search.trim() !== '',
    filters.uncategorized,
  ].filter(Boolean).length;
}

export function filterToggleLabel(count: number): string {
  return count === 0 ? 'Filtros' : `Filtros (${String(count)})`;
}

function nameOf(list: readonly { id: string; name: string }[], id: string): string {
  return list.find((item) => item.id === id)?.name ?? '(removida)';
}

/** Uma frase por filtro ativo, com o NOME (não o id) e a data em pt-BR: o resumo do painel fechado. */
export function activeFilterLabels(filters: TransactionFilterValues, options: NamedOptions): string[] {
  const labels: string[] = [];
  if (filters.from !== '' && filters.to !== '') {
    labels.push(`Período: ${formatDateBR(filters.from)} a ${formatDateBR(filters.to)}`);
  } else if (filters.from !== '') {
    labels.push(`Período: a partir de ${formatDateBR(filters.from)}`);
  } else if (filters.to !== '') {
    labels.push(`Período: até ${formatDateBR(filters.to)}`);
  }
  if (filters.categoryId !== '') labels.push(`Categoria: ${nameOf(options.categories, filters.categoryId)}`);
  if (filters.accountId !== '') labels.push(`Conta: ${nameOf(options.accounts, filters.accountId)}`);
  if (filters.creditCardId !== '') labels.push(`Cartão: ${nameOf(options.cards, filters.creditCardId)}`);
  if (filters.memberId !== '') labels.push(`Responsável: ${nameOf(options.members, filters.memberId)}`);
  if (filters.search.trim() !== '') labels.push(`Texto: “${filters.search.trim()}”`);
  if (filters.uncategorized) labels.push('Só não categorizados');
  return labels;
}

/** Espera de quem digita no campo de texto antes de consultar (ms). */
export const SEARCH_DEBOUNCE_MS = 350;

/**
 * Quando aplicar o filtro que mudou: seleção, data e caixa de marcar na hora; texto só depois que a
 * pessoa para de digitar. Texto "igual" (só espaço nas pontas) não atrasa, porque a consulta o apara.
 */
export function applyDelayMs(applied: TransactionFilterValues, next: TransactionFilterValues): number {
  return applied.search.trim() === next.search.trim() ? 0 : SEARCH_DEBOUNCE_MS;
}
