/**
 * Parser de fatura Santander em PDF â€” CONTRACTS Â§15 (`parseSantanderPdf`), T-117b.
 *
 * Recebe as linhas ja remontadas (`PdfTextRow[]`) e devolve `ParseResult`. Este
 * e o mais hostil dos tres bancos, e por dois motivos que nao existem nos outros:
 *
 * 1. **Data e descricao vem FUNDIDAS num unico run, em `x=33`**
 *    (`"99/99 AAAAA..."`): e `dd/MM` + espaco + descricao no mesmo item de
 *    texto. A separacao e por **parsing de string**, nao por coordenada â€” por
 *    isso o parser do Nubank nao serve de molde.
 * 2. **Duas tabelas independentes dividem as mesmas `y`**: lancamentos em
 *    `x < 250`, quadro-resumo em `x > 320`. Na mesma `y=425` convivem uma compra
 *    e um totalizador. As linhas chegam separadas quando o chamador usa
 *    `groupIntoRows(items, { xBands: SANTANDER_X_BANDS })`; este parser tambem
 *    **re-segmenta as celulas por `x`**, entao le certo mesmo que o chamador
 *    tenha agrupado sem `xBands` (a tabela de resumo e ignorada, nunca vira
 *    lancamento).
 *
 * A geometria vem da medicao de fatura real, anonimizada em `IMPORT-SOURCES.md`
 * Â§8 (medicao de 2026-09-16). O arquivo real vive em `.private/` e nao e
 * acessivel a este agente (RNF-01). Tudo que e layout esta em `SANTANDER_LAYOUT`,
 * marcado `MEDIDO`; o que e decisao de dominio esta marcado `SUPOSICAO`.
 *
 * ## O ano
 *
 * A data e `dd/MM`, **sem ano**. O ano existe no arquivo em data completa
 * `dd/MM/aaaa`, e a medicao Â§8.2 (2026-09-17) fixou onde procura-lo: a **primeira
 * ocorrencia de `dd/MM/aaaa` fora da area de lancamentos** (`x > 250`, o
 * quadro-resumo). A regra e deliberadamente robusta em vez de posicional â€” nao
 * fixar `y`, porque a altura do bloco-resumo muda a cada fatura.
 *
 * Ordem: **documento -> parametro do chamador -> `null`**. Nunca do relogio:
 * `new Date()` e proibido em `/lib` (CONVENTIONS Â§4). Sem nenhuma das duas
 * fontes, a linha volta com `occurredOn: null` para o usuario completar.
 *
 * **Virada de ano (gate T-116).** Uma data `dd/MM` sem ano que cai **depois** da
 * data de referencia do documento e do ano anterior. A referencia do **documento
 * vence** o parametro: e a data impressa pela propria fatura. O parametro so
 * fornece o ano quando o resumo nao traz data completa â€” e, nesse caso, sem
 * virada.
 *
 * Modulo puro (CONVENTIONS Â§5): sem I/O, sem `Date`, sem `process.env`. Toda
 * conta de calendario passa por `lib/date` (`clampDayToMonth`).
 */

import { clampDayToMonth, type IsoDate } from '@/lib/date';
import { detectInstallment } from '@/lib/import/installments';
import type {
  DocumentDate,
  ParsedRow,
  ParseDiagnostic,
  ParseResult,
} from '@/lib/import/types';
import type { PdfTextRow } from '@/lib/import/pdf/rows';
import { cents, parseBRL, type Cents } from '@/lib/money';
import {
  PDF_MONEY_TOKEN,
  isCreditCardPaymentDescription,
  isInformationalAmount,
  yearForDateWithoutYear,
  type ReferenceDate,
} from '@/lib/import/pdf/shared';

/** Faixa horizontal `[minX, maxX)` em pontos. */
interface XBand {
  readonly minX: number;
  readonly maxX: number;
}

/**
 * MEDIDO (Â§8): fronteiras das duas tabelas. Lancamentos terminam antes de 250; o
 * quadro-resumo comeca depois de 320. Exportadas para o chamador passar a
 * `groupIntoRows` e obter `text` limpo por tabela.
 */
const LAUNCH_MIN_X = 0;
const LAUNCH_MAX_X = 250;
const SUMMARY_MIN_X = 320;
const SUMMARY_MAX_X = 595;

