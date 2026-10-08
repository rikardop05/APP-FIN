/**
 * "Finais e responsáveis" do cartão (decisão 20, opcional): mapeia o FINAL do cartão (4 dígitos) a um
 * membro da casa. Funções puras da tela, fora do .tsx porque o vitest não transforma JSX.
 *
 * Só se guardam os 4 últimos dígitos: um número de cartão inteiro colado no campo é RECUSADO, nunca
 * truncado nem gravado.
 */

export const HOLDERS_NOTE =
  'Opcional. Hoje só o Mercado Pago imprime o final do cartão na fatura; nos outros bancos este mapeamento ainda não é usado na importação.';

export type HolderRecord = { id: string; last4: string; memberId: string };
export type MemberOption = { id: string; name: string };

/** Os 4 dígitos, ou `null`. Aceita máscara, espaços e asteriscos ao redor ("•••• 1234"); nada além. */
export function normalizeLast4(text: string): string | null {
  const stripped = text.replace(/[\s•*]/g, '');
  return /^\d{4}$/.test(stripped) ? stripped : null;
}

export type HolderFormValues = { last4: string; memberId: string };
export type HolderFormErrors = Partial<Record<keyof HolderFormValues, string>>;

export function buildHolderBody(
  values: HolderFormValues,
  members: readonly MemberOption[],
): { ok: true; body: { last4: string; memberId: string } } | { ok: false; errors: HolderFormErrors } {
  const errors: HolderFormErrors = {};
  const last4 = normalizeLast4(values.last4);
  if (last4 === null) errors.last4 = 'Informe os 4 últimos dígitos do cartão (só números).';
  if (!members.some((member) => member.id === values.memberId)) errors.memberId = 'Escolha o responsável.';
  if (Object.keys(errors).length > 0 || last4 === null) return { ok: false, errors };
  return { ok: true, body: { last4, memberId: values.memberId } };
}

export type HolderRow = { id: string; last4: string; display: string; memberName: string | null };

/** Linhas da lista, por final. Responsável que sumiu da casa fica sem nome (a tela mostra "—"), sem quebrar. */
export function holderRows(holders: readonly HolderRecord[], members: readonly MemberOption[]): HolderRow[] {
  const names = new Map(members.map((member) => [member.id, member.name]));
  return [...holders]
    .sort((a, b) => (a.last4 < b.last4 ? -1 : a.last4 > b.last4 ? 1 : 0))
    .map((holder) => ({
      id: holder.id,
      last4: holder.last4,
      display: `•••• ${holder.last4}`,
      memberName: names.get(holder.memberId) ?? null,
    }));
}

/** O mesmo final já existe? Salvar de novo TROCA o responsável (upsert); a tela avisa antes. */
export function holderSubmitHint(
  holders: readonly HolderRecord[],
  typedLast4: string,
  members: readonly MemberOption[],
): string | null {
  const last4 = normalizeLast4(typedLast4);
  if (last4 === null) return null;
  const existing = holders.find((holder) => holder.last4 === last4);
  if (existing === undefined) return null;
  const name = members.find((member) => member.id === existing.memberId)?.name;
  return name === undefined
    ? `O final ${last4} já está mapeado: salvar troca o responsável.`
    : `O final ${last4} já está mapeado para ${name}: salvar troca o responsável.`;
}

export type HolderEvent = 'created' | 'replaced' | 'deleted';

export function holderConfirmation(event: HolderEvent): string {
  switch (event) {
    case 'created':
      return 'Final adicionado.';
    case 'replaced':
      return 'O final já estava mapeado: o responsável foi trocado.';
    case 'deleted':
      return 'Final removido.';
  }
}

export function deleteHolderQuestion(row: HolderRow): string {
  return row.memberName === null
    ? `Remover o final ${row.last4}?`
    : `Remover o final ${row.last4} (${row.memberName})?`;
}
