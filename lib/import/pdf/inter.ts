/**
 * Parser da fatura de cartão Banco Inter em PDF — CONTRACTS §15
 * (`parseInterPdf`), T-INTER.
 *
 * Recebe as linhas já remontadas por `groupIntoRows` (não lê bytes nem
 * coordenada bruta). A extração dos runs é infraestrutura comum (`extract.ts`);
 * o que este arquivo tem de próprio é o **mapeamento de colunas** do Inter.
 *
 * ## Layout MEDIDO (IMPORT-SOURCES §10)
 *
 * Fatura real com vencimento em 20/11/2026, 6 páginas de 446×632pt, sem senha.
 * Os lançamentos ficam na página "Despesas da fatura", agrupados **por cartão**:
 *
 * | Coluna       | x medido | Formato medido                          |
 * |--------------|----------|-----------------------------------------|
 * | Data         | `24`     | `15 de jun. 2026` — **com ano**         |
 * | Movimentação | `77`     | livre; parcela vem colada: `(Parcela 05 de 06)` |
 * | Beneficiário | `282`    | `-` quando não há                       |
 * | Valor        | `388–406`| `R$ 250,00` (compra) / `+ R$ 508,40` (crédito) |
 *
 * ## O que difere dos outros bancos
 *
 * 1. **A data traz o ano.** Nubank, Santander, Mercado Pago e Itaú imprimem
 *    `dd/MM` sem ano e precisam de referência da fatura; o Inter imprime
 *    `dd de mmm. aaaa`. Por isso este parser não tem `defaultYear` nem virada de
 *    ano: a data da linha é a data da compra, inclusive a parcelada de 2025.
 * 2. **O sinal é um `+` em crédito**, não um `-`. Compra vem sem sinal (saída);
 *    `+ R$ 508,40` é pagamento da fatura anterior ou estorno (entrada).
 * 3. **O total do cartão NÃO inclui o pagamento da fatura anterior.** Medido:
 *    `Total CARTÃO …3259` = R$ 262,30 = a soma das compras, sem o `+ R$ 508,40`.
 *    Quem soma as linhas importadas deve deixar o pagamento de fora — e ele já
 *    chega desmarcado (`creditCardPayment`, RF-CC-04), como nos outros bancos.
 * 4. **A seção "Próxima fatura" (página 4) lista parcelas futuras** na mesma
 *    tabela visual (`Movimentação | Valor`), mas sem coluna de data. Só vira
 *    lançamento quem tem data válida na coluna de data **dentro de uma seção de
 *    cartão**; as parcelas futuras nunca somam à fatura atual.
 * 5. **Quebra de kerning na primeira letra.** Medido: `PAGAMENTO DE FATURA`
 *    chega como dois runs, `P` em x=77 e `AGAMENTO DE FATURA` em x=80. Unidas por
 *    espaço (o padrão de `groupIntoRows`) viram `P AGAMENTO` e o pagamento da
 *    fatura deixa de ser reconhecido. A descrição cola uma letra solta ao run
 *    seguinte quando os dois começam a menos de `splitInitialMaxGap` pontos.
 *
 * `ParsedRow.cardLast4` carrega o final do cartão da seção (`CARTÃO 2306****3259`
 * → `3259`). A fatura reúne vários cartões do mesmo titular; o final fica no
 * campo próprio, não no texto.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`. Toda
 * conta de calendário passa por `lib/date` (`clampDayToMonth`).
 */

import { clampDayToMonth, type IsoDate } from '@/lib/date';
import { detectInstallment } from '@/lib/import/installments';
import type {
  DocumentDate,
  ParseDiagnostic,
  ParseResult,
  ParsedRow,
} from '@/lib/import/types';
import type { PdfTextRow } from '@/lib/import/pdf/rows';
import { cents, parseBRL, type Cents } from '@/lib/money';
import {
  PDF_MONEY_TOKEN,
  isCreditCardPaymentDescription,
  isInformationalAmount,
} from '@/lib/import/pdf/shared';

/** Faixa horizontal `[minX, maxX)` em pontos. */
interface XBand {
  readonly minX: number;
  readonly maxX: number;
}

