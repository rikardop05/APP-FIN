/**
 * Parser de texto colado — CONTRACTS §15 (`parsePastedText`), T-119.
 *
 * E o **fallback universal** da v1: quando o PDF nao cede, quando o CSV/XLSX
 * esta adiado (T-105/T-118) ou quando o banco e desconhecido, o usuario abre o
 * arquivo, copia o conteudo e cola aqui. A heuristica interpreta o que consegue;
 * o que ela nao entende vira uma linha **editavel** na tela de confirmacao
 * (RF-IMP-07, CONTRACTS §16). Nao existe caminho "fora de escopo".
 *
 * A regra que define a tarefa: **nenhuma linha e descartada em silencio**
 * (ORCHESTRATION §5). O silencio e o pior defeito possivel — o humano perde um
 * lancamento e nunca fica sabendo. Por isso este parser **nunca** joga linha
 * fora:
 *
 * - toda linha com conteudo vira uma `TextParsedRow`, mesmo que so tenha ruido;
 * - o que faltou (data, valor, descricao) fica registrado em `missing`;
 * - o texto original fica em `sourceLine`, para a tela mostrar ao lado da
 *   linha em branco;
 * - `confidence: 'low'` sinaliza o que o usuario precisa conferir.
 *
 * ---
 *
 * ## Heuristica por linha
 *
 * 1. **Token de data** — o primeiro candidato valido da linha (ver §formatos).
 * 2. **Token de valor** — o **ultimo** numero da linha que `parseBRL` aceita.
 * 3. **Descricao** — o que sobra depois de retirar data e valor.
 *
 * ## Formatos de data aceitos
 *
 * `dd/mm`, `dd/mm/aaaa`, `dd-mm-aaaa`, `dd mmm [aaaa]` (nome do mes em pt-BR,
 * abreviado ou por extenso) e `aaaa-mm-dd`. `dateOrder` (default `'dmy'`)
 * escolhe a leitura dos grupos no formato numerico de duas/três partes. Data
 * **sem ano** usa o ano de `defaultCompetence`; sem ela, a data nao fecha e a
 * linha volta com `missing: ['date']` — nunca com um ano inventado.
 *
 * `dd/mm/aa` (ano de dois digitos) **nao** e aceito de proposito: nao da para
 * decidir o seculo sem ler o relogio, e um ano errado num lancamento e pior que
 * um campo em branco. A linha cai em `missing: ['date']` e o usuario completa.
 *
 * ## `N/M` ambiguo: parcela ou data
 *
 * `detectInstallment` (T-121) decide se um `N/M` sem ano fecha como parcela.
 * Quando a linha tem **outra** data, o `N/M` fica como parcela e a data real e
 * consumida. Quando o `N/M` e o **unico** candidato a data, ele e tratado como
 * **data** — decisao assimetrica: errar para data custa ao usuario marcar o
 * parcelamento a mao (recuperavel); errar para parcela deixa a linha **sem
 * data** e projeta `M` meses de despesa que talvez nao exista, e o
 * `buildImportPreview` (T-107) fica sem `occurredOn` para desempatar. A linha
 * sai com `confidence: 'low'` e `sourceLine` intacto, para o usuario conferir.
 * **REVISAVEL**: e heuristica, nao regra de dominio fechada; se uma fatura real
 * mostrar o contrario, reabre.
 *
 * ## Sinal do valor
 *
 * O sinal e **literal**, como `parseBRL` o le (CONVENTIONS §2 preserva o sinal
 * recebido). O parser de texto nao tem como saber se a origem e fatura (compra
 * positiva) ou extrato (saida negativa) — `TextParseOptions` nao traz
 * `sourceKind`, e por isso nao ha inversao automatica. Sinais em posicao
 * incomum sao normalizados: `-R$ 1.234,56`, `R$ -1.234,56` e `1.234,56-`
 * (sinal a direita) resultam todos em centavos negativos.
 *
 * ## Linha corrompida vira `diagnostic`
 *
 * Quando a linha traz um candidato a data que nao existe no calendario
 * (`31/02/2026`) ou um candidato a valor que nao fecha (`12,345`), ela **tambem**
 * gera um `ParseDiagnostic`, com a mensagem em pt-BR. O lote nao aborta: a linha
 * continua em `rows` com `confidence: 'low'`, e as demais seguem sendo lidas
 * (ORCHESTRATION §5: "linha corrompida vira `diagnostic`, nao aborta o arquivo").
 *
 * ## Campos ausentes: `null`, nunca sentinela
 *
 * `ParsedRow.occurredOn` e `amountCents` sao anulaveis (CONTRACTS §15, fixado em
 * 2026-09-16 a partir do achado deste T-119): quando a linha nao tem data ou
 * valor, o parser devolve `null` nesses campos, **junto com** `missing`
 * preenchido. Nao ha sentinela: `cents(0)` e um valor legitimo (uma compra de
 * R$ 0,00 existe) e `''` nao e `IsoDate`. Com `null`, o compilador obriga a
 * tela de confirmacao a tratar a linha incompleta antes de gravar — que e o que
 * a RF-IMP-02 exige. `missing` e `sourceLine` continuam sendo a explicacao que a
 * tela mostra ao usuario.
 *
 * ## Linhas em branco
 *
 * Linha vazia ou so com espacos e separador, nao lancamento: e ignorada. Manter
 * uma linha fantasma por quebra de linha do PDF encheria a tela de confirmacao
 * de lixo. "Nenhuma linha descartada" vale para linha com conteudo.
 *
 * Modulo puro (CONVENTIONS §5): recebe `string`, devolve dados. Nao importa
 * `/lib/db`, `next/*`, `fs`, `fetch`, nao le `process.env` e nao le relogio.
 * Aritmetica de calendario vive em `lib/date` (CONVENTIONS §4).
 */

