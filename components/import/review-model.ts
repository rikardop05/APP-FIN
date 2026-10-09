import { addCents, cents, type Cents } from '@/lib/money';
import type { PlacarTone, SeloTone } from '@/components/ui-kit/carne';
import { placarTone } from '@/components/ui-kit/carne';

/**
 * Lógica pura da revisão da fatura (tela Importar), fora do .tsx porque o vitest não transforma JSX.
 * A tela só escolhe o que desenhar; o que é "linha sinalizada", para onde vai o J/K, por que o botão
 * Confirmar está desabilitado e como o placar confere o lote sai daqui.
 */

export type RowState =
  | 'new'
  | 'duplicate'
  | 'installment_first'
  | 'installment_part'
  | 'credit_card_payment'
  | 'informational';

export type RowFlag = 'invalid' | 'low_confidence' | 'duplicate' | 'payment' | 'informational';

export type FlagInput = {
  state: RowState;
  lowConfidence: boolean;
  /** Incluída e com campo faltando ou inválido: bloqueia a confirmação. */
  invalid: boolean;
};

/** Sinais da linha, do mais grave ao menos grave. Vazio = linha sem nada a conferir. */
export function rowFlags(row: FlagInput): RowFlag[] {
  const flags: RowFlag[] = [];
  if (row.invalid) flags.push('invalid');
  if (row.lowConfidence) flags.push('low_confidence');
  if (row.state === 'duplicate') flags.push('duplicate');
  if (row.state === 'credit_card_payment') flags.push('payment');
  if (row.state === 'informational') flags.push('informational');
  return flags;
}

/** Selo de cada sinal: texto por extenso, letra e tom. Só `invalid` usa o vermelho de carimbo. */
export const FLAG_SELO: Record<RowFlag, { label: string; letter: string; tone: SeloTone }> = {
  invalid: { label: 'Incompleta', letter: 'I', tone: 'danger' },
  low_confidence: { label: 'Baixa confiança', letter: 'B', tone: 'attention' },
  duplicate: { label: 'Duplicada', letter: 'D', tone: 'attention' },
  payment: { label: 'Pagamento', letter: 'P', tone: 'attention' },
  informational: { label: 'Informativa', letter: 'N', tone: 'attention' },
};

/** `index` das linhas que precisam de atenção, na ordem da lista. */
export function flaggedIndexes<T extends FlagInput & { index: number }>(rows: readonly T[]): number[] {
  return rows.filter((row) => rowFlags(row).length > 0).map((row) => row.index);
}

/**
 * J (direction 1) e K (direction -1): a próxima linha sinalizada a partir da atual, dando a volta.
 * Sem linha atual, J vai à primeira e K à última. Sem sinalizadas: `null`.
 */
export function stepFlagged(flagged: readonly number[], current: number | null, direction: 1 | -1): number | null {
  if (flagged.length === 0) return null;
  if (current === null) return direction === 1 ? (flagged[0] ?? null) : (flagged[flagged.length - 1] ?? null);
  if (direction === 1) return flagged.find((index) => index > current) ?? flagged[0] ?? null;
  const before = flagged.filter((index) => index < current);
  return before[before.length - 1] ?? flagged[flagged.length - 1] ?? null;
}

/** Primeira linha inválida (a que o botão desabilitado leva), ou `null`. */
export function firstInvalidIndex(rows: readonly { index: number; invalid: boolean }[]): number | null {
  return rows.find((row) => row.invalid)?.index ?? null;
}

/** Por que o Confirmar está desabilitado, em português. `null` = pode confirmar. */
export function confirmBlockReason(input: {
  busy: boolean;
  recalculating: boolean;
  invalidCount: number;
  includedCount: number;
}): string | null {
  if (input.busy) return 'Gravando a importação…';
  if (input.invalidCount > 0) {
    return input.invalidCount === 1
      ? '1 linha incluída está incompleta. Complete ou desmarque para confirmar.'
      : `${input.invalidCount} linhas incluídas estão incompletas. Complete ou desmarque para confirmar.`;
  }
  if (input.includedCount === 0) return 'Nenhuma linha incluída. Marque ao menos uma para confirmar.';
  if (input.recalculating) return 'Recalculando o total do lote…';
  return null;
}

/** Rótulo acessível com o contexto da linha: "Categoria da linha 5, PADARIA X". */
export function rowFieldLabel(field: string, rowNumber: number, description: string): string {
  const name = description.trim();
  return name === '' ? `${field} da linha ${rowNumber}` : `${field} da linha ${rowNumber}, ${name}`;
}