/**
 * Layout da fatura Inter. **Único lugar do arquivo com geometria.**
 *
 * MEDIDO em fatura real (vencimento 2026-11-20), anonimizado em
 * `IMPORT-SOURCES.md` §10. O que for suposição está marcado `SUPOSICAO`.
 */
export const INTER_LAYOUT = {
  /** Data da medição que originou estas faixas. Re-medir quando o layout mudar. */
  measuredOn: '2026-11-26',
  transaction: {
    date: { minX: 0, maxX: 70 },
    description: { minX: 70, maxX: 280 },
    beneficiary: { minX: 280, maxX: 345 },
    value: { minX: 345, maxX: 460 },
  } as Readonly<
    Record<'date' | 'description' | 'beneficiary' | 'value', XBand>
  >,
  /**
   * MEDIDO: o cabeçalho repetido das páginas 2+ (titular, cartão, vencimento,
   * total) está em y≥597 e o título da página de lançamentos em y=550. Acima de
   * `maxY` nada é lançamento. O piso é **SUPOSICAO** conservadora, como no
   * Mercado Pago: não há rodapé medido na página de lançamentos.
   */
  transactionRegion: { minY: 30, maxY: 590 },
  /**
   * MEDIDO: `P` (x=77) + `AGAMENTO DE FATURA` (x=80), distância 3pt. Uma palavra
   * de uma letra seguida de outra palavra fica a ≥6pt, então 4pt separa os dois
   * casos. **SUPOSICAO** sobre o limite exato; o medido é só o 3pt.
   */
  splitInitialMaxGap: 4,
  /** MEDIDO: `Total da sua fatura` (página 1) com o valor numa das linhas seguintes. */
  totalLabel: 'total da sua fatura',
  /** MEDIDO: `Fatura atual R$ 331,03` no topo da página de lançamentos. */
  currentStatementLabel: 'fatura atual',
  /** MEDIDO: `Data de Vencimento` (página 1), com a data na linha de baixo. */
  dueDateLabel: 'data de vencimento',
  /** Quantas linhas abaixo do rótulo o valor/data pode estar. Medido: 1 a 2. */
  labelLookahead: 3,
  /** MEDIDO: coluna da esquerda da página 1; a da direita é o limite de crédito. */
  summaryMaxX: 300,
} as const;

/** `jan..dez` em pt-BR, pelas três primeiras letras sem acento. */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

/** MEDIDO: `15 de jun. 2026`. O ponto depois do mês é opcional. */
const DATE_PATTERN = /^(\d{1,2})\s+de\s+(\p{L}+)\.?\s+(\d{4})$/u;

/** MEDIDO: `CARTÃO 2306****3259` abre a seção; os últimos 4 dígitos são o final. */
const CARD_SECTION_PATTERN = /^cart[ãa]o\s+\S*?(\d{4})$/i;

/** MEDIDO: `Total CARTÃO 2306****3259 R$ 262,30` fecha a seção do cartão. */
const CARD_TOTAL_PATTERN = /^total\s+cart[ãa]o\b/i;

const FULL_DATE_PATTERN = /(\d{2})\/(\d{2})\/(\d{4})/;

/** Monta `'YYYY-MM-DD'` validando pelo calendário de `lib/date` (nunca por `Date`). */
function buildIsoDate(year: number, month: number, day: number): IsoDate | null {
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    return clampDayToMonth(year, month, day) === candidate ? candidate : null;
  } catch {
    return null;
  }
}

