import { toCompetence } from '@/lib/date';

/**
 * Situacao de pagamento do lancamento de cartao (fatura paga / em parte / em aberto / vencida / a
 * vencer). A tela so le o que a query entrega (`statementStatus`, `statementPayment`, vencimento);
 * nada aqui soma dinheiro.
 */

export type PaymentRowLike = {
  creditCardId: string | null;
  competence: string;
  status: string;
  statementStatus: 'open' | 'closed' | 'paid' | null;
  statementDueDate: string | null;
  statementPayment: 'none' | 'full' | 'partial' | 'over' | null;
};

export type PaymentSituation = {
  label: string;
  tone: 'neutral' | 'attention' | 'ok' | 'danger';
  /** Letra do quadradinho do selo (o texto por extenso e a leitura principal). */
  letter: string;
};

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-11` -> `nov/2026`. */
function monthYear(competence: string): string {
  const [year, month] = competence.split('-');
  return `${MONTHS_SHORT[Number(month) - 1] ?? month}/${year}`;
}

/**
 * Situacao da fatura do lancamento de cartao, para o selo da linha. `today` e `YYYY-MM-DD`.
 * Conta (sem cartao) nao tem selo. Sem fatura gravada: a parcela futura mostra "A vencer em <mes>" e a
 * compra lancada de mes passado mostra "Sem fatura importada" (segue em Pendentes).
 */
export function paymentSituation(row: PaymentRowLike, today: string): PaymentSituation | null {
  if (row.creditCardId === null) return null;
  if (row.statementStatus === null) {
    if (row.competence >= toCompetence(today)) {
      return { label: `A vencer em ${monthYear(row.competence)}`, tone: 'neutral', letter: 'T' };
    }
    // Compra lancada de mes que ja passou e sem fatura gravada: o app nao sabe se foi paga.
    return row.status === 'posted' ? { label: 'Sem fatura importada', tone: 'attention', letter: 'S' } : null;
  }
  if (row.statementStatus === 'paid') {
    return row.statementPayment === 'partial'
      ? { label: 'Fatura paga em parte', tone: 'attention', letter: 'J' }
      : { label: 'Fatura paga', tone: 'ok', letter: 'Z' };
  }
  return row.statementDueDate !== null && row.statementDueDate < today
    ? { label: 'Fatura vencida', tone: 'danger', letter: 'V' }
    : { label: 'Fatura em aberto', tone: 'neutral', letter: 'R' };
}

export type SettlementFilter = '' | 'paid' | 'pending';

/**
 * Pago ou pendente, para o filtro "Situacao". Pago: lancamento de conta ja lancado, ou de cartao com a
 * fatura paga por inteiro. Pendente: previsto, fatura em aberto, vencida ou paga so em parte, e parcela
 * ainda sem fatura. (Decisao de produto a confirmar: fatura paga em parte conta como pendente.)
 */
export function isSettled(row: PaymentRowLike): boolean {
  if (row.status === 'planned') return false;
  if (row.creditCardId === null) return true;
  return row.statementStatus === 'paid' && row.statementPayment !== 'partial';
}

export function matchesSettlement(row: PaymentRowLike, filter: SettlementFilter): boolean {
  if (filter === '') return true;
  return filter === 'paid' ? isSettled(row) : !isSettled(row);
}

/**
 * Seleciona so o que esta VISIVEL: tira da selecao os ids que nao estao nas linhas mostradas (filtro
 * Situacao ou qualquer outro), para nunca aplicar lote em linha escondida.
 */
export function pruneSelection(selectedIds: readonly string[], visibleRows: readonly { id: string }[]): string[] {
  const visible = new Set(visibleRows.map((row) => row.id));
  const kept = selectedIds.filter((id) => visible.has(id));
  return kept.length === selectedIds.length ? [...selectedIds] : kept;
}
