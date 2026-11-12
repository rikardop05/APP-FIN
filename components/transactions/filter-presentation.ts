import { formatDateBR } from '@/lib/date';
import type { SettlementFilter } from './payment-situation';

/**
 * Filtros da lista de lançamentos (impeccable distill): ficam recolhidos atrás de um botão que diz
 * QUANTOS estão ativos, aplicam sozinhos (sem botão "Filtrar") e, com o painel fechado, um resumo
 * em texto diz quais são. Lógica pura, fora do .tsx (o vitest não transforma JSX).
 */

/** Filtro rápido de direção: só receitas ou só despesas (pelo tipo do lançamento). */
export type DirectionFilter = '' | 'income' | 'expense';
/** Filtro rápido de origem: só cartão ou só conta. */
export type OriginFilter = '' | 'card' | 'account';

export type TransactionFilterValues = {
  /** Filtros rápidos, sempre à vista (Lote 2, item 5). */
  direction: DirectionFilter;
  origin: OriginFilter;
  from: string;
  to: string;
  categoryId: string;
  accountId: string;
  creditCardId: string;
  memberId: string;
  search: string;
  uncategorized: boolean;
  /** Situação de pagamento: filtro só da tela (não vai para a consulta). */
  settlement: SettlementFilter;
};

export const EMPTY_FILTERS: TransactionFilterValues = {
  direction: '',
  origin: '',
  from: '',
  to: '',
  categoryId: '',
  accountId: '',
  creditCardId: '',
  memberId: '',
  search: '',
  uncategorized: false,
  settlement: '',
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
    filters.direction !== '',
    filters.origin !== '',
    filters.from !== '' || filters.to !== '',
    filters.categoryId !== '',
    filters.accountId !== '',
    filters.creditCardId !== '',
    filters.memberId !== '',
    filters.search.trim() !== '',
    filters.uncategorized,
    filters.settlement !== '',
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
  if (filters.direction === 'income') labels.push('Só receitas');
  if (filters.direction === 'expense') labels.push('Só despesas');
  if (filters.origin === 'card') labels.push('Só cartão');
  if (filters.origin === 'account') labels.push('Só conta');
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
  if (filters.settlement === 'paid') labels.push('Situação: pagos');
  if (filters.settlement === 'pending') labels.push('Situação: pendentes');
  return labels;
}

/**
 * Quantos filtros do PAINEL recolhido estão ativos: período, categoria, conta e cartão específicos,
 * situação e "só não categorizados". Os filtros rápidos e a busca ficam sempre à vista e não entram
 * neste número, que é o do botão "Filtros".
 */
export function panelFilterCount(filters: TransactionFilterValues): number {
  return [
    filters.from !== '' || filters.to !== '',
    filters.categoryId !== '',
    filters.accountId !== '',
    filters.creditCardId !== '',
    filters.uncategorized,
    filters.settlement !== '',
  ].filter(Boolean).length;
}

/** O resumo em texto do painel fechado: só os filtros que moram nele (os rápidos já estão à vista). */
export function panelFilterLabels(filters: TransactionFilterValues, options: NamedOptions): string[] {
  return activeFilterLabels(
    { ...filters, direction: '', origin: '', memberId: '', search: '' },
    options,
  );
}

export type QuickToggle = {
  key: string;
  label: string;
  pressed: boolean;
  /** O que muda nos filtros ao apertar: liga, ou desliga se já estava ligado. */
  next: Partial<TransactionFilterValues>;
};

/**
 * Os botões de alternância dos filtros rápidos, na ordem da tela: Receitas, Despesas, Cartão, Conta e
 * um por responsável. Dentro de cada grupo só um fica ligado (Receitas desliga Despesas); apertar o
 * ligado o desliga.
 *
 * Cartão e Conta rápidos valem para QUALQUER cartão ou conta. Escolher um deles limpa o cartão ou a
 * conta específicos do painel que seriam contraditórios (Conta + um cartão específico daria lista vazia).
 */
export function quickToggles(
  filters: TransactionFilterValues,
  members: readonly { id: string; name: string }[],
): QuickToggle[] {
  const direction = (value: 'income' | 'expense', label: string): QuickToggle => ({
    key: `direction-${value}`,
    label,
    pressed: filters.direction === value,
    next: { direction: filters.direction === value ? '' : value },
  });
  const origin = (value: 'card' | 'account', label: string): QuickToggle => {
    const pressed = filters.origin === value;
    return {
      key: `origin-${value}`,
      label,
      pressed,
      next: pressed
        ? { origin: '' }
        : value === 'card'
          ? { origin: 'card', accountId: '' }
          : { origin: 'account', creditCardId: '' },
    };
  };
  return [
    direction('income', 'Receitas'),
    direction('expense', 'Despesas'),
    origin('card', 'Cartão'),
    origin('account', 'Conta'),
    ...members.map((member) => ({
      key: `member-${member.id}`,
      label: member.name,
      pressed: filters.memberId === member.id,
      next: { memberId: filters.memberId === member.id ? '' : member.id },
    })),
  ];
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

/** Ha algum filtro ativo (inclui Situacao, que e so da tela)? Decide "Nenhum lançamento encontrado" x "ainda". */
export function hasActiveFilters(filters: TransactionFilterValues): boolean {
  return activeFilterCount(filters) > 0;
}