/** `15 de jun. 2026` → partes, ou `null` quando não é nesse formato. */
function parseInterDate(
  text: string,
): { day: number; month: number; year: number } | null {
  const match = DATE_PATTERN.exec(text.trim());
  if (match === null) return null;
  const monthName = (match[2] ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .slice(0, 3);
  const month = MONTHS[monthName];
  if (month === undefined) return null;
  return { day: Number(match[1]), month, year: Number(match[3]) };
}

function cellsIn(row: PdfTextRow, band: XBand) {
  return row.cells.filter((cell) => cell.x >= band.minX && cell.x < band.maxX);
}

/** Texto das células da faixa, unidas por espaço. */
function textIn(row: PdfTextRow, band: XBand): string {
  return cellsIn(row, band)
    .map((cell) => cell.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Descrição da coluna "Movimentação". Une as células por espaço, exceto quando a
 * anterior é uma letra solta quase colada na seguinte (quebra de kerning na
 * inicial, armadilha 5 do topo do arquivo).
 */
function descriptionOf(row: PdfTextRow): string {
  const cells = cellsIn(row, INTER_LAYOUT.transaction.description);
  let text = '';
  cells.forEach((cell, index) => {
    const previous = cells[index - 1];
    const splitInitial =
      previous !== undefined &&
      previous.text.length === 1 &&
      /\p{L}/u.test(previous.text) &&
      cell.x - previous.x <= INTER_LAYOUT.splitInitialMaxGap;
    text += index === 0 || splitInitial ? cell.text : ` ${cell.text}`;
  });
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Beneficiário, quando existe. `-` (e variantes de traço) significa "nenhum".
 * **SUPOSICAO**: nas faturas medidas a coluna era sempre `-`; num Pix ou boleto
 * no crédito ela deve trazer o favorecido, informação útil na descrição.
 */
function beneficiaryOf(row: PdfTextRow): string {
  const text = textIn(row, INTER_LAYOUT.transaction.beneficiary);
  return /^[\p{Pd}\s]*$/u.test(text) ? '' : text;
}

/** Valores monetários do texto, na ordem em que aparecem. */
function amountsIn(text: string): Cents[] {
  const found: Cents[] = [];
  for (const match of text.matchAll(PDF_MONEY_TOKEN)) {
    const parsed = parseBRL(match[0]);
    if (parsed !== null) found.push(parsed);
  }
  return found;
}

/**
 * Valor do lançamento no sinal do sistema (saída negativa, CONVENTIONS §2).
 *
 * MEDIDO: compra vem sem sinal, crédito vem com `+`. Um `-` impresso, que a
 * fatura medida não trouxe, é tratado como a convenção dos outros bancos de
 * cartão: sinal impresso invertido.
 */
function rowAmount(row: PdfTextRow): Cents | null {
  const text = textIn(row, INTER_LAYOUT.transaction.value);
  const printed = amountsIn(text).at(-1);
  if (printed === undefined) return null;
  const isCredit = text.trimStart().startsWith('+');
  return isCredit ? cents(Math.abs(printed)) : cents(-printed);
}

/** Vencimento impresso: `Data de Vencimento` e, uma ou duas linhas abaixo, `dd/MM/aaaa`. */
function documentDateOf(rows: PdfTextRow[]): DocumentDate | null {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (!row.text.toLowerCase().includes(INTER_LAYOUT.dueDateLabel)) continue;
    for (const candidate of rows.slice(
      index,
      index + INTER_LAYOUT.labelLookahead,
    )) {
      if (candidate.page !== row.page) break;
      const match = FULL_DATE_PATTERN.exec(candidate.text);
      if (match === null) continue;
      const date = buildIsoDate(
        Number(match[3]),
        Number(match[2]),
        Number(match[1]),
      );
      if (date !== null) return { date, kind: 'due_date' };
    }
  }
  return null;
}

/** Texto da coluna da esquerda (resumo), onde fica o total da fatura. */
function summaryText(row: PdfTextRow): string {
  return row.cells
    .filter((cell) => cell.x < INTER_LAYOUT.summaryMaxX)
    .map((cell) => cell.text)
    .join(' ');
}

/**
 * Total da fatura, com sinal de saída. Duas fontes medidas: `Total da sua
 * fatura` (página 1, valor nas linhas de baixo) e `Fatura atual R$ …` (topo da
 * página de lançamentos). Só vale se todas as fontes achadas concordarem num
 * valor único: duas respostas diferentes são evidência anulada, e um total
 * errado acusaria divergência falsa no conferidor.
 */
function reportedTotalOf(rows: PdfTextRow[]): Cents | null {
  const found = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const lower = summaryText(row).toLowerCase().trim();

    if (lower.startsWith(INTER_LAYOUT.totalLabel)) {
      for (const candidate of rows.slice(
        index + 1,
        index + 1 + INTER_LAYOUT.labelLookahead,
      )) {
        if (candidate.page !== row.page) break;
        const values = amountsIn(summaryText(candidate));
        if (values.length === 0) continue;
        if (values.length === 1 && values[0] !== undefined) found.add(values[0]);
        break;
      }
    } else if (lower.startsWith(INTER_LAYOUT.currentStatementLabel)) {
      const values = amountsIn(row.text);
      if (values.length === 1 && values[0] !== undefined) found.add(values[0]);
    }
  }
  if (found.size !== 1) return null;
  const [total] = [...found];
  return total === undefined ? null : cents(-total);
}

/** Linha dentro da área de lançamentos medida. Fora dela é cabeçalho de página. */
function inTransactionRegion(row: PdfTextRow): boolean {
  const { minY, maxY } = INTER_LAYOUT.transactionRegion;
  return row.y >= minY && row.y < maxY;
}

/**
 * Converte as linhas coordenadas da fatura Inter em lançamentos editáveis.
 *
 * Uma seção de cartão começa em `CARTÃO ****9999`, passa a ler lançamentos no
 * cabeçalho `Data | Movimentação | Beneficiário | Valor` e termina em
 * `Total CARTÃO …`. Linha que parece lançamento (coluna de data ocupada ou valor
 * presente) e não foi lida vira `ParseDiagnostic`: nada some em silêncio.
 */
export function parseInterPdf(rows: PdfTextRow[]): ParseResult {
  const parsedRows: ParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let reading = false;
  let cardLast4: string | undefined;
  let previous: ParsedRow | null = null;

  rows.forEach((row, index) => {
    if (!inTransactionRegion(row)) return;
    const dateText = textIn(row, INTER_LAYOUT.transaction.date);

    if (CARD_TOTAL_PATTERN.test(row.text)) {
      reading = false;
      previous = null;
      return;
    }
    const card = CARD_SECTION_PATTERN.exec(row.text.trim());
    if (card !== null) {
      cardLast4 = card[1];
      reading = false;
      previous = null;
      return;
    }
    if (dateText.toLowerCase() === 'data') {
      // Cabeçalho da tabela; repete-se se a seção atravessar a página.
      reading = cardLast4 !== undefined;
      return;
    }
    if (!reading) return;

    const description = descriptionOf(row);
    const amount = rowAmount(row);
    const parsedDate = parseInterDate(dateText);

    if (parsedDate === null) {
      // Sem data: continuação da descrição (só texto) ou linha não reconhecida.
      if (
        dateText === '' &&
        description !== '' &&
        amount === null &&
        previous !== null
      ) {
        previous.rawDescription = `${previous.rawDescription} ${description}`.trim();
        return;
      }
      if (dateText !== '' || description !== '' || amount !== null) {
        diagnostics.push({
          line: index + 1,
          message:
            'Linha da fatura Inter sem data reconhecida não virou lançamento. Confira na tela de confirmação.',
          raw: row.text,
        });
      }
      return;
    }

    const occurredOn = buildIsoDate(
      parsedDate.year,
      parsedDate.month,
      parsedDate.day,
    );
    if (occurredOn === null) {
      diagnostics.push({
        line: index + 1,
        message: `Data inválida nesta linha da fatura Inter: "${dateText}". Confira na tela de confirmação.`,
        raw: row.text,
      });
    }

    const beneficiary = beneficiaryOf(row);
    const rawDescription = `${description} ${beneficiary}`.trim();
    const installment = detectInstallment(rawDescription);
    const parsed: ParsedRow = {
      occurredOn,
      rawDescription,
      amountCents: amount,
      installment:
        installment === null
          ? null
          : { current: installment.current, total: installment.total },
      ...(isCreditCardPaymentDescription(description)
        ? { creditCardPayment: true }
        : {}),
      ...(isInformationalAmount(amount) ? { informational: true } : {}),
      ...(cardLast4 === undefined ? {} : { cardLast4 }),
    };
    parsedRows.push(parsed);
    previous = parsed;
  });

  return {
    rows: parsedRows,
    diagnostics,
    reportedTotalCents: reportedTotalOf(rows),
    documentDate: documentDateOf(rows),
  };
}