import { clampDayToMonth, competenceStart } from '@/lib/date';
import type { Competence, IsoDate } from '@/lib/date';
import { parseBRL } from '@/lib/money';
import type { Cents } from '@/lib/money';
import { detectInstallment } from '@/lib/import/installments';
import type { ParseDiagnostic, ParseResult, ParsedRow } from '@/lib/import/types';

/** Nivel de confianca do parse de uma linha. Ver as regras em `parsePastedText`. */
export type ParseConfidence = 'high' | 'medium' | 'low';

/** Opcoes de `parsePastedText`. */
export interface TextParseOptions {
  /** Competencia (`'YYYY-MM'`) da qual sai o ano de uma data sem ano. */
  defaultCompetence?: Competence;
  /** Ordem dos grupos do formato numerico. Default `'dmy'` (pt-BR). */
  dateOrder?: 'dmy' | 'mdy' | 'ymd';
}

/** Uma linha colada, com o que o parser conseguiu e o que faltou. */
export interface TextParsedRow extends ParsedRow {
  confidence: ParseConfidence;
  /** Linha original, sem o terminador. Sempre preservada. */
  sourceLine: string;
  /** Campos que o parser nao conseguiu preencher. Vazio quando a linha esta completa. */
  missing: ('date' | 'amount' | 'description')[];
}

/** Campo cuja ausencia e registrada em `missing`. */
type MissingField = 'date' | 'amount' | 'description';

/**
 * Data ISO ja validada contra o calendario. O `aaaa-mm-dd` e a forma que
 * `lib/date` consome, e a validacao usa `clampDayToMonth` para nao construir
 * calendario fora de `lib/date`.
 */
const ISO_DATE = /(?<![\d/.\-])(\d{4})-(\d{2})-(\d{2})(?![\d/.\-])/g;

/** `dd/mm/aaaa`, `dd-mm-aaaa`. Ver `dateOrder` para a leitura dos grupos. */
const DAY_MONTH_YEAR = /(?<![\d/.\-])(\d{1,2})([/-])(\d{1,2})\2(\d{4})(?![\d/.\-])/g;

/**
 * `aaaa/mm/dd`: mesma data do ISO com barra. Reconhecida sempre — e
 * inequivoca como o `aaaa-mm-dd`, entao nao depende de `dateOrder`. (Achado 4
 * da revisao: `dateOrder: 'ymd'` nao pode so conhecer a forma com hifen.)
 */
const ISO_DATE_SLASH = /(?<![\d/.\-])(\d{4})\/(\d{2})\/(\d{2})(?![\d/.\-])/g;

/**
 * `dd/mm`, sem ano. So com `/`: um `dd-mm` solto e mais parecido com intervalo
 * de parcelas que com data, e data em fuso pt-BR se escreve com barra.
 */
const DAY_MONTH = /(?<![\d/.\-])(\d{1,2})\/(\d{1,2})(?![\d/.\-])/g;

