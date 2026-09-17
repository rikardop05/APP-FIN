/**
 * Parser de fatura Mercado Pago em PDF — CONTRACTS §15
 * (`parseMercadoPagoPdf`), T-117c.
 *
 * Recebe as linhas ja remontadas por `groupIntoRows` (nao le bytes nem
 * coordenada bruta) e devolve `ParseResult`. A extracao dos runs, a decifragem
 * AES-256 e a decodificacao pelo `ToUnicode` do arquivo sao infraestrutura
 * comum (`extract.ts`, T-117) — o que este arquivo tem de proprio e o
 * **mapeamento de colunas** da fatura Mercado Pago.
 *
 * ---
 *
 * ## Layout MEDIDO, nao suposto
 *
 * As faixas de `MERCADOPAGO_LAYOUT` vem da medicao de uma fatura real,
 * anonimizada e publicada pelo Orquestrador em `IMPORT-SOURCES.md` §7 (medicao
 * de 2026-09-16 sobre a fatura de 2026-07-20). O arquivo real vive em
 * `.private/` e nao e acessivel a este agente (RNF-01); a secao §7 e a forma
 * anonimizada — letra virou `A`, digito virou `9` — e por isso pode ser lida
 * aqui.
 *
 * | Coluna    | x medido  | Formato medido         |
 * |-----------|-----------|------------------------|
 * | Data      | `40`      | `99/99` (`dd/MM`)      |
 * | Descricao | `94`      | livre                  |
 * | Parcela   | `393–397` | `Parcela 1 de 12`      |
 * | Valor     | `507–518` | `R$ 999,99` (a direita)|
 *
 * O ano nao esta na linha: esta no cabecalho, `y=776`, `...: 99/99/9999`.
 *
 * ## As tres armadilhas da fatura real (§7), e como o codigo as trata
 *
 * 1. **A parcela tem coluna propria** (`x≈395`), ao contrario do Nubank, onde
 *    ela vem colada ao fim da descricao. A **extracao** vem dessa coluna; a
 *    **interpretacao** continua sendo `detectInstallment` (T-121) — este parser
 *    chama o detector, nao reimplementa.
 * 2. **A fatura agrupa por cartao.** Linhas `Cartao final [****9999]` em `x=40`
 *    abrem uma secao, e os lancamentos abaixo pertencem a ela. Uma fatura traz
 *    **varios cartoes**, e o `ParsedRow` do contrato **nao tem campo de
 *    cartao**. Ignorar a secao misturaria cartoes diferentes num so, sem o
 *    usuario perceber. Como nao ha campo proprio, a secao e preservada no unico
 *    campo livre que sobra: quando a fatura tem **mais de uma** secao, cada
 *    `rawDescription` recebe o prefixo `[final 9999]`. Numa fatura de um cartao
 *    so (o caso comum) nao ha mistura a evitar e a descricao sai intacta.
 *    Ver a nota "decisao de contrato" abaixo.
 * 3. **Linhas de subtotal se parecem com lancamento.** Tem a palavra `Total` na
 *    posicao da data (`x=40`) e um valor a direita, mas **nenhuma data**. Por
 *    isso a transacao so nasce de **data valida ancorada em `x=40`**: palavra
 *    naquela posicao e cabecalho ou subtotal, nunca lancamento. Essas linhas
 *    dobram o gasto do mes se entrarem como transacao.
 *
 * ## O ano e regra de dominio, nao detalhe
 *
 * A linha de transacao nao tem ano (`dd/MM`). A resolucao, nesta ordem:
 *
 * 1. **Cabecalho da fatura** (`y=776`, `Vencimento: dd/MM/yyyy`), lido das
 *    proprias linhas.
 * 2. **Parametro do chamador** (`opts.defaultYear`) — a tela sabe a competencia
 *    importada. **Nunca** do relogio: `Date` e proibido em `/lib`
 *    (CONVENTIONS §4) e "ano atual" quebra em silencio toda janeiro, quando se
 *    importa a fatura de dezembro.
 * 3. **Nada disso** — `occurredOn` volta `null` e a linha e preservada, para o
 *    usuario completar na tela de confirmacao (CONTRACTS §15: `null` = nao lido,
 *    nunca sentinela, nunca descartada).
 *
 * ## Decisao de contrato: a secao de cartao
 *
 * `ParsedRow` nao tem campo de cartao, e adicionar um seria mudanca de contrato
 * (ratificacao do Orquestrador, ver a nota do §15 sobre `lib/import/types.ts`).
 * O prefixo `[final 9999]` e a forma de **nao perder a informacao** dentro do
 * contrato atual: o usuario ve na tela de confirmacao a qual cartao cada
 * lancamento pertence, em vez de ver dois cartoes somados como se fossem um.
 * Se o contrato ganhar `cardLast4`, este prefixo sai e o campo passa a carregar
 * a informacao. **SUPOSICAO** de apresentacao, nao medida.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`. Toda
 * conta de calendario passa por `lib/date` (`clampDayToMonth`).
 */

