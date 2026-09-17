/**
 * Parser de fatura Nubank em PDF — CONTRACTS §15 (`parseNubankPdf`), T-117.
 *
 * Recebe as linhas ja remontadas por `groupIntoRows` (nao le bytes nem
 * coordenada bruta) e devolve `ParseResult`. A extracao e a remontagem sao
 * infraestrutura comum aos tres bancos; o que este arquivo tem de proprio e o
 * **mapeamento de colunas** da fatura Nubank.
 *
 * ---
 *
 * ## Layout MEDIDO, nao suposto
 *
 * As faixas de `NUBANK_LAYOUT` vem da medicao de uma fatura real, anonimizada e
 * publicada pelo Orquestrador em `IMPORT-SOURCES.md` §6 (medicao de 2026-09-16
 * sobre a fatura de 2026-09-09). O arquivo real vive em `.private/` e nao e
 * acessivel a este agente (RNF-01); a secao §6 e a forma anonimizada — letra
 * virou `A`, digito virou `9` — e por isso pode ser lida aqui.
 *
 * Ainda assim, toda a geometria mora numa unica constante: quando o Nubank
 * redesenhar a fatura, o conserto e re-medir e ajustar `NUBANK_LAYOUT`, sem
 * tocar na logica.
 *
 * ## As quatro armadilhas da fatura real (§6.1), e como o codigo as trata
 *
 * 1. **A descricao nao tem x fixo.** Salta de `x=185` para `x=214` quando a
 *    linha traz a coluna de cartao (`x=172`, opcional). Por isso a descricao e
 *    lida por **faixa** (`180..450`), que cobre os dois valores — chumbar um x
 *    unico perderia metade dos lancamentos em silencio.
 * 2. **O valor e alinhado a direita.** O `x` inicial varia com o tamanho do
 *    numero (`491..508`). So faixa (`x >= 450`) funciona; comparar por igualdade
 *    nao.
 * 3. **Linhas de continuacao sem data** (ancoradas em `x=214`, com conversao de
 *    cambio) pertencem a transacao de cima. Tratar como lancamento inventa
 *    despesa; descartar em silencio viola a regra de nao engolir linha. Aqui
 *    elas sao **anexadas a transacao anterior**, nunca viram linha propria.
 * 4. **A parcela vem no fim da descricao** (`- AAAAAAA 99/99`). Quem reconhece e
 *    `detectInstallment` do T-121 — este parser chama, nao reimplementa.
 *
 * ## O ano e regra de dominio, nao detalhe (§6.2)
 *
 * A linha de transacao nao tem ano; ele esta no cabecalho, repetido em todas as
 * paginas. A resolucao, nesta ordem:
 *
 * 1. **Cabecalho da fatura** (fatura/emissao/vencimento), lido das proprias
 *    linhas.
 * 2. **Parametro do chamador** (`opts.defaultYear`) — a tela sabe a competencia
 *    importada. **Nunca** do relogio: `new Date()` e proibido em `/lib`
 *    (CONVENTIONS §4) e "ano atual" quebra em silencio todo janeiro.
 * 3. **Nada disso** — a linha vira `ParseDiagnostic` com o texto original, para
 *    o usuario completar na tela de confirmacao (o tipo `ParsedRow` nao carrega
 *    `confidence`; em PDF, o canal de baixa confianca e o diagnostico). A linha
 *    nunca e chutada nem engolida em silencio.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`. Toda
 * conta de calendario passa por `lib/date` (`clampDayToMonth`).
 */

import { clampDayToMonth, type IsoDate } from '@/lib/date';
import { detectInstallment } from '@/lib/import/installments';
import type { ParsedRow, ParseDiagnostic, ParseResult } from '@/lib/import/types';
import type { PdfTextRow } from '@/lib/import/pdf/rows';
import { cents, parseBRL, type Cents } from '@/lib/money';

/** Faixa horizontal `[minX, maxX)` em pontos. */
interface XBand {
  readonly minX: number;
  readonly maxX: number;
}

