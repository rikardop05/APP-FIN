import type { CategoryNature, Frequency } from '@/lib/db/enums';
import { competenceRange, toCompetence } from '@/lib/date';

/**
 * Decisoes puras da tela de despesas fixas e receitas: quais categorias o
 * seletor oferece, a conversao do reajuste (percentual na tela, basis points no
 * servidor), o rotulo de mes e os textos que a pessoa le. Moram aqui porque o
 * vitest deste repo nao transforma JSX: o que nao estiver numa funcao pura nao
 * tem teste.
 */

// ---------------------------------------------------------------------------
// Categorias: folhas agrupadas pela raiz.
// ---------------------------------------------------------------------------

/** Forma da arvore que `listCategories` devolve: raizes com as folhas dentro. */
export type CategoryTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  nature: CategoryNature;
  children: CategoryTreeNode[];
};

export type LeafCategoryGroup = {
  /** Id da raiz (ou `'orphans'` para folha sem raiz encontrada). */
  id: string;
  name: string;
  leaves: { id: string; name: string }[];
};

/**
 * Folhas que uma despesa fixa pode usar, agrupadas pela raiz, na ordem da
 * arvore. `listCategories` devolve so as RAIZES no nivel de cima (as folhas
 * estao em `children`); filtrar `parentId !== null` nesse nivel devolve lista
 * vazia — foi o defeito do seletor "Sem categoria-folha cadastrada".
 *
 * Folha de natureza `income` fica fora: despesa fixa em categoria de receita
 * nao faz sentido. Raiz sem filhas tambem fica fora (o servidor recusa raiz).
 * Folha orfa (a arvore a devolve no nivel de cima com `parentId` preenchido)
 * entra num grupo "Outras", para nao sumir em silencio.
 */
export function leafCategoryGroups(tree: readonly CategoryTreeNode[]): LeafCategoryGroup[] {
  const groups: LeafCategoryGroup[] = [];
  const orphans: LeafCategoryGroup['leaves'] = [];
  for (const node of tree) {
    if (node.parentId !== null) {
      if (node.nature !== 'income') orphans.push({ id: node.id, name: node.name });
      continue;
    }
    const leaves = node.children
      .filter((child) => child.nature !== 'income')
      .map((child) => ({ id: child.id, name: child.name }));
    if (leaves.length > 0) groups.push({ id: node.id, name: node.name, leaves });
  }
  if (orphans.length > 0) groups.push({ id: 'orphans', name: 'Outras', leaves: orphans });
  return groups;
}

/** Primeira folha oferecida, para o valor inicial do seletor. */
export function firstLeafId(groups: readonly LeafCategoryGroup[]): string {
  return groups[0]?.leaves[0]?.id ?? '';
}

