/**
 * Fixture sintetica da fatura Mercado Pago — T-117c.
 *
 * Reproduz a **geometria medida** em `docs/IMPORT-SOURCES.md` §7 (data em
 * `x=40`, descricao em `x=94`, parcela em coluna propria em `x≈395`, valor
 * alinhado a direita em `x≈507–518`, cabecalho do ano em `y=776`) e as tres
 * armadilhas do layout: secoes por cartao, parcela em coluna separada e linha de
 * subtotal com a palavra `Total` na posicao da data.
 *
 * Nenhum byte ou valor vem de fatura real (CONVENTIONS §9, RNF-01): a fatura da
 * familia carrega nome completo, digito de cartao e endereco, e nao pode passar
 * por agente em provedor de terceiro. Tudo aqui e inventado — estabelecimentos,
 * numeros de cartao e valores.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`.
 */

import type { PdfTextRow } from '@/lib/import/pdf/rows';

/** Colunas medidas (§7). */
export const DATE_X = 40;
export const DESC_X = 94;
export const INSTALLMENT_X = 395;
export const VALUE_RIGHT = 518;
export const HEADER_Y = 776;
export const FOOTER_Y = 25;

/** Run posicionado, como `groupIntoRows` o entrega ao parser. */
export interface Run {
  x: number;
  y: number;
  text: string;
}

/** Valor alinhado a direita: texto maior comeca mais a esquerda (§7). */
export function valueX(text: string): number {
  return VALUE_RIGHT - Math.max(0, text.length - 8) * 4;
}

/** Uma `PdfTextRow` montada a mao, para teste unitario do mapeamento. */
export function makeRow(y: number, runs: Run[], page = 1): PdfTextRow {
  return {
    page,
    y,
    cells: runs.map((run) => ({ x: run.x, text: run.text })),
    text: runs
      .map((run) => run.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

/** Descricao de uma transacao sintetica. */
export interface TransactionShape {
  date: string;
  description: string;
  value: string;
  /** Texto da coluna de parcela (`Parcela 1 de 12`), quando houver. */
  installment?: string;
}

/** Runs de uma transacao completa, nas colunas medidas. */
export function transactionRuns(y: number, tx: TransactionShape): Run[] {
  const runs: Run[] = [
    { x: DATE_X, y, text: tx.date },
    { x: DESC_X, y, text: tx.description },
  ];
  if (tx.installment !== undefined) {
    runs.push({ x: INSTALLMENT_X, y, text: tx.installment });
  }
  runs.push({ x: valueX(tx.value), y, text: tx.value });
  return runs;
}

export function transactionRow(y: number, tx: TransactionShape, page = 1): PdfTextRow {
  return makeRow(y, transactionRuns(y, tx), page);
}

/** Cabecalho de secao de cartao, na posicao da data (§7, armadilha 2). */
export function cardHeaderRow(y: number, digits: string, page = 1): PdfTextRow {
  return makeRow(y, [{ x: DATE_X, y, text: `Cartão final [****************${digits}]` }], page);
}

/** Subtotal: palavra `Total` na posicao da data e valor a direita (§7, armadilha 3). */
export function totalRow(y: number, value: string, page = 1): PdfTextRow {
  return makeRow(
    y,
    [
      { x: DATE_X, y, text: 'Total' },
      { x: valueX(value), y, text: value },
    ],
    page,
  );
}

/** Cabecalho do ano, `Vencimento: dd/MM/yyyy`, medido em `y=776`. */
export function headerRow(y = HEADER_Y): PdfTextRow {
  return makeRow(y, [{ x: DATE_X, y, text: 'Vencimento: 20/07/2026' }]);
}

/** Numero de pagina no rodape (abaixo da area de transacao). */
export function pageNumberRow(page: number, total: number): PdfTextRow {
  return makeRow(FOOTER_Y, [{ x: 290, y: FOOTER_Y, text: `${String(page)} de ${String(total)}` }], page);
}

/**
 * Fatura sintetica com **dois cartoes**, em duas paginas, com um subtotal por
 * cartao. Alimenta o teste de ponta a ponta `extract -> groupIntoRows ->
 * parseMercadoPagoPdf`.
 *
 * Nao ha linha de continuacao: o layout do Mercado Pago nao tem esse recurso
 * (toda linha de lancamento tem data em `x=40`); continuacao e caracteristica do
 * Nubank (`IMPORT-SOURCES.md` §6.1). Reproduzir aqui o que o banco nao tem seria
 * suposicao disfarcada de medicao.
 */
export function statementPages(): Run[][] {
  const pageOne: Run[] = [
    { x: DATE_X, y: HEADER_Y, text: 'Vencimento: 20/07/2026' },
    { x: DATE_X, y: 700, text: 'Cartão final [****************1111]' },
    ...transactionRuns(680, {
      date: '05/07',
      description: 'PADARIA SINTETICA',
      value: 'R$ 20,00',
      installment: 'Parcela 1 de 12',
    }),
    ...transactionRuns(660, {
      date: '10/07',
      description: 'MERCADO SINTETICO',
      value: 'R$ 150,00',
    }),
    { x: DATE_X, y: 620, text: 'Total' },
    { x: valueX('R$ 170,00'), y: 620, text: 'R$ 170,00' },
    { x: 290, y: FOOTER_Y, text: '1 de 2' },
  ];
  const pageTwo: Run[] = [
    { x: DATE_X, y: HEADER_Y, text: 'Vencimento: 20/07/2026' },
    { x: DATE_X, y: 700, text: 'Cartão final [****************2222]' },
    ...transactionRuns(680, {
      date: '12/07',
      description: 'FARMACIA SINTETICA',
      value: 'R$ 35,50',
      installment: 'Parcela 3 de 6',
    }),
    { x: DATE_X, y: 640, text: 'Total' },
    { x: valueX('R$ 35,50'), y: 640, text: 'R$ 35,50' },
    { x: 290, y: FOOTER_Y, text: '2 de 2' },
  ];
  return [pageOne, pageTwo];
}
