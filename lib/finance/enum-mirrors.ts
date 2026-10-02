/**
 * Espelho de enums do banco — a UNICA fonte dos literais na camada pura.
 *
 * CONVENTIONS §5: `/lib/finance` nao pode importar `/lib/db`, entao os enums do
 * banco sao REDIGITADOS aqui. Este arquivo existe para que exista exatamente UMA
 * copia desses literais na camada pura: antes, `kpis.ts` e `commitment.ts` tinham
 * cada um a sua, e duas copias do mesmo enum podem divergir entre si sem que
 * nada acuse.
 *
 * O par de cada `const` e o `pgEnum` correspondente em `lib/db/enums.ts`, que e a
 * fonte de verdade. `tests/enums-espelho.test.ts` compara os dois lados e quebra
 * se divergirem — ele importa DESTES arrays (nao de uma copia propria), entao
 * mudar um literal aqui e o caminho que o teste enxerga.
 *
 * Regra de acrescimo: um valor novo entra no `pgEnum` do banco E aqui, no mesmo
 * lugar do array, com o comentario dizendo por que. O teste acusa a divergencia
 * nos dois sentidos.
 */

/** Espelho de `transaction_kind` (lib/db/enums.ts). */
export const TRANSACTION_KINDS = [
  'expense',
  'income',
  'transfer',
  'credit_card_payment',
  'investment_contribution',
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Espelho de `category_nature` (lib/db/enums.ts). */
export const CATEGORY_NATURES = [
  'essential',
  'non_essential',
  'investment',
  'income',
] as const;

export type CategoryNature = (typeof CATEGORY_NATURES)[number];

/** Espelho de `transaction_status` (lib/db/enums.ts). */
export const TRANSACTION_STATUSES = [
  'posted',
  'planned',
  // Decisao nº 7 (Ricardo, 2026-10-02, `.notas/decisao-7-reconciled.md`): uma
  // previsao (`planned`) cumprida por um lancamento real passa a `reconciled` e
  // deixa de ser vista por quem procura previsoes. Certo por omissao: quem
  // esquecer de filtrar nao conta a despesa duas vezes. O par com o lancamento
  // real fica em `transactions.reconciled_by_transaction_id`.
  'reconciled',
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
