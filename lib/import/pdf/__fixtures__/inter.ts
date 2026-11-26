/**
 * Fixture inteiramente sintética de fatura Inter. A geometria (x, y, páginas de
 * 446×632pt) é a MEDIDA em fatura real (IMPORT-SOURCES §10); nomes, finais de
 * cartão, estabelecimentos e valores são inventados.
 */

import type { PdfTextRow } from '@/lib/import/pdf/rows';

export function makeInterRow(
  y: number,
  cells: readonly { x: number; text: string }[],
  page = 3,
): PdfTextRow {
  return {
    page,
    y,
    cells: cells.map((cell) => ({ ...cell })),
    text: cells.map((cell) => cell.text).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

/** Página 1: `Total da sua fatura`, o valor duas linhas abaixo e o limite à direita. */
export function interSummaryRows(total = '331,03', due = '20/11/2026'): PdfTextRow[] {
  return [
    makeInterRow(493, [{ x: 329, text: 'Limite de crédito total' }], 1),
    makeInterRow(486, [{ x: 52, text: 'Total da sua fatura' }], 1),
    makeInterRow(482, [{ x: 329, text: 'R$' }, { x: 341, text: '3.637,00' }], 1),
    makeInterRow(
      464,
      [
        { x: 52, text: 'R$' },
        { x: 81, text: total },
        { x: 329, text: 'Data de Vencimento' },
      ],
      1,
    ),
    makeInterRow(
      450,
      [
        { x: 52, text: 'Este é o valor que você precisa pagar nesse mês' },
        { x: 329, text: due },
      ],
      1,
    ),
  ];
}

/** Topo da página de lançamentos: `Fatura atual R$ …` (y=621). */
export function interCurrentStatementRow(total = '331,03'): PdfTextRow {
  return makeInterRow(621, [
    { x: 30, text: 'Fatura atual' },
    { x: 388, text: 'R$' },
    { x: 397, text: total },
  ]);
}

/** Cabeçalho repetido nas páginas 2+: titular, cartão, vencimento e total (y≥597). */
export function interPageHeaderRows(page = 3): PdfTextRow[] {
  return [
    makeInterRow(606, [{ x: 225, text: 'TITULAR SINTETICO DA SILVA' }], page),
    makeInterRow(
      597,
      [
        { x: 256, text: '0000****1111' },
        { x: 328, text: '20/11/2026' },
        { x: 387, text: 'R$' },
        { x: 398, text: '331, 03' },
      ],
      page,
    ),
  ];
}

export function interCardSection(y: number, masked: string, page = 3): PdfTextRow {
  return makeInterRow(y, [{ x: 24, text: 'CARTÃO' }, { x: 55, text: masked }], page);
}

export function interTableHeader(y: number, page = 3): PdfTextRow {
  return makeInterRow(
    y,
    [
      { x: 24, text: 'Data' },
      { x: 75, text: 'Movimentação' },
      { x: 282, text: 'Beneficiário' },
      { x: 404, text: 'Valor' },
    ],
    page,
  );
}

/**
 * Lançamento: data (x=24), descrição (x=77), beneficiário (x=300) e valor à
 * direita. `description` aceita dois runs para reproduzir a quebra de kerning
 * medida (`P` + `AGAMENTO DE FATURA`).
 */
export function interTransactionRow(
  y: number,
  date: string,
  description: string | readonly { x: number; text: string }[],
  value: string,
  opts?: { beneficiary?: string; page?: number },
): PdfTextRow {
  const descriptionCells =
    typeof description === 'string' ? [{ x: 77, text: description }] : description;
  return makeInterRow(
    y,
    [
      { x: 24, text: date },
      ...descriptionCells,
      { x: 300, text: opts?.beneficiary ?? '-' },
      { x: 394, text: value },
    ],
    opts?.page ?? 3,
  );
}

export function interCardTotal(y: number, masked: string, amount: string, page = 3): PdfTextRow {
  return makeInterRow(
    y,
    [
      { x: 24, text: 'Total CARTÃO' },
      { x: 61, text: masked },
      { x: 394, text: 'R$' },
      { x: 403, text: amount },
    ],
    page,
  );
}

/** Página 4: parcelas futuras, `Movimentação | Valor`, sem coluna de data. */
export function interNextStatementRows(): PdfTextRow[] {
  return [
    makeInterRow(550, [{ x: 237, text: 'Próxima fatura' }], 4),
    makeInterRow(468, [{ x: 243, text: 'Movimentação' }, { x: 405, text: 'Valor' }], 4),
    makeInterRow(
      451,
      [
        { x: 243, text: 'LOJA FUTURA' },
        { x: 283, text: '(Parcela 03 de 06)' },
        { x: 396, text: 'R$' },
        { x: 405, text: '26,64' },
      ],
      4,
    ),
    makeInterRow(
      396,
      [{ x: 243, text: 'Saldo total de compras parceladas' }, { x: 394, text: 'R$' }, { x: 403, text: '330,16' }],
      4,
    ),
  ];
}