export type PlacarFigures = {
  /** Total impresso na fatura, em módulo; `null` quando o documento não o traz. */
  reportedCents: Cents | null;
  /** Soma das linhas incluídas, em módulo. */
  includedCents: Cents;
  /** incluído − impresso, com sinal do sistema (despesa negativa). `null` sem total impresso. */
  differenceCents: Cents | null;
  tone: PlacarTone;
};

/**
 * Confere o lote com o total impresso. Os dois valores têm o sinal do sistema (despesa negativa) e a
 * diferença é incluído − impresso, a mesma conta de `finalizeImport`: zera = confere.
 */
export function placarFigures(input: { reportedTotalCents: Cents | null; totalCents: Cents }): PlacarFigures {
  const difference =
    input.reportedTotalCents === null ? null : addCents(input.totalCents, cents(-input.reportedTotalCents));
  return {
    reportedCents: input.reportedTotalCents === null ? null : cents(Math.abs(input.reportedTotalCents)),
    includedCents: cents(Math.abs(input.totalCents)),
    differenceCents: difference,
    tone: placarTone(difference),
  };
}

type BulkRow = { index: number; suggestedCategoryId: string | null; suggestedMemberId: string | null };

/**
 * Edição em lote: aplica categoria e/ou responsável às linhas selecionadas. `undefined` = não mexe
 * (diferente de `null`, que é "sem categoria" / "família").
 */
export function applyBulk<T extends BulkRow>(
  rows: readonly T[],
  selected: ReadonlySet<number>,
  change: { categoryId?: string | null; memberId?: string | null },
): T[] {
  return rows.map((row) => {
    if (!selected.has(row.index)) return row;
    return {
      ...row,
      ...(change.categoryId !== undefined ? { suggestedCategoryId: change.categoryId } : {}),
      ...(change.memberId !== undefined ? { suggestedMemberId: change.memberId } : {}),
    };
  });
}

const BANK_LABEL: Record<string, string> = {
  nubank_card: 'Nubank',
  santander_card: 'Santander',
  mercadopago_card: 'Mercado Pago',
  nubank: 'Nubank',
  santander: 'Santander',
  mercadopago: 'Mercado Pago',
};

/** Nome do emissor a partir do `bankKey` do detector; desconhecido vira texto neutro. */
export function bankLabel(bankKey: string | null): string {
  if (bankKey === null) return 'Emissor não identificado';
  const fallback = bankKey.replace(/_card$/, '').replace(/_/g, ' ');
  return BANK_LABEL[bankKey] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

export type AnnounceState = {
  invalidCount: number;
  /** Tom da diferença do placar. */
  tone: PlacarTone;
  /** Diferença em centavos, só para o texto quando diverge. */
  differenceCents: Cents | null;
  committed: boolean;
};

const QUIET: AnnounceState = { invalidCount: 0, tone: 'neutral', differenceCents: null, committed: false };

/**
 * O que o leitor de tela deve anunciar ao passar de `prev` para `next`. Só mudanças relevantes:
 * o lote foi confirmado, o placar mudou de estado (confere, diverge) ou a primeira linha ficou
 * inválida / a última deixou de ser. Editar sem mudar de estado não anuncia nada (`null`).
 */
export function announcementFor(prev: AnnounceState | null, next: AnnounceState): string | null {
  const before = prev ?? QUIET;
  if (next.committed && !before.committed) return 'Lote confirmado.';
  if (next.committed) return null;
  if (next.invalidCount > 0 && before.invalidCount === 0) {
    return next.invalidCount === 1
      ? '1 linha incluída está incompleta.'
      : `${next.invalidCount} linhas incluídas estão incompletas.`;
  }
  if (next.invalidCount === 0 && before.invalidCount > 0) return 'Nenhuma linha incompleta.';
  if (next.tone !== before.tone) {
    if (next.tone === 'ok') return 'O lote confere com o total da fatura.';
    if (next.tone === 'danger') return 'O lote diverge do total da fatura.';
  }
  return null;
}

/** Mensagem de sucesso da importação, com o que foi conciliado com previsões e planos existentes. */
export function successMessage(
  reconciled: { plannedReconciled: number; installmentsReconciled: number },
): string {
  const parts: string[] = [];
  if (reconciled.plannedReconciled > 0) {
    parts.push(
      reconciled.plannedReconciled === 1 ? '1 previsão cumprida' : `${reconciled.plannedReconciled} previsões cumpridas`,
    );
  }
  if (reconciled.installmentsReconciled > 0) {
    parts.push(
      reconciled.installmentsReconciled === 1
        ? '1 parcela conciliada com plano existente'
        : `${reconciled.installmentsReconciled} parcelas conciliadas com planos existentes`,
    );
  }
  const tail = parts.length === 0 ? '' : ` ${parts.join(' e ')}.`;
  return `Importação confirmada. Os canhotos foram destacados.${tail}`;
}