/**
 * Layout da fatura Nubank. **Unico lugar do arquivo com geometria.**
 *
 * MEDIDO em fatura real de 2026-09-09 (5 paginas, 595x842pt), medicao de
 * 2026-09-16, anonimizado em `IMPORT-SOURCES.md` §6. Nada aqui e suposicao de
 * layout; o que ainda for suposicao de dominio esta marcado `SUPOSICAO`.
 */
export const NUBANK_LAYOUT = {
  /** Data da medicao que originou estas faixas. Re-medir quando o layout mudar. */
  measuredOn: '2026-09-16',
  /** Fonte anonimizada das medidas. */
  measuredFrom: 'IMPORT-SOURCES.md §6 (fatura real de 2026-09-09)',

  /**
   * MEDIDO (§6.1): colunas de x. A descricao cobre 185 e 214; o cartao (172) fica
   * numa faixa propria, ignorada; o valor e tudo a partir de 450 (alinhado a
   * direita, inicia entre 491 e 508).
   */
  columns: {
    date: { minX: 100, maxX: 160 },
    card: { minX: 160, maxX: 180 },
    description: { minX: 180, maxX: 450 },
    value: { minX: 450, maxX: 595 },
  } as Readonly<Record<'date' | 'card' | 'description' | 'value', XBand>>,

  /**
   * MEDIDO (§6.3): faixa vertical da area de transacao, na pagina 5. O cabecalho
   * (nome do titular em `y=795`, fatura/emissao em `y=782`) e o cabecalho da
   * secao (`y=732`) ficam acima; o numero de pagina (`y≈21`) fica abaixo. Limitar
   * por `y` impede que o rodape vire continuacao da ultima transacao.
   */
  transactionRegion: { minY: 40, maxY: 732 },

  /**
   * MEDIDO (§6.3): o rodape institucional e o numero de pagina ficam em `y<=120`.
   * Uma linha sem data nessa faixa e rodape, nunca continuacao de transacao.
   */
  footerTopY: 120,

  /**
   * MEDIDO (§6.1): as linhas de continuacao ancoram em `x=214`, nunca em `185`
   * (o x sem coluna de cartao). Exigir a ancora evita que texto solto de rodape
   * que caia na faixa de descricao vire continuacao.
   */
  continuationMinX: 200,

  /**
   * MEDIDO (§6.1): data no formato `dd MMM` pt-BR, sem ano (`15 SET`). O
   * `dd/mm` fica como segunda forma, util para faturas de outros meses e para
   * eventos com data completa.
   */
  dateFormats: [
    {
      name: 'dd/mm',
      pattern: /^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/,
    },
    {
      name: 'dd mmm',
      pattern:
        /^(\d{1,2})\s*(?:de\s+)?([A-Za-z]{3})\.?(?:\s*(?:de\s+)?(\d{2,4}))?/i,
    },
  ],

  /** MEDIDO (§6.1): abreviacoes de mes da fatura. */
  monthNumbers: {
    JAN: 1,
    FEV: 2,
    MAR: 3,
    ABR: 4,
    MAI: 5,
    JUN: 6,
    JUL: 7,
    AGO: 8,
    SET: 9,
    OUT: 10,
    NOV: 11,
    DEZ: 12,
  } as Readonly<Record<string, number>>,

  /**
   * MEDIDO (§6.1/§6.2): token monetario (`R$ 9.999,99`, com `-` no credito) e o
   * ano de 4 digitos do cabecalho.
   */
  moneyToken: /-?\s*R\$\s*\d[\d.,]*|-?\d{1,3}(?:\.\d{3})*,\d{2}/g,
  yearToken: /\b(20\d{2})\b/,

  /**
   * MEDIDO (§6.2): o ano aparece na linha de fatura/emissao (`y=782`) e na de
   * vencimento/periodo (pagina 1). Restringir a busca a esses marcadores evita
   * que um `20xx` solto (data de emissao de outro ano, protocolo) vire o ano de
   * todas as linhas sem ano — encontrar o ano errado e pior que nao encontrar.
   */
  yearMarkers: [
    'fatura',
    'emissão',
    'emissao',
    'vencimento',
    'período',
    'periodo',
  ] as readonly string[],

  /**
   * MEDIDO (§6.1): literais da linha de total impresso. Comparados em minusculas,
   * por `includes`; nao casam com descricao de compra comum.
   */
  totalMarkers: [
    'total a pagar',
    'valor total',
    'total da fatura',
    'total desta fatura',
  ] as readonly string[],

  /**
   * MEDIDO (§6.3): cabecalho e rodape a ignorar. Literais especificos de
   * proposito — termos genericos como "pagamento" derrubariam credito legitimo.
   */
  headerFooterMarkers: [
    'vencimento',
    'fechamento',
    'limite disponível',
    'limite do cartão',
    'resumo da fatura',
    'parcele sua fatura',
    'pagamento mínimo',
    'emissão',
    'emissao',
  ] as readonly string[],

  /**
   * SUPOSICAO (nao coberto pela medicao §6): na fatura, compra vem impressa sem
   * sinal e credito/estorno com `-`. Pela convencao do sistema (CONVENTIONS §2,
   * saida negativa), o sinal impresso e invertido: compra `R$ 15,00` vira
   * `-1500`, estorno `-R$ 50,00` vira `+5000`. Vale tambem para o total impresso,
   * para casar com `reconcileStatement` (CONTRACTS §3).
   */
  invertPrintedSign: true,
} as const;