/** Faixas de `x` do Santander, na forma que `GroupIntoRowsOptions.xBands` espera. */
export const SANTANDER_X_BANDS: readonly (readonly [number, number])[] = [
  [LAUNCH_MIN_X, LAUNCH_MAX_X],
  [SUMMARY_MIN_X, SUMMARY_MAX_X],
];

/**
 * Layout da fatura Santander. `MEDIDO` veio da medicao (Â§8); `SUPOSICAO` nao foi
 * medido e esta comentado como tal.
 */
export const SANTANDER_LAYOUT = {
  /** Data da medicao que originou estas faixas. */
  measuredOn: '2026-09-16',
  /** Fonte anonimizada das medidas. */
  measuredFrom: 'IMPORT-SOURCES.md Â§8 (fatura real de 2026-09)',

  /**
   * MEDIDO (§8; `aux` RECLASSIFICADA no gate T-116): a celula fundida
   * `dd/MM + descricao` fica em `x=33`; o marcador solto de `x=16-17` fica de
   * fora (`dateMinX=25`).
   *
   * A faixa `aux` (`x=168`) **nao e uma data auxiliar** — e a **coluna de
   * PARCELA** (`11/12`). A medicao de 2026-09-16 a classificou como data por
   * engano; a linha real da secao "Parcelamentos" e
   * `x33:"11/10 <descricao>" x168:"11/12" x214:"2,60"`. Ler a parcela so da
   * descricao deixava esta coluna morta e a fatura sem plano nenhum (G-08).
   */
  columns: {
    date: { minX: 25, maxX: 160 },
    aux: { minX: 160, maxX: 200 },
    value: { minX: 200, maxX: LAUNCH_MAX_X },
  } as Readonly<Record<'date' | 'aux' | 'value', XBand>>,

  /** MEDIDO (Â§8): limites das tabelas, iguais a `SANTANDER_X_BANDS`. */
  launchMaxX: LAUNCH_MAX_X,
  summaryMinX: SUMMARY_MIN_X,

  /**
   * MEDIDO (Â§8.2): o ano vem da primeira data completa `dd/MM/aaaa` fora da area
   * de lancamentos (`x > launchMaxX`). Nao fixar `y`: a altura do bloco-resumo
   * depende do texto promocional e muda a cada fatura.
   */
  fullDatePattern: /(\d{2})\/(\d{2})\/(\d{4})/,

  /**
   * MEDIDO (Â§8): no mesmo run, `dd/MM` seguido de espaco e da descricao. Exigir
   * o espaco depois do mes rejeita uma data completa (`22/08/2026`) â€” que nao e
   * lancamento â€” e o texto restante e a descricao.
   */
  fusedDatePattern: /^(\d{1,2})\/(\d{1,2})(?:\s+(.*))?$/,

  /** Token monetario (compartilhado): Santander nao usa `R$`; o sinal negativo e um traco. */
  moneyToken: PDF_MONEY_TOKEN,

  /**
   * MEDIDO (Â§8): a linha de resumo com prefixo `(=)`. Os demais literais sao
   * SUPOSICAO â€” a medicao so garantiu o `(=)`; que ele carregue o total impresso
   * e inferencia, a ajustar se a fatura real disser outra coisa.
   */
  totalMarkers: [
    '(=)',
    'total a pagar',
    'valor total',
    'total da fatura',
  ] as readonly string[],

  /**
   * SUPOSICAO: blocos institucionais a ignorar alem dos que o gate de data ja
   * descarta. "parcele sua fatura" e citado no aceite do T-117b.
   */
  ignoredMarkers: ['parcele sua fatura'] as readonly string[],

  /**
   * SUPOSICAO (nao coberto pela medicao Â§8): compra vem impressa sem sinal e
   * pagamento/credito com `-`; pela convencao do sistema (CONVENTIONS Â§2, saida
   * negativa) o sinal impresso e invertido, igual ao Nubank. Se a fatura real
   * marcar a direcao ao contrario, e este campo que muda.
   */
  invertPrintedSign: true,
} as const;

/** Opcoes do parser. Ver a decisao sobre o ano no topo do arquivo. */
export interface SantanderPdfParseOptions {
  /**
   * Ano a usar nas datas `dd/MM` quando o proprio documento nao traz uma data
   * completa (`dd/MM/aaaa`) no quadro-resumo. Vem do chamador (a competencia
   * escolhida na tela), **nunca** do relogio. Sem ele e sem data no documento, a
   * linha volta com `occurredOn: null`.
   */
  defaultYear?: number;
}

