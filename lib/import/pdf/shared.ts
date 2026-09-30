/**
 * Utilidades comuns aos tres parsers de PDF — T-117/b/c.
 *
 * Existem para nao repetir, em tres arquivos, a mesma decisao de formato — que e
 * exatamente como os defeitos do gate T-116 nasceram em triplicata.
 *
 * ## 1. Traços que um PDF emite no lugar do sinal de menos
 *
 * O conjunto de traços **nao e definido aqui**: e `MINUS_DASH_CODE_POINTS` de
 * `lib/money`, a lista unica do sistema (U+002D, U+2010, U+2011, U+2013, U+2212,
 * U+FF0D). U+2012 e U+2014 ficam de fora por arbitragem registrada em
 * `parseBRL`: nenhuma fatura medida os usa como sinal e o travessao e pontuacao
 * de prosa — aceita-lo trocaria falso negativo por falso positivo, e falso
 * positivo em dinheiro e pior.
 *
 * Montar a classe daqui, a partir de `MINUS_DASH_CLASS`, e o que impede as duas
 * listas de divergirem: acrescentar um traco e mudar `lib/money` e mais nada.
 *
 * ## 2. Ano de uma data `dd/MM` sem ano (virada de ano)
 *
 * Uma data sem ano nao pode cair DEPOIS da data de referencia da fatura: quando
 * cai, e do ano anterior. Medido no Mercado Pago: a fatura de julho/2026 traz a
 * linha `24/11 ... Parcela 8 de 12`; 24/11 > 20/07 (vencimento), entao a compra
 * e de 2025-11-24, nao 2026-11-24. Sem isso, uma unica linha joga a fatura
 * inteira para a competencia errada.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`.
 */

import { MINUS_DASH_CLASS } from '@/lib/money';

/**
 * Token monetario comum: valor com `R$` ou numero decimal pt-BR, com traco de
 * menos opcional no inicio. A classe do traco vem de `lib/money` — o token so
 * precisa dela para CAPTURAR o sinal; a normalizacao e do proprio `parseBRL`.
 * Global para `matchAll` (que clona o regex e nao muta o `lastIndex` do modulo).
 */
export const PDF_MONEY_TOKEN = new RegExp(
  `[${MINUS_DASH_CLASS}]?\\s*R\\$\\s*\\d[\\d.,]*|[${MINUS_DASH_CLASS}]?\\d{1,3}(?:\\.\\d{3})*,\\d{2}`,
  'g',
);

/** Data completa impressa no cabecalho, usada como referencia da fatura. */
export interface ReferenceDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Reconhece a descricao de um **pagamento da fatura anterior** (RF-CC-04).
 *
 * Essa linha nao e despesa nem receita do cartao: e um `credit_card_payment`
 * registrado na CONTA bancaria, e importa-la pelo cartao conta duas vezes quando
 * o extrato da conta entrar. Medido no Nubank: `Pagamento em 07 ago`.
 *
 * Ancorado no **inicio** da descricao, de proposito: usar `pagamento` em
 * qualquer posicao pescaria um estabelecimento com "pagamento" no nome. O
 * `shared` centraliza a regra para os tres parsers nao divergirem — a licao do
 * `moneyToken` em triplicata.
 */
const CREDIT_CARD_PAYMENT_PATTERN = /^\s*pagamento\b/i;

/** `true` quando a descricao parece o pagamento da fatura anterior. */
export function isCreditCardPaymentDescription(description: string): boolean {
  return CREDIT_CARD_PAYMENT_PATTERN.test(description);
}

/**
 * Ano de uma data `dd/MM` sem ano, pela data de referencia da fatura.
 *
 * A referencia e a data impressa no proprio documento (vencimento/fatura). Se a
 * data da transacao cai **estritamente depois** dela, e do ano anterior. Sem
 * referencia (o documento nao traz data completa), usa o ano do chamador como
 * esta — sem inventar virada.
 */
export function yearForDateWithoutYear(input: {
  month: number;
  day: number;
  reference: ReferenceDate | null;
  fallbackYear: number | null;
}): number | null {
  const { month, day, reference, fallbackYear } = input;
  if (reference === null) return fallbackYear;

  const afterReference =
    month > reference.month ||
    (month === reference.month && day > reference.day);

  return afterReference ? reference.year - 1 : reference.year;
}
