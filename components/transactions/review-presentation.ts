import type { ReviewCategory, ReviewGroup, ReviewResult } from './schemas';

/** Estado editavel de um grupo na tela de revisao. */
export type ReviewDraft = {
  pattern: string;
  categoryId: string;
  createRule: boolean;
};

export type CategoryChoice = { id: string; label: string };

/**
 * Categorias que o grupo pode receber: so FOLHA (categoria com filhas e
 * agrupamento, nao destino) e da natureza certa para o sentido do grupo —
 * entrada vai para categoria de receita, saida para as demais. Rotulo com a
 * raiz ("Alimentacao › Mercado") para desambiguar nomes repetidos.
 */
export function categoryChoices(
  categories: readonly ReviewCategory[],
  direction: ReviewGroup['direction'],
): CategoryChoice[] {
  const parents = new Set(categories.flatMap((category) => (category.parentId === null ? [] : [category.parentId])));
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return categories
    .filter((category) => !parents.has(category.id))
    .filter((category) => (direction === 'in') === (category.nature === 'income'))
    .map((category) => ({
      id: category.id,
      label: category.parentId === null ? category.name : `${names.get(category.parentId) ?? ''} › ${category.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/**
 * Estado inicial: categoria sugerida pela regra que ja casa o grupo, e
 * "criar regra" marcado — salvo quando o grupo ja tem regra (criar outra seria
 * duplicata) ou nao tem padrao sugerido (o usuario escreve antes).
 */
export function initialDraft(group: ReviewGroup): ReviewDraft {
  return {
    pattern: group.pattern,
    categoryId: group.suggestedCategoryId ?? '',
    createRule: group.ruleId === null && group.pattern !== '',
  };
}

export type ConfirmationBody = {
  transactionIds: string[];
  categoryId: string;
  newRulePattern: string | null;
};

/** Corpo do POST, ou a mensagem que impede confirmar. */
export function confirmationBody(
  group: ReviewGroup,
  draft: ReviewDraft,
): { ok: true; body: ConfirmationBody } | { ok: false; message: string } {
  if (draft.categoryId === '') return { ok: false, message: 'Escolha a categoria.' };
  const pattern = draft.pattern.trim();
  if (draft.createRule && pattern === '') return { ok: false, message: 'Informe o padrão da regra ou desmarque "Criar regra".' };
  return {
    ok: true,
    body: {
      transactionIds: group.transactionIds,
      categoryId: draft.categoryId,
      newRulePattern: draft.createRule ? pattern : null,
    },
  };
}

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}

/** Frase do resultado de confirmar um grupo. */
export function reviewResultMessage(result: ReviewResult): string {
  const parts = [count(result.categorized, 'lançamento categorizado', 'lançamentos categorizados')];
  if (result.ruleId !== null) parts.push('regra criada para os próximos');
  if (result.propagated > 0) {
    parts.push(`${count(result.propagated, 'parcela sem categoria acompanhou', 'parcelas sem categoria acompanharam')} o parcelamento`);
  }
  if (result.skipped > 0) {
    parts.push(`${count(result.skipped, 'pulado porque mudou', 'pulados porque mudaram')} desde que a tela abriu`);
  }
  return `${parts.join('; ')}.`;
}
