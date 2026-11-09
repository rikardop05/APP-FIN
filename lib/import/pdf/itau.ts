/** Parser da fatura de cartão Itaú em PDF — CONTRACTS §15, T-ITAU. */

import { clampDayToMonth, type IsoDate } from '@/lib/date';
import { detectInstallment } from '@/lib/import/installments';
import type {
  DocumentDate,
  ParsedRow,
  ParseDiagnostic,
  ParseResult,
} from '@/lib/import/types';
import type { PdfTextRow } from '@/lib/import/pdf/rows';
import { MINUS_DASH_CLASS, cents, parseBRL, type Cents } from '@/lib/money';
import {
  PDF_MONEY_TOKEN,
  isCreditCardPaymentDescription,
  isInformationalAmount,
  yearForDateWithoutYear,
  type ReferenceDate,
} from '@/lib/import/pdf/shared';

export interface ItauPdfParseOptions {
  defaultYear?: number;
}

/** Faixas medidas na fatura real; os lançamentos ficam na tabela esquerda. */
export const ITAU_LAYOUT = {
  measuredOn: '2026-11-09',
  transaction: {
    date: { minX: 135, maxX: 175 },
    description: { minX: 175, maxX: 295 },
    value: { minX: 295, maxX: 360 },
  },
  totalLabel: 'o total da sua fatura é',
  futureInstallmentsLabel: 'compras parceladas - próximas faturas',
  dueDateLabel: 'vencimento:',
} as const;

interface ItauDateParts {
  day: number;
  month: number;
  explicitYear: number | null;
}

function validYear(year: number | undefined): number | null {
  return Number.isInteger(year) && year !== undefined && year >= 1000 && year <= 9999
    ? year
    : null;
}

function buildIsoDate(year: number, month: number, day: number): IsoDate | null {
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    return clampDayToMonth(year, month, day) === candidate ? candidate : null;
  } catch {
    return null;
  }
}

function parseDate(text: string): ItauDateParts | null {
  const match = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(text.trim());
  if (match === null) return null;
  const rawYear = match[3];
  let explicitYear: number | null = null;
  if (rawYear !== undefined) {
    const parsed = Number(rawYear);
    if (!Number.isInteger(parsed)) return null;
    explicitYear = rawYear.length === 2 ? 2000 + parsed : parsed;
  }
  return { day: Number(match[1]), month: Number(match[2]), explicitYear };
}