/** Nomes de mes em pt-BR, abreviados e por extenso, com a variante sem cedilha. */
const MONTH_NAMES: readonly (readonly [string, number])[] = [
  ['janeiro', 1],
  ['fevereiro', 2],
  ['marco', 3],
  ['março', 3],
  ['abril', 4],
  ['maio', 5],
  ['junho', 6],
  ['julho', 7],
  ['agosto', 8],
  ['setembro', 9],
  ['outubro', 10],
  ['novembro', 11],
  ['dezembro', 12],
  ['jan', 1],
  ['fev', 2],
  ['mar', 3],
  ['abr', 4],
  ['mai', 5],
  ['jun', 6],
  ['jul', 7],
  ['ago', 8],
  ['set', 9],
  ['out', 10],
  ['nov', 11],
  ['dez', 12],
];

const MONTH_BY_NAME: Record<string, number> = Object.fromEntries(MONTH_NAMES);

/**
 * Alternacao ordenada do nome mais longo para o mais curto. Ordem por tamanho
 * nao basta sozinha: `mar` casa dentro de `março`, mas o lookahead
 * `(?![\\p{L}\\d/.-])` rejeita a continuacao acentuada e forca o retrocesso ate
 * o nome inteiro.
 */
const MONTH_ALTERNATION = MONTH_NAMES.map(([name]) => name)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * `dd mmm [aaaa]`, com `de`/`/`/`-`/`.` como separador opcional
 * (`10 set`, `10/set`, `10 de setembro de 2026`). O `u` habilita `\p{L}` no
 * lookahead final, que impede `mar` casar dentro de `março`.
 */
const NAMED_DATE = new RegExp(
  `(?<![\\d/.\-])(\\d{1,2})\\s*(?:de\\s+|[./-]\\s*)?(${MONTH_ALTERNATION})\\.?(?:\\s*(?:de\\s+|[./-]\\s*)?(\\d{4}))?(?![\\p{L}\\d/.\-])`,
  'giu',
);

/**
 * Candidato a valor: sinal e `R$` opcionais em qualquer ordem, digitos com
 * `.`/`,` e sinal a direita opcional (`1.234,56-`). Cobre `-R$ 1.234,56` e
 * `R$ -1.234,56`, que `parseBRL` ja le. O numero **termina em digito**
 * (`\d(?:[\d.,]*\d)?`): sem isso, a pontuacao da frase entrava no token e
 * `R$ 50,00.` virava valor ilegivel — linha valida acusada de corrompida
 * (achado 3 da revisao). As bordas `(?<!\w)`/`(?!\w)` impedem que `123` de
 * `ABC123` vire valor.
 */
const VALUE_TOKEN = /(?<![\w])[+-]?(?:R\$\s*)?[+-]?\d(?:[\d.,]*\d)?-?(?![\w])/g;

/**
 * Palavra-chave de parcela imediatamente antes do numero. Um `03/10` depois de
 * `PARC`/`PARCELA` e parcela, nao data — e escolher a parcela como data
 * deslocaria a compra para o mes errado.
 */