/** Data reconhecida no run fundido. */
interface FusedDateMatch {
  day: number;
  month: number;
  /** Texto depois de `dd/MM`, ja sem o espaco separador. Pode ser vazio. */
  description: string;
}

/** Celulas da linha dentro de uma faixa de `x`. */
function cellsIn(row: PdfTextRow, band: XBand) {
  return row.cells.filter((cell) => cell.x >= band.minX && cell.x < band.maxX);
}

/** Junta celulas por espaco, colapsando repeticoes. */
function joinCells(cells: readonly { text: string }[]): string {
  return cells
    .map((cell) => cell.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ultimo valor monetario de um texto, ou `null`. */
function lastAmount(text: string): Cents | null {
  let found: Cents | null = null;
  // `matchAll` clona o regex; o `lastIndex` do modulo nao e tocado.
  for (const match of text.matchAll(SANTANDER_LAYOUT.moneyToken)) {
    const parsed = parseBRL(match[0]);
    if (parsed !== null) found = parsed;
  }
  return found;
}

/**
 * Celula cujo texto inteiro e um valor monetario, a mais a direita. Testar a
 * celula inteira (e nao um token dentro dela) separa valor de descricao: um
 * estabelecimento com numero no nome nao vira valor; o marcador solto e a data
 * auxiliar tambem nao, porque nao parseiam como dinheiro.
 */
function rightmostPureMoney(
  cells: readonly { x: number; text: string }[],
): Cents | null {
  let found: Cents | null = null;
  let foundX = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const parsed = parseBRL(cell.text.trim());
    if (parsed !== null && cell.x >= foundX) {
      found = parsed;
      foundX = cell.x;
    }
  }
  return found;
}

/**
 * Valor do lancamento. A faixa medida (Â§8, `x 200..250`) vem primeiro; se ela
 * nao tiver valor, cai para as celulas da area de lancamentos. O valor e
 * alinhado a direita, entao o `x` inicial encolhe conforme o numero cresce â€” um
 * valor longo comeca antes da faixa medida e seria perdido sem o fallback.
 */
function amountFrom(row: PdfTextRow): Cents | null {
  const inBand = rightmostPureMoney(cellsIn(row, SANTANDER_LAYOUT.columns.value));
  if (inBand !== null) return inBand;
  const launchSide = row.cells.filter(
    (cell) =>
      cell.x >= SANTANDER_LAYOUT.columns.date.minX &&
      cell.x < SANTANDER_LAYOUT.summaryMinX,
  );
  return rightmostPureMoney(launchSide);
}

/**
 * Texto da coluna de PARCELA (`x=168`), que a medicao inicial chamou de "data
 * auxiliar". Ver a nota da faixa `aux` na constante do layout.
 */
function installmentFor(row: PdfTextRow): string {
  return joinCells(cellsIn(row, SANTANDER_LAYOUT.columns.aux));
}

/**
 * Data de referencia do documento (Â§8.2): a primeira data completa `dd/MM/aaaa`
 * fora da area de lancamentos (`x > launchMaxX`). `null` quando o quadro-resumo
 * nao a traz. E a fonte da virada de ano.
 */
function documentReference(rows: PdfTextRow[]): ReferenceDate | null {
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.x <= SANTANDER_LAYOUT.launchMaxX) continue;
      const match = SANTANDER_LAYOUT.fullDatePattern.exec(cell.text);
      if (match === null) continue;
      const year = Number(match[3]);
      const month = Number(match[2]);
      const day = Number(match[1]);
      if (
        !Number.isInteger(year) ||
        year < 1000 ||
        year > 9999 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
      ) {
        continue;
      }
      return { year, month, day };
    }
  }
  return null;
}

/** Ano valido do parametro, ou `null`. */
function validYear(value: number | undefined): number | null {
  if (value === undefined) return null;
  return Number.isInteger(value) && value >= 1000 && value <= 9999 ? value : null;
}