/** Opcoes do parser. Ver a decisao sobre o ano no topo do arquivo. */
export interface NubankPdfParseOptions {
  /**
   * Ano a usar quando a linha nao traz ano e o cabecalho tambem nao. Deve vir do
   * chamador (competencia escolhida na tela), **nunca** do relogio.
   */
  defaultYear?: number;
}

/** Data reconhecida em uma linha, com o ano apenas se ele veio impresso. */
interface DateMatch {
  /** Trecho consumido, do inicio da string. */
  raw: string;
  day: number;
  month: number;
  /** Ano impresso na propria linha, ou `null` quando a linha nao o traz. */
  explicitYear: number | null;
}

/** Valor monetario reconhecido, com a posicao para separar a descricao. */
interface AmountMatch {
  cents: Cents;
  index: number;
  raw: string;
}

/** Celulas da linha dentro de uma faixa de x. */
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

/** Converte `aa` para `20aa` e valida `aaaa`. */
function normalizeYear(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (raw.length === 2) return 2000 + value;
  return value >= 1000 && value <= 9999 ? value : null;
}

/** Monta `'YYYY-MM-DD'` validando pelo calendario de `lib/date` (nunca por `Date`). */
function buildIsoDate(year: number, month: number, day: number): IsoDate | null {
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    // `clampDayToMonth` aplica a regra de 28/29/30/31 e valida mes/ano; se ele
    // tiver de clarear o dia, a data impressa nao existia e a linha e invalida.
    return clampDayToMonth(year, month, day) === candidate ? candidate : null;
  } catch {
    return null;
  }
}

/** Casa o primeiro formato de data da constante, do inicio da string. */
function matchDate(text: string): DateMatch | null {
  const [numeric, named] = NUBANK_LAYOUT.dateFormats;

  const numericMatch = numeric === undefined ? null : numeric.pattern.exec(text);
  if (numericMatch !== null) {
    const month = Number(numericMatch[2]);
    if (month >= 1 && month <= 12) {
      return {
        raw: numericMatch[0],
        day: Number(numericMatch[1]),
        month,
        explicitYear: normalizeYear(numericMatch[3]),
      };
    }
  }

  const namedMatch = named === undefined ? null : named.pattern.exec(text);
  if (namedMatch !== null) {
    const month = NUBANK_LAYOUT.monthNumbers[(namedMatch[2] ?? '').toUpperCase()];
    if (month !== undefined) {
      return {
        raw: namedMatch[0],
        day: Number(namedMatch[1]),
        month,
        explicitYear: normalizeYear(namedMatch[3]),
      };
    }
  }

  return null;
}

/** Ultimo valor monetario de um texto, com a posicao onde ele comeca. */
function findLastAmount(text: string): AmountMatch | null {
  let found: AmountMatch | null = null;
  // `matchAll` clona o regex: o `lastIndex` do modulo nao e tocado, entao a
  // funcao continua reentrante.
  for (const match of text.matchAll(NUBANK_LAYOUT.moneyToken)) {
    const parsed = parseBRL(match[0]);
    if (parsed !== null) {
      found = { cents: parsed, index: match.index ?? 0, raw: match[0] };
    }
  }
  return found;
}

