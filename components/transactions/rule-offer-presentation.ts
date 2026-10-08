import type { RuleOffer, RuleOfferAccepted } from './schemas';

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}

/**
 * Depois de editar uma linha, vale perguntar por regra? So quando a categoria
 * mudou para uma categoria (tirar a categoria ou manter a mesma nao e decisao
 * nova sobre a loja).
 */
export function shouldOfferAfterEdit(previousCategoryId: string | null | undefined, nextCategoryId: string | null): boolean {
  return nextCategoryId !== null && nextCategoryId !== previousCategoryId;
}

/**
 * Texto da oferta: o que a regra faz agora e nas proximas importacoes. Quando a
 * lista veio cortada no limite, diz quantas entram agora e quantas ficam para
 * "Aplicar regras".
 */
export function ruleOfferDescription(offer: RuleOffer): string {
  const future = `Os próximos lançamentos com “${offer.pattern}” na descrição vão para ${offer.categoryName} sozinhos.`;
  if (offer.matchingIds.length === 0) return future;
  const now = `${future} Agora, também ${count(offer.matchingIds.length, 'lançamento sem categoria vai', 'lançamentos sem categoria vão')} para ${offer.categoryName}.`;
  const rest = offer.total - offer.matchingIds.length;
  if (rest <= 0) return now;
  return `${now} ${count(rest, 'outro fica', 'outros ficam')} para “Aplicar regras aos não categorizados”.`;
}

/** Frase depois do aceite. */
export function ruleOfferAcceptedMessage(result: RuleOfferAccepted): string {
  const parts = ['Regra criada'];
  if (result.applied > 0) parts.push(`${count(result.applied, 'lançamento categorizado', 'lançamentos categorizados')} por ela`);
  if (result.propagated > 0) {
    parts.push(`${count(result.propagated, 'parcela sem categoria acompanhou', 'parcelas sem categoria acompanharam')} o parcelamento`);
  }
  if (result.skipped > 0) parts.push(`${count(result.skipped, 'pulado porque mudou', 'pulados porque mudaram')} desde a oferta`);
  return `${parts.join('; ')}.`;
}