const PARCEL_BEFORE = /\bparc(?:elas|ela)?\.?\s*(?:n[.º°o]?\s*)?(?:de\s+)?[([\s.\-]*$/i;

/**
 * Guardas do par por extenso `N de M`, para nao confundir seus numeros com o
 * valor da linha. `de` sozinho nao basta: `PAGAMENTO DE 100,00` tem um `de`
 * legitimo antes do valor. O que caracteriza parcela e um numero de um ou dois
 * digitos de cada lado — `3 DE 10` —, nao a preposicao solta.
 */
const DE_TOTAL_BEFORE = /(?<!\d)\d{1,2}\s*de\s*$/i;
const DE_CURRENT_AFTER = /^\s*de\s+\d{1,2}(?!\d)/i;

/** Candidato a data localizado, antes da validacao de calendario. */
interface DateCandidate {
  start: number;
  end: number;
  raw: string;
  /** `null` quando a forma nao traz ano (`dd/mm`, `dd mmm`). */
  year: number | null;
  month: number;
  day: number;
  /** Nome do mes: a ambiguidade parcela × data nunca se aplica a ele. */
  named: boolean;
}

/** O que foi lido numa linha e o que faltou. */
interface ParsedLine {
  date: { iso: IsoDate; start: number; end: number; inferredYear: boolean } | null;
  amount: { value: Cents; start: number; end: number } | null;
  description: string;
  /** Diagnostico especifico desta linha, quando a linha esta corrompida. */
  diagnostic: { message: string } | null;
  /**
   * A data veio de um `N/M` ambiguo (unico candidato da linha): poderia ser
   * parcela. Rebaixa a confianca para o usuario conferir. Ver a secao
   * "`N/M` ambiguo: parcela ou data" no topo. **REVISAVEL**.
   */
  ambiguousDate: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Zera um trecho da linha mantendo os indices, para separar descricao de valor. */
function blankSpan(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/**
 * Limpa a descricao sem inventar texto: colapsa espaco, remove os envoltorios
 * que ficaram vazios quando o numero saiu (`LOJA (50,00)` -> `LOJA`), e tira
 * pontuacao solta das pontas (`... R$ 50,00.` -> sem o ponto). `sourceLine`
 * guarda o original intacto. (Achados 3 e 5 da revisao.)
 */
const EDGE_NOISE = /^[\s\-–—•|,;:/.]+|[\s\-–—•|,;:/.]+$/g;

function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_NOISE, '')
    .trim();
}

/** Divide em linhas fisicas, cobrindo CRLF, CR e LF, e conta a partir de 1. */
function splitLines(raw: string): string[] {
  return raw.split(/\r\n|\r|\n/);
}

/**
 * Monta o `aaaa-mm-dd` validando o calendario via `lib/date`. `clampDayToMonth`
 * so normaliza dia fora do mes (31/02 -> 28/02); se o resultado difere do que
 * foi pedido, a data nao existe e o candidato e rejeitado.
 */
function buildIsoDate(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    return null;
  }
  const iso = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  try {
    return clampDayToMonth(year, month, day) === iso ? iso : null;
  } catch {
    // Ano fora da faixa suportada por lib/date: nao e data valida.
    return null;
  }
}

/** Todos os candidatos a data da linha, ordenados pela posicao. */
function collectDateCandidates(line: string, order: 'dmy' | 'mdy' | 'ymd'): DateCandidate[] {
  const found: DateCandidate[] = [];

  for (const match of line.matchAll(ISO_DATE)) {
    const start = match.index;
    found.push({
      start,
      end: start + (match[0] ?? '').length,
      raw: match[0] ?? '',
      year: Number(match[1] ?? ''),
      month: Number(match[2] ?? ''),
      day: Number(match[3] ?? ''),
      named: false,
    });
  }

  for (const match of line.matchAll(ISO_DATE_SLASH)) {
    const start = match.index;
    found.push({
      start,
      end: start + (match[0] ?? '').length,
      raw: match[0] ?? '',
      year: Number(match[1] ?? ''),
      month: Number(match[2] ?? ''),
      day: Number(match[3] ?? ''),
      named: false,
    });
  }

  if (order !== 'ymd') {
    for (const match of line.matchAll(DAY_MONTH_YEAR)) {
      const first = Number(match[1] ?? '');
      const second = Number(match[3] ?? '');
      const start = match.index;
      found.push({
        start,
        end: start + (match[0] ?? '').length,
        raw: match[0] ?? '',
        year: Number(match[4] ?? ''),
        month: order === 'mdy' ? first : second,
        day: order === 'mdy' ? second : first,
        named: false,
      });
    }

    for (const match of line.matchAll(DAY_MONTH)) {
      const first = Number(match[1] ?? '');
      const second = Number(match[2] ?? '');
      const start = match.index;
      found.push({
        start,
        end: start + (match[0] ?? '').length,
        raw: match[0] ?? '',
        year: null,
        month: order === 'mdy' ? first : second,
        day: order === 'mdy' ? second : first,
        named: false,
      });
    }
  }

  for (const match of line.matchAll(NAMED_DATE)) {
    const month = MONTH_BY_NAME[(match[2] ?? '').toLowerCase()];
    if (month === undefined) continue;
    const yearRaw = match[3];
    const start = match.index;
    found.push({
      start,
      end: start + (match[0] ?? '').length,
      raw: match[0] ?? '',
      year: yearRaw === undefined ? null : Number(yearRaw),
      month,
      day: Number(match[1] ?? ''),
      named: true,
    });
  }

  return found.sort((a, b) => a.start - b.start);
}

/** `03/10` precedido de `PARC`/`PARCELA` e parcela, nao data. */
function isParcelMarker(line: string, index: number): boolean {
  return PARCEL_BEFORE.test(line.slice(0, index));
}

/**
 * Escolhe a data da linha: o primeiro candidato valido, na ordem em que aparece.
 * Candidato invalido e pulado para tentar o proximo; so vira diagnostico se
 * nenhum candidato da linha fechar.
 */
function readDate(
  line: string,
  order: 'dmy' | 'mdy' | 'ymd',
  defaultYear: number | null,
): {
  date: ParsedLine['date'];
  diagnostic: ParsedLine['diagnostic'];
  ambiguous: boolean;
} {
  let problem: { raw: string; kind: 'invalid' | 'yearless' } | null = null;
  // Primeiro `N/M` sem ano que fechou como parcela. So vira data no fallback,
  // se nenhuma data "segura" aparecer na linha.
  let ambiguousFallback: DateCandidate | null = null;

  for (const candidate of collectDateCandidates(line, order)) {
    if (!candidate.named && isParcelMarker(line, candidate.start)) continue;

    // `N/M` sem ano e ambiguo: pode ser parcela ou data. `detectInstallment`
    // (T-121) decide — `10/09` (dia > mes) nao fecha como parcela e e data;
    // `03/10` fecha. Nao consumimos aqui ainda: guardamos para o fallback, para
    // nao roubar a data quando houver uma data "segura" mais adiante.
    if (
      !candidate.named &&
      candidate.year === null &&
      detectInstallment(candidate.raw) !== null
    ) {
      ambiguousFallback ??= candidate;
      continue;
    }

    const year = candidate.year ?? defaultYear;
    if (year === null) {
      problem ??= { raw: candidate.raw, kind: 'yearless' };
      continue;
    }

    const iso = buildIsoDate(year, candidate.month, candidate.day);
    if (iso === null) {
      problem ??= { raw: candidate.raw, kind: 'invalid' };
      continue;
    }

    return {
      date: {
        iso,
        start: candidate.start,
        end: candidate.end,
        inferredYear: candidate.year === null,
      },
      diagnostic: null,
      ambiguous: false,
    };
  }

  // Nenhuma data "segura" na linha. Se o unico candidato era um `N/M` ambiguo,
  // trate-o como DATA (ver o topo do arquivo): errar para data e recuperavel;
  // errar para parcela deixa a linha sem data e projeta `M` meses de despesa
  // que talvez nao exista. **REVISAVEL**.
  if (ambiguousFallback !== null) {
    const year = ambiguousFallback.year ?? defaultYear;
    const iso =
      year === null ? null : buildIsoDate(year, ambiguousFallback.month, ambiguousFallback.day);
    if (iso !== null) {
      return {
        date: {
          iso,
          start: ambiguousFallback.start,
          end: ambiguousFallback.end,
          inferredYear: ambiguousFallback.year === null,
        },
        diagnostic: null,
        ambiguous: true,
      };
    }
    problem ??= {
      raw: ambiguousFallback.raw,
      kind: year === null ? 'yearless' : 'invalid',
    };
  }

  if (problem === null) return { date: null, diagnostic: null, ambiguous: false };

  const message =
    problem.kind === 'invalid'
      ? `Data inválida nesta linha: "${problem.raw}". Confira a data na tela de confirmação.`
      : `A data "${problem.raw}" não tem ano e nenhuma competência padrão foi informada.`;
  return { date: null, diagnostic: { message }, ambiguous: false };
}

/** Sinal a direita (`1.234,56-`) vira sinal a esquerda, que `parseBRL` entende. */
function normalizeValueToken(token: string): string {
  if (token.endsWith('-') && !token.startsWith('-')) {
    return `-${token.slice(0, -1)}`;
  }
  return token;
}

/**
 * Le o valor da linha: o ultimo numero que `parseBRL` aceita. Candidatos que
 * fazem parte de uma parcela — colados a uma barra (`03/10`) ou ao par por
 * extenso (`3 de 10`) — sao ignorados: sao numeros de parcelamento, nao valor.
 * O candidato escolhido que nao parseia vira diagnostico de linha corrompida, e
 * nao se tenta um numero anterior: pegar o valor errado em silencio e pior que
 * deixar o campo em branco.
 */
function readAmount(masked: string): {
  amount: ParsedLine['amount'];
  malformed: string | null;
} {
  const matches = [...masked.matchAll(VALUE_TOKEN)];

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    if (match === undefined) continue;

    const start = match.index;
    const token = match[0] ?? '';
    const end = start + token.length;
    const before = masked.slice(0, start);
    const after = masked.slice(end);

    // Numero colado a barra pertence a um par `N/M`.
    if (masked.charAt(start - 1) === '/' || masked.charAt(end) === '/') continue;
    // `N de M` por extenso: o `M` tem um numero antes do `de`.
    if (DE_TOTAL_BEFORE.test(before)) continue;
    // `N de M` por extenso: o `N` tem `de` e um numero depois.
    if (DE_CURRENT_AFTER.test(after)) continue;

    const value = parseBRL(normalizeValueToken(token));
    if (value !== null) return { amount: { value, start, end }, malformed: null };
    return { amount: null, malformed: token };
  }

  return { amount: null, malformed: null };
}