/**
 * Aplica a convencao de sinal do sistema. Ver `invertPrintedSign` na constante.
 * A compra sai negativa (saida) e o estorno positivo (entrada); o total impresso
 * segue a mesma regra, para bater com `reconcileStatement`.
 */
function toSystemAmount(printed: Cents): Cents {
  return NUBANK_LAYOUT.invertPrintedSign ? cents(-printed) : printed;
}

/** Texto da coluna de data (ou a linha inteira, quando a coluna nao existe). */
function dateSourceFor(row: PdfTextRow): string {
  const dateCells = cellsIn(row, NUBANK_LAYOUT.columns.date);
  return dateCells.length > 0 ? joinCells(dateCells) : row.text;
}

/** Data no inicio da coluna de data, ou `null`. */
function anchoredDate(row: PdfTextRow): DateMatch | null {
  return matchDate(dateSourceFor(row));
}

/** Linha dentro da area de transacao medida (§6.3). */
function inTransactionRegion(row: PdfTextRow): boolean {
  const { minY, maxY } = NUBANK_LAYOUT.transactionRegion;
  return row.y >= minY && row.y < maxY;
}

/** Menor `x` entre as celulas da linha, ou `null` quando a linha nao tem celula. */
function leftmostX(row: PdfTextRow): number | null {
  let min: number | null = null;
  for (const cell of row.cells) {
    if (min === null || cell.x < min) min = cell.x;
  }
  return min;
}

/**
 * Ano do cabecalho da fatura, ou `null`.
 *
 * So olha linhas **fora da area de transacao** (cabecalho/rodape) que contenham
 * um marcador de fatura/emissao/vencimento/periodo. Restringir ao cabecalho
 * evita que uma linha de continuacao com a palavra "fatura" e um `20xx` defina o
 * ano de todas as linhas — encontrar o ano errado e pior que nao encontrar,
 * porque o erro e silencioso.
 */
function headerYear(rows: PdfTextRow[]): number | null {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (inTransactionRegion(row)) continue;
    if (anchoredDate(row) !== null) continue;
    const lower = row.text.toLowerCase();
    if (!NUBANK_LAYOUT.yearMarkers.some((marker) => lower.includes(marker))) {
      continue;
    }
    const match = NUBANK_LAYOUT.yearToken.exec(row.text);
    if (match !== null) return Number(match[1]);
  }
  return null;
}

/** Ano resolvido na ordem cabecalho -> parametro -> `null`. Ver topo do arquivo. */
function resolveYear(
  rows: PdfTextRow[],
  opts: NubankPdfParseOptions | undefined,
): number | null {
  const fromHeader = headerYear(rows);
  if (fromHeader !== null) return fromHeader;

  const candidate = opts?.defaultYear;
  if (
    candidate !== undefined &&
    Number.isInteger(candidate) &&
    candidate >= 1000 &&
    candidate <= 9999
  ) {
    return candidate;
  }
  return null;
}

/** Valor da linha de total, lido da coluna de valor (ou da linha inteira). */
function rowAmount(row: PdfTextRow): Cents | null {
  const fromBand = joinCells(cellsIn(row, NUBANK_LAYOUT.columns.value));
  const found = findLastAmount(fromBand) ?? findLastAmount(row.text);
  return found === null ? null : found.cents;
}

/**
 * Descricao da transacao: as celulas da faixa de descricao, que cobre os dois x
 * medidos (185 sem cartao, 214 com cartao). A coluna de cartao fica de fora.
 */
function descriptionFor(row: PdfTextRow): string {
  return joinCells(cellsIn(row, NUBANK_LAYOUT.columns.description));
}

