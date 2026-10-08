import type { RuleApplicationResult } from './schemas';

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}

/**
 * Frase do resultado de "aplicar regras". A tela so formata o que o servidor
 * contou: aplicados, parcelas que seguiram o parcelamento e itens pulados
 * porque mudaram entre a previa e o gravar.
 */
export function applyResultMessage(result: RuleApplicationResult): string {
  if (result.applied === 0) {
    return result.skipped === 0
      ? 'Nenhum lançamento foi categorizado.'
      : `Nenhum lançamento foi categorizado: ${count(result.skipped, 'item mudou', 'itens mudaram')} desde a prévia.`;
  }
  const parts = [`${count(result.applied, 'lançamento categorizado', 'lançamentos categorizados')} pelas regras`];
  if (result.propagated > 0) {
    parts.push(`${count(result.propagated, 'parcela sem categoria acompanhou', 'parcelas sem categoria acompanharam')} o parcelamento`);
  }
  if (result.skipped > 0) {
    parts.push(`${count(result.skipped, 'item pulado porque mudou', 'itens pulados porque mudaram')} desde a prévia`);
  }
  return `${parts.join('; ')}.`;
}

/** Itens a gravar: as propostas que o usuario deixou marcadas, na ordem da previa. */
export function confirmedItems(
  proposals: readonly { transactionId: string; ruleId: string; categoryId: string }[],
  unchecked: ReadonlySet<string>,
): { transactionId: string; ruleId: string; categoryId: string }[] {
  return proposals
    .filter((proposal) => !unchecked.has(proposal.transactionId))
    .map(({ transactionId, ruleId, categoryId }) => ({ transactionId, ruleId, categoryId }));
}

/**
 * Aviso quando a previa veio cortada no limite: o resto entra numa proxima
 * rodada. `null` quando a previa trouxe tudo.
 */
export function previewLimitNotice(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Mostrando ${String(shown)} de ${String(total)} lançamentos. Aplique estes e abra a prévia de novo para ver o restante.`;
}