/** Nome da folha pelo id (para a lista mostrar o nome logo apos criar). */
export function leafCategoryName(
  groups: readonly LeafCategoryGroup[],
  id: string,
): string | null {
  for (const group of groups) {
    const leaf = group.leaves.find((candidate) => candidate.id === id);
    if (leaf) return leaf.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reajuste anual: a pessoa digita percentual; o servidor guarda basis points.
// ---------------------------------------------------------------------------

export type AdjustmentParse =
  | { ok: true; basisPoints: number | null }
  | { ok: false; message: string };

/**
 * `"5"`, `"5,0"`, `"5.0"` e `"5%"` -> 500 bp; `"4,75"` -> 475; `""` -> `null`
 * (sem reajuste). Ate duas casas decimais, que e a precisao do basis point. A
 * conversao e feita sobre os digitos, sem ponto flutuante.
 */
export function parseAdjustmentPercent(input: string): AdjustmentParse {
  const text = input.trim().replace(/\s*%$/, '');
  if (text === '') return { ok: true, basisPoints: null };
  const match = /^(-?)(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text);
  if (match === null) {
    if (/^-?\d+[.,]\d{3,}$/.test(text)) {
      return { ok: false, message: 'Use no máximo duas casas decimais no reajuste (ex.: 4,75).' };
    }
    return { ok: false, message: 'Informe o reajuste em percentual, por exemplo 5 ou 4,5.' };
  }
  const [, sign = '', whole = '0', fraction = ''] = match;
  const magnitude = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (magnitude === 0) return { ok: true, basisPoints: 0 };
  return { ok: true, basisPoints: sign === '-' ? -magnitude : magnitude };
}

/**
 * Basis points -> texto do campo, o inverso de `parseAdjustmentPercent`:
 * 500 -> `"5"`, 450 -> `"4,5"`, 475 -> `"4,75"`, `null` -> `""`.
 */
export function formatAdjustmentPercent(basisPoints: number | null): string {
  if (basisPoints === null) return '';
  const sign = basisPoints < 0 ? '-' : '';
  const absolute = Math.abs(basisPoints);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  if (fraction === 0) return `${sign}${String(whole)}`;
  if (fraction % 10 === 0) return `${sign}${String(whole)},${String(fraction / 10)}`;
  return `${sign}${String(whole)},${String(fraction).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Mes (competencia) em pt-BR.
// ---------------------------------------------------------------------------

const MONTH_ABBREVIATIONS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const;

/** `'2026-10'` -> `'out/2026'`. */
export function formatMonthBR(competence: string): string {
  const [year = '', month = ''] = competence.split('-');
  const name = MONTH_ABBREVIATIONS[Number(month) - 1];
  if (name === undefined) return competence;
  return `${name}/${year}`;
}

/**
 * Meses oferecidos no seletor de receita eventual: do mes corrente para a
 * frente, `months` meses. O mes ja gravado (`current`) entra no topo se estiver
 * fora da janela, para editar uma regra antiga nao apagar o valor.
 */
export function oneOffMonthOptions(
  today: string,
  months: number,
  current: string | null,
): { value: string; label: string }[] {
  const range = competenceRange(toCompetence(today), months);
  if (current !== null && !range.includes(current)) range.unshift(current);
  return range.map((value) => ({ value, label: formatMonthBR(value) }));
}

// ---------------------------------------------------------------------------
// Textos da tela. Sem nome de variavel, sem "bp", sem "banco".
// ---------------------------------------------------------------------------

export const expenseText = {
  dialogDescription: (previewMonths: number): string =>
    `Uma conta que se repete, como aluguel ou internet. Antes de salvar, dá para conferir as cobranças previstas para os próximos ${String(previewMonths)} meses.`,
  amountHint: 'Digite o valor sem sinal de menos: ele já entra como gasto.',
  categoryLabel: 'Categoria',
  categoryEmpty: 'Nenhuma subcategoria cadastrada',
  paymentHint: 'Escolha só um: a conta ou o cartão por onde a despesa é paga.',
  startsOnHint: 'A primeira cobrança é no primeiro dia de vencimento a partir desta data.',
  adjustmentLabel: 'Reajuste anual em % (opcional)',
  adjustmentPlaceholder: 'Ex.: 5 ou 4,5',
  adjustmentHint: 'O valor sobe essa porcentagem a cada 12 meses, contados do mês inicial.',
} as const;

export const incomeText = {
  dialogDescription: (previewMonths: number): string =>
    `Dinheiro que entra com regularidade, como salário. Para algo que entra uma vez só, como 13º ou PLR, escolha a frequência Eventual e o mês. Antes de salvar, dá para conferir os recebimentos previstos para os próximos ${String(previewMonths)} meses.`,
  startsOnLabel: (frequency: Frequency): string =>
    frequency === 'one_off' ? 'Início (opcional)' : 'Início',
  startsOnHint: 'O primeiro recebimento é no primeiro dia de recebimento a partir desta data.',
  endsOnLabel: 'Fim (opcional)',
  oneOffMonthLabel: 'Mês do recebimento',
  oneOffMonthPlaceholder: 'Escolha o mês',
  oneOffMonthHint: 'Só para receita eventual, como 13º ou PLR.',
} as const;

export const previewText = {
  title: (previewMonths: number): string =>
    `Próximos ${String(previewMonths)} meses — previsto, ainda não realizado.`,
  empty: (previewMonths: number): string =>
    `Nenhuma ocorrência prevista nos próximos ${String(previewMonths)} meses.`,
  occurrenceMonth: (competence: string): string => `referente a ${formatMonthBR(competence)}`,
} as const;

/** Sufixo do item de receita eventual na lista: `' · em dez/2026'`. */
export function oneOffListSuffix(competence: string | null): string {
  return competence === null ? '' : ` · em ${formatMonthBR(competence)}`;
}