/** Monta `'YYYY-MM-DD'` validando pelo calendario de `lib/date` (nunca por `Date`). */
function buildIsoDate(year: number, month: number, day: number): IsoDate | null {
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    return clampDayToMonth(year, month, day) === candidate ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Aplica a convencao de sinal do sistema. Ver `invertPrintedSign` na constante.
 */
function toSystemAmount(printed: Cents): Cents {
  return SANTANDER_LAYOUT.invertPrintedSign ? cents(-printed) : printed;
}

/**
 * Le o run fundido `dd/MM + descricao` a partir das celulas da faixa de data.
 * `null` quando a linha nao comeca com uma data `dd/MM` â€” cabecalho, propaganda,
 * quadro-resumo ou data auxiliar solta.
 */
function matchFusedDate(row: PdfTextRow): FusedDateMatch | null {
  const match = SANTANDER_LAYOUT.fusedDatePattern.exec(
    joinCells(cellsIn(row, SANTANDER_LAYOUT.columns.date)),
  );
  if (match === null) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  return { day, month, description: (match[3] ?? '').trim() };
}

/**
 * Parseia as linhas de uma fatura Santander de cartao.
 *
 * Uma linha vira lancamento quando a faixa de data comeca com `dd/MM` seguido de
 * descricao. O `x` da faixa de valor e o das colunas medidas (Â§8); a tabela de
 * resumo (`x > 320`) e ignorada, exceto pela linha `(=)`, que traz o total
 * impresso (`SUPOSICAO`).
 *
 * `defaultYear` e a fonte de ano de reserva, usada quando o documento nao traz
 * `dd/MM/aaaa`; sem nenhuma das duas, `occurredOn` volta `null`. Linha candidata
 * sempre vira `ParsedRow` â€” o campo que nao foi lido volta como `null`, nunca
 * sentinela e nunca descartada (CONTRACTS Â§15). Por isso `diagnostics` volta
 * vazio.
 */
export function parseSantanderPdf(
  rows: PdfTextRow[],
  opts?: SantanderPdfParseOptions,
): ParseResult {
  const parsedRows: ParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const reference = documentReference(rows);
  // MEDIDO (§8.2 + gate): a primeira data completa fora dos lancamentos esta sob
  // o rotulo literal "Vencimento" — e vencimento, nao data de emissao.
  let documentDate: DocumentDate | null = null;
  if (reference !== null) {
    const iso = buildIsoDate(reference.year, reference.month, reference.day);
    if (iso !== null) documentDate = { date: iso, kind: 'due_date' };
  }
  const fallbackYear = validYear(opts?.defaultYear);
  let reportedTotalCents: Cents | null = null;

  for (const row of rows) {
    const lower = row.text.toLowerCase();

    if (SANTANDER_LAYOUT.ignoredMarkers.some((marker) => lower.includes(marker))) {
      continue;
    }

    const dateMatch = matchFusedDate(row);

    // Linha de total: marcador do resumo e nenhuma data de lancamento na faixa
    // de data. O valor sai de qualquer celula da linha (a tabela e a da direita).
    if (
      dateMatch === null &&
      SANTANDER_LAYOUT.totalMarkers.some((marker) => lower.includes(marker))
    ) {
      const total = lastAmount(joinCells(row.cells));
      if (total !== null) reportedTotalCents = toSystemAmount(total);
      continue;
    }

    // Sem data: cabecalho, propaganda, quadro-resumo, data auxiliar solta.
    if (dateMatch === null) continue;

    const amount = amountFrom(row);
    const rowYear = yearForDateWithoutYear({
      month: dateMatch.month,
      day: dateMatch.day,
      reference,
      fallbackYear,
    });
    const occurredOn =
      rowYear === null ? null : buildIsoDate(rowYear, dateMatch.month, dateMatch.day);
    // Parcela: a COLUNA (`x=168`) primeiro, a descricao depois — mesma ordem do
    // Mercado Pago. Nem toda linha parcelada do Santander esta na secao
    // "Parcelamentos", entao a descricao continua como fallback. O detector do
    // T-121 filtra o que a coluna possa trazer que nao seja parcela (`25/12`,
    // com dia > mes, e recusado).
    const detected =
      detectInstallment(installmentFor(row)) ??
      detectInstallment(dateMatch.description);
    // Pagamento da fatura anterior (RF-CC-04).
    const creditCardPayment = isCreditCardPaymentDescription(dateMatch.description);
    const amountCents = amount === null ? null : toSystemAmount(amount);

    parsedRows.push({
      occurredOn,
      rawDescription: dateMatch.description,
      amountCents,
      fitId: null,
      installment:
        detected === null
          ? null
          : { current: detected.current, total: detected.total },
      ...(creditCardPayment ? { creditCardPayment: true } : {}),
      // Decisao 8: `ANUIDADE DIFERENCIADA` R$ 0,00 (com parcela 01/12).
      ...(isInformationalAmount(amountCents) ? { informational: true } : {}),
    });
  }

  return { rows: parsedRows, diagnostics, reportedTotalCents, documentDate };
}