function cellsIn(row: PdfTextRow, range: { minX: number; maxX: number }): string {
  return row.cells
    .filter((cell) => cell.x >= range.minX && cell.x < range.maxX)
    .map((cell) => cell.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsIn(text: string): Cents[] {
  const amounts: Cents[] = [];
  // O PDF do Itaú emite o traço separado por espaço do valor sem `R$`.
  const normalized = text.replace(
    new RegExp(`([${MINUS_DASH_CLASS}])\\s+(?=\\d)`, 'g'),
    '$1',
  );
  for (const match of normalized.matchAll(PDF_MONEY_TOKEN)) {
    const value = parseBRL(match[0]);
    if (value !== null) amounts.push(value);
  }
  return amounts;
}

function rowAmount(row: PdfTextRow): Cents | null {
  const values = amountsIn(cellsIn(row, ITAU_LAYOUT.transaction.value));
  return values.at(-1) ?? null;
}

function documentReference(rows: PdfTextRow[]): {
  reference: ReferenceDate | null;
  documentDate: DocumentDate | null;
} {
  for (const row of rows) {
    if (!row.text.toLowerCase().includes(ITAU_LAYOUT.dueDateLabel)) continue;
    const match = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(row.text);
    if (match === null) continue;
    const year = Number(match[3]);
    const month = Number(match[2]);
    const day = Number(match[1]);
    const date = buildIsoDate(year, month, day);
    if (date !== null) {
      return {
        reference: { year, month, day },
        documentDate: { date, kind: 'due_date' },
      };
    }
  }
  return { reference: null, documentDate: null };
}

function reportedTotal(rows: PdfTextRow[]): Cents | null {
  const matches: Cents[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || !row.text.toLowerCase().includes(ITAU_LAYOUT.totalLabel)) continue;
    const nearby = rows.slice(index, index + 2);
    const found = nearby.flatMap((candidate) =>
      amountsIn(
        candidate.cells
          .filter((cell) => cell.x < 250)
          .map((cell) => cell.text)
          .join(' '),
      ),
    );
    if (found.length === 1) matches.push(cents(-found[0]!));
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * Converte as linhas coordenadas da fatura Itaú em lançamentos editáveis.
 * A coluna direita da página 2 contém próximos meses/encargos e não é somada
 * à fatura atual; a seção futura também encerra a captura da tabela esquerda.
 */
export function parseItauPdf(
  rows: PdfTextRow[],
  opts?: ItauPdfParseOptions,
): ParseResult {
  const { reference, documentDate } = documentReference(rows);
  const fallbackYear = validYear(opts?.defaultYear);
  const parsedRows: ParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let activePage: number | null = null;
  let readingTransactions = false;
  let futureInstallmentsSeen = false;
  let unheadedContinuationCandidate = false;
  let cardLast4: string | undefined;
  let previousTransaction: ParsedRow | null = null;

  rows.forEach((row, index) => {
    if (activePage !== row.page) {
      unheadedContinuationCandidate =
        activePage !== null && readingTransactions && !futureInstallmentsSeen;
      activePage = row.page;
      readingTransactions = false;
      futureInstallmentsSeen = false;
      cardLast4 = undefined;
      previousTransaction = null;
    }
    const lower = row.text.toLowerCase();
    if (lower.includes(ITAU_LAYOUT.futureInstallmentsLabel)) {
      readingTransactions = false;
      futureInstallmentsSeen = true;
      previousTransaction = null;
      return;
    }

    const dateText = cellsIn(row, ITAU_LAYOUT.transaction.date);
    if (dateText.toLowerCase() === 'data') {
      if (!futureInstallmentsSeen) {
        readingTransactions = true;
        unheadedContinuationCandidate = false;
      }
      return;
    }
    if (lower.includes('total dos lançamentos atuais')) return;
    const cardMatch = /(?:\*{4,}|final\s*)\s*(\d{4})/i.exec(dateText);
    if (cardMatch !== null) {
      cardLast4 = cardMatch[1];
      return;
    }
    const value = rowAmount(row);
    const dateParts = parseDate(dateText);
    if (!readingTransactions) {
      if (
        unheadedContinuationCandidate &&
        (dateText !== '' || value !== null || cellsIn(row, ITAU_LAYOUT.transaction.description) !== '')
      ) {
        diagnostics.push({
          line: index + 1,
          message:
            'A tabela de lançamentos continua sem cabeçalho de data reconhecido. Confira esta linha na tela de confirmação.',
          raw: row.text,
        });
      }
      return;
    }

    if (dateParts === null) {
      // A célula de data ocupada, acompanhada por valor, parece uma linha da
      // tabela mas não foi interpretada. Exiba como diagnóstico em vez de a
      // descartar; cabeçalhos sem valor não entram neste ramo.
      const description = cellsIn(row, ITAU_LAYOUT.transaction.description);
      if (dateText === '' && description !== '' && value === null && previousTransaction !== null) {
        previousTransaction.rawDescription = `${previousTransaction.rawDescription} ${description}`.trim();
        return;
      }
      if (
        (dateText !== '' && value !== null) ||
        (dateText === '' && (description !== '' || value !== null))
      ) {
        diagnostics.push({
          line: index + 1,
          message: 'Data não reconhecida nesta linha da fatura Itaú. Confira na tela de confirmação.',
          raw: row.text,
        });
      }
      return;
    }

    const date =
      dateParts.explicitYear === null
        ? yearForDateWithoutYear({
            month: dateParts.month,
            day: dateParts.day,
            reference,
            fallbackYear,
          })
        : dateParts.explicitYear;
    // Quando o ano não veio do PDF nem do chamador, usar um ano bissexto só
    // para validar o par mês/dia; esse ano nunca é publicado como data.
    const validatedDate = buildIsoDate(date ?? 2024, dateParts.month, dateParts.day);
    const occurredOn = date === null ? null : validatedDate;
    const invalidDate = validatedDate === null;
    if (invalidDate) {
      diagnostics.push({
        line: index + 1,
        message: 'Data inválida nesta linha da fatura Itaú. Confira na tela de confirmação.',
        raw: row.text,
      });
    }

    const description = cellsIn(row, ITAU_LAYOUT.transaction.description);
    const installment = detectInstallment(description);
    const amountCents = value === null ? null : cents(-value);
    const parsed: ParsedRow = {
      occurredOn,
      rawDescription: description,
      amountCents,
      installment:
        installment === null
          ? null
          : { current: installment.current, total: installment.total },
      ...(isCreditCardPaymentDescription(description) ? { creditCardPayment: true } : {}),
      ...(isInformationalAmount(amountCents) ? { informational: true } : {}),
      ...(cardLast4 === undefined ? {} : { cardLast4 }),
    };
    parsedRows.push(parsed);
    previousTransaction = parsed;
  });

  return {
    rows: parsedRows,
    diagnostics,
    reportedTotalCents: reportedTotal(rows),
    documentDate,
  };
}
