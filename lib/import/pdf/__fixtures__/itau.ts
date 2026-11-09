/** Fixture inteiramente sintética de fatura Itaú; nomes e valores são inventados. */

import type { PdfTextRow } from '@/lib/import/pdf/rows';

export function makeItauRow(
  y: number,
  cells: readonly { x: number; text: string }[],
  page = 1,
): PdfTextRow {
  return {
    page,
    y,
    cells: cells.map((cell) => ({ ...cell })),
    text: cells.map((cell) => cell.text).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

export function itauHeaderRow(): PdfTextRow {
  return makeItauRow(671, [{ x: 245, text: 'Vencimento: 15/11/2026' }]);
}

export function itauTotalRows(total = 'R$ 87,70'): PdfTextRow[] {
  return [
    makeItauRow(594, [{ x: 70, text: 'O total da sua fatura é:' }]),
    makeItauRow(578, [{ x: 70, text: total }]),
  ];
}

export function itauTransactionRow(
  y: number,
  date: string,
  description: string,
  value: string,
  page = 2,
): PdfTextRow {
  return makeItauRow(
    y,
    [
      { x: 151, text: date },
      { x: 178, text: description },
      { x: 323, text: value },
    ],
    page,
  );
}

export function itauTransactionHeader(y = 648): PdfTextRow {
  return makeItauRow(y, [{ x: 151, text: 'Data' }], 2);
}

export function itauFutureInstallmentsHeader(y = 516): PdfTextRow {
  return makeItauRow(y, [{ x: 151, text: 'Compras parceladas - próximas faturas' }], 2);
}

export function itauSubtotalRow(y: number, amount: string): PdfTextRow {
  return makeItauRow(
    y,
    [
      { x: 151, text: 'Total dos lançamentos atuais' },
      { x: 321, text: amount },
      { x: 367, text: 'Encargos desta fatura' },
      { x: 532, text: 'R$ 0,00' },
    ],
    2,
  );
}