/**
 * Parseia as linhas de uma fatura Nubank de cartao.
 *
 * Devolve as transacoes em `rows`, os problemas de linha em `diagnostics` (nunca
 * abortando o arquivo) e o total impresso em `reportedTotalCents` — no mesmo
 * sinal do sistema (negativo), para `reconcileStatement` comparar.
 *
 * Linha sem data reconhecivel dentro da area de transacao e **continuacao** da
 * transacao anterior (§6.1, armadilha 3): o texto e anexado a ela, e a linha nao
 * vira lancamento. Cabecalho, rodape e propaganda ficam fora da area medida por
 * `y` e sao ignorados. Linha candidata (data ancorada) **sempre** vira
 * `ParsedRow`; o campo que nao foi lido volta como `null`, para o usuario
 * completar na confirmacao (CONTRACTS §15). Por isso `diagnostics` volta vazio:
 * a linha incompleta entra em `rows`, nao em `diagnostics`.
 */
export function parseNubankPdf(
  rows: PdfTextRow[],
  opts?: NubankPdfParseOptions,
): ParseResult {
  const parsedRows: ParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const year = resolveYear(rows, opts);
  let reportedTotalCents: Cents | null = null;
  let previous: ParsedRow | null = null;
  let currentPage: number | null = null;

  rows.forEach((row) => {
    const lower = row.text.toLowerCase();

    // Continuacao pertence a transacao imediatamente acima, na MESMA pagina.
    // Trocar de pagina (ou cair fora da area de transacao) zera a ancora, senao
    // um rodape no fim de uma pagina sem transacao se anexaria a ultima lida.
    if (row.page !== currentPage) {
      currentPage = row.page;
      previous = null;
    }

    if (NUBANK_LAYOUT.totalMarkers.some((marker) => lower.includes(marker))) {
      const total = rowAmount(row);
      if (total !== null) reportedTotalCents = toSystemAmount(total);
      previous = null;
      return;
    }

    if (NUBANK_LAYOUT.headerFooterMarkers.some((marker) => lower.includes(marker))) {
      previous = null;
      return;
    }

    // Fora da area medida de transacao: cabecalho, rodape ou propaganda.
    if (!inTransactionRegion(row)) {
      previous = null;
      return;
    }

    const dateMatch = anchoredDate(row);
    if (dateMatch === null) {
      // Continuacao da transacao anterior (§6.1, armadilha 3): anexa o texto,
      // nao cria lancamento e nao descarta a linha em silencio. So vale com
      // ancora valida: mesma pagina, acima do rodape (§6.3) e no x de
      // continuacao medido (`x=214`, nunca `185`).
      const prev = previous;
      const anchor = leftmostX(row);
      const isContinuation =
        prev !== null &&
        row.y > NUBANK_LAYOUT.footerTopY &&
        anchor !== null &&
        anchor >= NUBANK_LAYOUT.continuationMinX;
      if (isContinuation && row.text.trim() !== '') {
        prev.rawDescription = `${prev.rawDescription} ${row.text.trim()}`.trim();
      }
      return;
    }

    // Linha candidata a transacao (tem data ancorada) SEMPRE vira `ParsedRow`.
    // O que nao foi lido volta como `null` no campo — nunca sentinela, nunca
    // descartada (CONTRACTS §15, nulabilidade de `occurredOn`/`amountCents`).
    // `ParseDiagnostic` e o outro desfecho ("ou a linha entra em rows, ou ela
    // aparece aqui"), nunca os dois.
    const valueCells = cellsIn(row, NUBANK_LAYOUT.columns.value);
    const amountSource = valueCells.length > 0 ? joinCells(valueCells) : row.text;
    const amount = findLastAmount(amountSource) ?? findLastAmount(row.text);

    const rowYear = dateMatch.explicitYear ?? year;
    const occurredOn =
      rowYear === null ? null : buildIsoDate(rowYear, dateMatch.month, dateMatch.day);

    const rawDescription = descriptionFor(row);
    const detected = detectInstallment(rawDescription);

    const parsed: ParsedRow = {
      occurredOn,
      rawDescription,
      amountCents: amount === null ? null : toSystemAmount(amount.cents),
      fitId: null,
      installment:
        detected === null
          ? null
          : { current: detected.current, total: detected.total },
    };
    parsedRows.push(parsed);
    previous = parsed;
  });

  return { rows: parsedRows, diagnostics, reportedTotalCents };
}