/** Roda a heuristica de uma linha. Ver o cabecalho do arquivo. */
function parseLine(
  line: string,
  order: 'dmy' | 'mdy' | 'ymd',
  defaultYear: number | null,
): ParsedLine {
  const dateResult = readDate(line, order, defaultYear);

  let masked = line;
  if (dateResult.date !== null) {
    masked = blankSpan(masked, dateResult.date.start, dateResult.date.end);
  }
  const amountResult = readAmount(masked);

  let description = masked;
  if (amountResult.amount !== null) {
    description = blankSpan(description, amountResult.amount.start, amountResult.amount.end);
  }

  let diagnostic: ParsedLine['diagnostic'] = dateResult.diagnostic;
  if (diagnostic === null && amountResult.malformed !== null) {
    diagnostic = {
      message: `Valor não reconhecido nesta linha: "${amountResult.malformed}".`,
    };
  }

  return {
    date: dateResult.date,
    amount: amountResult.amount,
    description: tidy(description),
    diagnostic,
    ambiguousDate: dateResult.ambiguous,
  };
}

/**
 * Parser heuristico de texto colado — CONTRACTS §15.
 *
 * Linha que rende data+valor+descricao sai com `confidence: 'high'`; data sem
 * ano (preenchida por `defaultCompetence`) ou descricao ausente rebaixam para
 * `'medium'`; linha sem data ou sem valor sai com `'low'`, `missing` preenchido
 * e `sourceLine` — nunca descartada. Data inferida de um `N/M` ambiguo tambem
 * sai `'low'` (ver a secao de ambiguidade no topo). O lote nunca lanca por causa
 * de uma linha ruim, e `reportedTotalCents` e sempre `null` (texto colado nao
 * imprime total).
 */