import { clampDayToMonth, type IsoDate } from '@/lib/date';
import { detectInstallment } from '@/lib/import/installments';
import type { ParseDiagnostic, ParseResult, ParsedRow } from '@/lib/import/types';
import type { PdfTextRow } from '@/lib/import/pdf/rows';
import { cents, parseBRL, type Cents } from '@/lib/money';

/** Faixa horizontal `[minX, maxX)` em pontos. */
interface XBand {
  readonly minX: number;
  readonly maxX: number;
}

/**
 * Layout da fatura Mercado Pago. **Unico lugar do arquivo com geometria.**
 *
 * MEDIDO em fatura real de 2026-07-20 (6 paginas), medicao de 2026-09-16,
 * anonimizada em `IMPORT-SOURCES.md` §7. Nada aqui e suposicao de **coluna**; o
 * que for suposicao de dominio esta marcado `SUPOSICAO`.
 */
export const MERCADOPAGO_LAYOUT = {
  /** Data da medicao que originou estas faixas. Re-medir quando o layout mudar. */
  measuredOn: '2026-09-16',
  /** Fonte anonimizada das medidas. */
  measuredFrom: 'IMPORT-SOURCES.md §7 (fatura real de 2026-07-20)',

  /**
   * MEDIDO (§7): a coluna central `x` de cada campo. As **bordas** da faixa sao
   * derivadas das colunas medidas (data 40, descricao 94, parcela 393–397,
   * valor 507–518): cada campo tem folga suficiente para a variacao real, sem
   * invadir o vizinho. A parcela fica numa faixa propria, exatamente por ser
   * coluna separada e nao sufixo da descricao.
   */
  columns: {
    date: { minX: 20, maxX: 70 },
    description: { minX: 70, maxX: 360 },
    installment: { minX: 360, maxX: 460 },
    value: { minX: 460, maxX: 610 },
  } as Readonly<Record<'date' | 'description' | 'installment' | 'value', XBand>>,

  /**
   * MEDIDO (§7): a data da transacao e `dd/MM` com barra, ancorada no inicio da
   * celula.
   *
   * **SUPOSICAO** (nao medido pelo §7, achado 2 da revisao): aceitar tambem
   * `dd/MM/yyyy` na coluna de data. E conveniencia para layout que traga o ano
   * impresso na linha, nao um formato observado; uma linha de resumo/vencimento
   * com data completa ancorada em `x=40` seria lida como lancamento. O ano e
   * sempre validado por `lib/date` e a linha continua preservada, entao o custo
   * e uma linha a mais na confirmacao, nunca um lancamento silencioso.
   */
  datePattern: /^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/,

  /** Casa um texto que *tenta* ser data (`99/99`, `99.99`) mesmo que o mes nao exista. */
  dateLikePattern: /^\s*\d{1,2}\s*[/.]\s*\d{1,2}/,

  /** MEDIDO (§7): data completa do cabecalho, `dd/MM/yyyy`; o ano e o grupo 3. */
  fullDatePattern: /(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/,

  /**
   * MEDIDO (§7): `Cartao final [****9999]` abre uma secao de cartao. Asteriscos
   * e bullets entram porque a mascara anonimizada cobre o miolo do numero.
   */
  cardHeaderPattern: /[*•]{2,}\s*(\d{4})|\bfinal\b\s*\[?\s*(\d{4})/i,

  /**
   * MEDIDO (§7): o subtotal tem a palavra `Total` na posicao da data. Comparado
   * em minusculas por `includes`.
   */
  totalMarkers: ['total', 'subtotal'] as readonly string[],

  /**
   * MEDIDO (medicao do Orquestrador, 2026-09-16): o cabecalho de coluna
   * (`Data | Estabelecimento | Valor em R$`) nao tem data e **nao** e lancamento.
   * Literais especificos de proposito — "data" sozinho casaria descricao comum.
   */
  columnHeaderMarkers: ['estabelecimento', 'valor em r$'] as readonly string[],

  /**
   * MEDIDO (§7): o ano aparece no cabecalho (`Vencimento: dd/MM/yyyy`, `y=776`).
   * Restringir a busca a linhas **fora** da area de transacao e a marcadores
   * evita que um `20xx` solto numa descricao vire o ano de todas as linhas.
   */
  yearMarkers: [
    'vencimento',
    'emissão',
    'emissao',
    'fatura',
    'período',
    'periodo',
  ] as readonly string[],

  /**
   * MEDIDO (§7): o cabecalho esta em `y=776`. A area de transacao termina logo
   * abaixo dele. O piso `minY` e **SUPOSICAO**: o rodape de rodape nao foi
   * medido no §7; 30pt e um piso conservador que impede o numero de pagina de
   * virar continuacao da ultima transacao, e nao corta transacao real (elas
   * ficam no miolo da pagina).
   */
  transactionRegion: { minY: 30, maxY: 770 },

  /**
   * MEDIDO (§7): valor com `R$` e decimal com virgula (`A$ 999,99`), alinhado a
   * direita. Marcado como global para `matchAll`.
   */
  moneyToken: /-?\s*R\$\s*\d[\d.,]*|-?\d{1,3}(?:\.\d{3})*,\d{2}/g,

  /**
   * **SUPOSICAO** (nao coberto pela medicao §7): a fatura de cartao imprime a
   * compra sem sinal e o estorno/pagamento com `-`. Pela convencao do sistema
   * (CONVENTIONS §2, saida negativa), o sinal impresso e invertido — a mesma
   * leitura que o parser Nubank adotou para a mesma categoria de documento.
   */
  invertPrintedSign: true,
} as const;

/** Opcoes do parser. Ver a decisao sobre o ano no topo do arquivo. */
export interface MercadoPagoPdfParseOptions {
  /**
   * Ano a usar quando a linha nao traz ano e o cabecalho tambem nao. Deve vir do
   * chamador (competencia escolhida na tela), **nunca** do relogio.
   */
  defaultYear?: number;
}

/**
 * Ano **apenas de validacao**, usado para checar mes/dia quando o ano real e
 * desconhecido (bissexto, para nao recusar 29/02 por engano). Nunca vai para
 * `occurredOn` — sem ano, a data sai incompleta.
 */
const PLACEHOLDER_VALIDATION_YEAR = 2024;

/** Data reconhecida em uma linha, com o ano apenas se ele veio impresso. */
interface DateMatch {
  day: number;
  month: number;
  /** Ano impresso na propria linha, ou `null` quando a linha nao o traz. */
  explicitYear: number | null;
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

/** `aa` vira `20aa`; `aaaa` e validado. Qualquer outra coisa e `null`. */
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

/**
 * Casa a data ancorada no inicio da celula de data. Devolve a data mesmo quando
 * o **mes** e invalido (`99/99`), para o chamador decidir entre linha
 * incompleta e cabecalho; a validacao de calendario fica com `buildIsoDate`.
 */
function matchDate(text: string): DateMatch | null {
  const match = MERCADOPAGO_LAYOUT.datePattern.exec(text);
  if (match === null) return null;
  return {
    day: Number(match[1] ?? ''),
    month: Number(match[2] ?? ''),
    explicitYear: normalizeYear(match[3]),
  };
}

/** Ultimo valor monetario de um texto, com a posicao onde ele comeca. */
function findLastAmount(text: string): { cents: Cents; index: number } | null {
  let found: { cents: Cents; index: number } | null = null;
  // `matchAll` clona o regex: o `lastIndex` do modulo nao e tocado, entao a
  // funcao continua reentrante.
  for (const match of text.matchAll(MERCADOPAGO_LAYOUT.moneyToken)) {
    const parsed = parseBRL(match[0]);
    if (parsed !== null) found = { cents: parsed, index: match.index ?? 0 };
  }
  return found;
}

/**
 * Aplica a convencao de sinal do sistema. Ver `invertPrintedSign` na constante:
 * a compra sai negativa (saida) e o estorno positivo (entrada).
 */
function toSystemAmount(printed: Cents): Cents {
  return MERCADOPAGO_LAYOUT.invertPrintedSign ? cents(-printed) : printed;
}

/** Valor da linha, lido da coluna de valor (ou da linha inteira como fallback). */
function rowAmount(row: PdfTextRow): Cents | null {
  const fromBand = joinCells(cellsIn(row, MERCADOPAGO_LAYOUT.columns.value));
  const found = findLastAmount(fromBand) ?? findLastAmount(row.text);
  return found === null ? null : found.cents;
}

/** Digitos do cartao de uma linha de secao (`Cartao final [****9999]`), ou `null`. */
function matchCardDigits(text: string): string | null {
  const match = MERCADOPAGO_LAYOUT.cardHeaderPattern.exec(text);
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

/** Linha dentro da area de transacao medida. Fora dela e cabecalho ou rodape. */
function inTransactionRegion(row: PdfTextRow): boolean {
  const { minY, maxY } = MERCADOPAGO_LAYOUT.transactionRegion;
  return row.y >= minY && row.y < maxY;
}

/** Texto da coluna de data da linha. */
function dateCellOf(row: PdfTextRow): string {
  return joinCells(cellsIn(row, MERCADOPAGO_LAYOUT.columns.date));
}

/** Texto da coluna de descricao da linha. */
function descriptionFor(row: PdfTextRow): string {
  return joinCells(cellsIn(row, MERCADOPAGO_LAYOUT.columns.description));
}

/** Texto da coluna propria de parcela da linha (§7, armadilha 1). */
function installmentFor(row: PdfTextRow): string {
  return joinCells(cellsIn(row, MERCADOPAGO_LAYOUT.columns.installment));
}

/**
 * Ano do cabecalho da fatura, ou `null`.
 *
 * So olha linhas **fora da area de transacao** e com um marcador de
 * fatura/vencimento/periodo. Uma descricao que contenha "fatura" e um `20xx` nao
 * define o ano de todas as linhas — encontrar o ano errado e pior que nao
 * encontrar, porque o erro e silencioso.
 */
function headerYear(rows: PdfTextRow[]): number | null {
  for (const row of rows) {
    if (inTransactionRegion(row)) continue;
    const lower = row.text.toLowerCase();
    if (!MERCADOPAGO_LAYOUT.yearMarkers.some((marker) => lower.includes(marker))) {
      continue;
    }
    const match = MERCADOPAGO_LAYOUT.fullDatePattern.exec(row.text);
    if (match !== null) return Number(match[3]);
  }
  return null;
}

/** Ano resolvido na ordem cabecalho -> parametro -> `null`. Ver topo do arquivo. */
function resolveYear(
  rows: PdfTextRow[],
  opts: MercadoPagoPdfParseOptions | undefined,
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

/** Secoes de cartao distintas da fatura, na ordem de aparicao. */
function collectCardDigits(rows: PdfTextRow[]): Set<string> {
  const found = new Set<string>();
  for (const row of rows) {
    const digits = matchCardDigits(dateCellOf(row));
    if (digits !== null) found.add(digits);
  }
  return found;
}

/**
 * Parseia as linhas de uma fatura Mercado Pago de cartao.
 *
 * Devolve as transacoes em `rows`, os problemas de linha em `diagnostics` (nunca
 * abortando o arquivo) e o total impresso em `reportedTotalCents`.
 *
 * As tres armadilhas de §7 estao tratadas: a parcela vem da coluna propria; as
 * secoes de cartao sao preservadas no prefixo de `rawDescription` quando ha mais
 * de um cartao; e subtotal/cabecalho (palavra na posicao da data) nao viram
 * transacao. Linha candidata **sempre** vira `ParsedRow`; o campo que nao foi
 * lido volta como `null` (CONTRACTS §15), nunca sentinela.
 *
 * **Nao ha linha de continuacao no Mercado Pago** (medicao do Orquestrador,
 * 2026-09-16): toda linha com descricao tem data em `x=40`; as unicas linhas sem
 * data sao cabecalho de coluna (`Data Estabelecimento Valor em R$`) e subtotal.
 * Continuacao e caracteristica do layout do Nubank (§6.1, armadilha 3), nao
 * deste — inventar aqui exigiria anexar texto a uma transacao sem que exista o
 * conceito. O que ha e uma **defesa**: linha sem data que nao seja cabecalho
 * previsto vira `ParseDiagnostic`, nunca some em silencio.
 *
 * `reportedTotalCents` so e preenchido com **um unico** subtotal identificado:
 * com dois ou mais (uma fatura de varios cartoes), nao ha como saber qual e o
 * total do documento, e escolher um seria inventar. Fica `null`.
 */
export function parseMercadoPagoPdf(
  rows: PdfTextRow[],
  opts?: MercadoPagoPdfParseOptions,
): ParseResult {
  const parsedRows: ParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  const cards = collectCardDigits(rows);
  const multiCard = cards.size > 1;
  const year = resolveYear(rows, opts);
  const totals: Cents[] = [];

  let currentCard: string | null = null;

  rows.forEach((row, index) => {
    const dateCell = dateCellOf(row);
    if (dateCell !== '') {
      // Armadilha 2 (§7): o cabecalho de secao abre o cartao corrente.
      const cardDigits = matchCardDigits(dateCell);
      if (cardDigits !== null) {
        currentCard = cardDigits;
        return;
      }

      // A data tem precedencia sobre a palavra `Total` (achado 3 da revisao): se
      // data e descricao vierem no mesmo run (layout que este banco pode adotar),
      // uma descricao com "total" nao pode engolir um lancamento valido.
      if (!MERCADOPAGO_LAYOUT.dateLikePattern.test(dateCell)) {
        // Armadilha 3 (§7): palavra `Total` na posicao da data. Nao e lancamento.
        const lower = dateCell.toLowerCase();
        if (MERCADOPAGO_LAYOUT.totalMarkers.some((marker) => lower.includes(marker))) {
          const amount = rowAmount(row);
          if (amount !== null) totals.push(amount);
          return;
        }
        // Palavra na posicao da data e cabecalho, nunca lancamento (§7).
        return;
      }

      const dateMatch = matchDate(dateCell);
      const rowYear = dateMatch?.explicitYear ?? year;

      // Ano so para validar o par mes/dia quando o ano real e desconhecido
      // (bissexto, para 29/02 nao ser recusado por engano). **Nunca** entra em
      // `occurredOn`: sem ano a data fica incompleta, nao fica datada.
      const validationYear = rowYear ?? PLACEHOLDER_VALIDATION_YEAR;
      const iso =
        dateMatch === null
          ? null
          : buildIsoDate(validationYear, dateMatch.month, dateMatch.day);

      // Data que tenta existir e nao fecha (`31/02`, `99/99`) vira diagnostico, e
      // a linha continua em `rows` com `occurredOn` null — nunca engolida.
      const invalidDate = iso === null;
      if (invalidDate) {
        diagnostics.push({
          line: index + 1,
          message: `Data inválida nesta linha: "${dateCell}". Confira na tela de confirmação.`,
          raw: row.text,
        });
      }

      // Com ano real, a data resolve; sem ano, fica incompleta (null) sem ser
      // invalida — ordem cabecalho -> parametro -> linha para o usuario completar.
      const occurredOn: IsoDate | null = iso !== null && rowYear !== null ? iso : null;

      const description = descriptionFor(row);
      const installmentText = installmentFor(row);
      const detected =
        detectInstallment(installmentText) ?? detectInstallment(description);
      const amount = rowAmount(row);

      const parsed: ParsedRow = {
        occurredOn,
        // Com mais de um cartao, todo lancamento recebe a secao. Lancamento
        // impresso antes da primeira secao (ou com o cabecalho nao reconhecido)
        // sai como `[final ?]`: fica visivel que nao foi atribuido, em vez de se
        // misturar aos de outro cartao (achado 3 da revisao).
        rawDescription: multiCard
          ? `[final ${currentCard ?? '?'}] ${description}`.trim()
          : description,
        amountCents: amount === null ? null : toSystemAmount(amount),
        fitId: null,
        installment:
          detected === null
            ? null
            : { current: detected.current, total: detected.total },
      };
      parsedRows.push(parsed);
      return;
    }

    // Sem celula na coluna de data. No Mercado Pago isso e cabecalho de coluna
    // ou rodape — nunca continuacao (nao existe nesse layout). Linha inesperada
    // dentro da area de transacao vira diagnostico: pode ser um lancamento que o
    // mapeamento futuro nao previu, e sumir em silencio e o unico desfecho proibido.
    if (row.text.trim() === '') return;

    const lowerText = row.text.toLowerCase();
    if (MERCADOPAGO_LAYOUT.columnHeaderMarkers.some((marker) => lowerText.includes(marker))) {
      return;
    }
    if (!inTransactionRegion(row)) return;

    diagnostics.push({
      line: index + 1,
      message:
        'Linha sem data reconhecida não virou lançamento. Confira se é um lançamento e inclua manualmente.',
      raw: row.text,
    });
  });

  // Com 2+ cartoes, um subtotal e de UM cartao, nunca do documento: mesmo que so
  // um seja reconhecido, usa-lo como total acusaria divergencia falsa no
  // reconcileStatement (achado 1 da revisao). So com um cartao e um unico
  // subtotal o valor pode ser o total do documento.
  const reportedTotalCents =
    cards.size > 1 || totals.length !== 1 || totals[0] === undefined
      ? null
      : toSystemAmount(totals[0]);

  return { rows: parsedRows, diagnostics, reportedTotalCents };
}