export function parsePastedText(
  raw: string,
  opts?: TextParseOptions,
): ParseResult & { rows: TextParsedRow[] } {
  const rows: TextParsedRow[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  if (typeof raw !== 'string' || raw.trim() === '') {
    return { rows, diagnostics, reportedTotalCents: null };
  }

  const order: 'dmy' | 'mdy' | 'ymd' =
    opts?.dateOrder === 'mdy' || opts?.dateOrder === 'ymd' ? opts.dateOrder : 'dmy';

  // Competencia invalida e erro de programacao de quem chama: `competenceStart`
  // lanca, como todo lib/date faz com entrada que nao e competencia.
  const defaultYear =
    opts?.defaultCompetence === undefined
      ? null
      : Number(competenceStart(opts.defaultCompetence).slice(0, 4));

  const lines = splitLines(raw);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === '') continue;

    const parsed = parseLine(line, order, defaultYear);

    if (parsed.diagnostic !== null) {
      diagnostics.push({ line: index + 1, message: parsed.diagnostic.message, raw: line });
    }

    const missing: MissingField[] = [];
    if (parsed.date === null) missing.push('date');
    if (parsed.amount === null) missing.push('amount');
    if (parsed.description === '') missing.push('description');

    let confidence: ParseConfidence;
    if (parsed.date === null || parsed.amount === null) {
      confidence = 'low';
    } else if (parsed.ambiguousDate) {
      // Data inferida de um `N/M` que tambem parecia parcela: baixa confianca
      // para a tela destacar a linha com o texto bruto e o usuario conferir.
      // REVISAVEL (ver o topo do arquivo).
      confidence = 'low';
    } else if (missing.length > 0 || parsed.date.inferredYear) {
      confidence = 'medium';
    } else {
      confidence = 'high';
    }

    const installment = detectInstallment(parsed.description);

    rows.push({
      // `null` e o ausente honesto: `missing` diz qual campo faltou, e a tela de
      // confirmacao deixa o campo em branco. Nao invento data nem valor, e
      // `cents(0)` seria ambíguo com uma compra de R$ 0,00 real.
      occurredOn: parsed.date?.iso ?? null,
      rawDescription: parsed.description,
      amountCents: parsed.amount?.value ?? null,
      installment:
        installment === null
          ? null
          : { current: installment.current, total: installment.total },
      confidence,
      sourceLine: line,
      missing,
    });
  }

  return { rows, diagnostics, reportedTotalCents: null };
}
