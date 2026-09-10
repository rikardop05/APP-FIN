/**
 * Primitivos de data e competencia — CONTRACTS §2.
 *
 * Este e o unico lugar do sistema com aritmetica de calendario
 * (CONVENTIONS §4). `lib/finance` e `lib/import` chamam daqui; nao contam mes
 * por si.
 *
 * Duas decisoes que valem explicacao, porque parecem omissao:
 *
 * 1. **Zero dependencia, e nem `Date`.** Competencia e `'YYYY-MM'` e data de
 *    fato financeiro e `'YYYY-MM-DD'` sem hora: as duas sao aritmetica de
 *    inteiros (ano x 12 + mes) mais a regra de ano bissexto. Nenhuma operacao
 *    daqui precisa de `Date`, de fuso ou de ICU, entao nao ha `new Date` neste
 *    arquivo — o modulo e deterministico por construcao, nao por disciplina.
 *
 * 2. **`formatDateBR` nao converte fuso, de proposito.** `IsoDate` e uma data
 *    sem hora (coluna `date`). Passar isso por `Date` + `America/Sao_Paulo`
 *    significaria assumir meia-noite UTC e voltar 3 horas, exibindo
 *    `'2026-09-10'` como `09/09/2026`. A conversao para America/Sao_Paulo de
 *    CONVENTIONS §4 vale para `timestamptz` (`created_at`), que tem hora — nao
 *    para data de fato financeiro.
 */

/** Data sem hora, `'YYYY-MM-DD'`. */
export type IsoDate = string;

/** Mes de referencia, `'YYYY-MM'`. Eixo de todo relatorio de gasto. */
export type Competence = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPETENCE_PATTERN = /^(\d{4})-(\d{2})$/;

const MONTHS_PER_YEAR = 12;

/**
 * Intervalo de ano aceito, igual na entrada e na saida.
 *
 * A forma `YYYY` ja limita a 0000-9999, mas ano abaixo de 1000 tem de ser
 * recusado na borda: `'0999-01-01'` seria lido como ano 999 e devolveria a
 * competencia `'999-01'` — string de 3 digitos que toda outra funcao deste
 * modulo rejeita. Emitir valor que o proprio modulo nao consome empurra o erro
 * para o consumidor, longe da causa.
 */
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/**
 * Dias de cada mes em ano comum, indexado por mes - 1. Fevereiro vem como 28 e
 * ganha o 29 em `daysInMonth`.
 *
 * `readonly number[]` em vez de `as const`: da a mesma imutabilidade sem gastar
 * uma assercao `as`, que CONVENTIONS §6 so admite com justificativa. Aqui nao
 * havia o que justificar — o tipo literal da tupla nao e usado por ninguem.
 */
const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Regra gregoriana completa: 2024 e bissexto, 1900 nao e, 2000 e. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Dias do mes (1-12) no ano dado. Fevereiro depende do ano bissexto. */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  // `?? 0` so existe por causa de noUncheckedIndexedAccess; `month` ja foi
  // validado no intervalo 1-12 por quem chama.
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/** Quebra uma competencia validada em ano e mes. Lanca se a forma nao fecha. */
function parseCompetence(c: Competence): { year: number; month: number } {
  const match = COMPETENCE_PATTERN.exec(c);
  if (match === null) {
    throw new RangeError(
      `Competencia deve estar no formato 'YYYY-MM'; recebida: ${String(c)}.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `Ano da competencia deve estar entre ${String(MIN_YEAR)} e ${String(MAX_YEAR)}; recebida: ${String(c)}.`,
    );
  }
  if (month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError(
      `Mes da competencia deve estar entre 01 e 12; recebida: ${String(c)}.`,
    );
  }
  return { year, month };
}

/**
 * Quebra uma data validada em ano, mes e dia. Rejeita data que nao existe no
 * calendario: `'2026-02-30'` lanca, nao vira 2 de marco.
 */
function parseIsoDate(d: IsoDate): { year: number; month: number; day: number } {
  const match = ISO_DATE_PATTERN.exec(d);
  if (match === null) {
    throw new RangeError(
      `Data deve estar no formato 'YYYY-MM-DD'; recebida: ${String(d)}.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `Ano deve estar entre ${String(MIN_YEAR)} e ${String(MAX_YEAR)}; recebida: ${String(d)}.`,
    );
  }
  if (month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError(
      `Mes deve estar entre 01 e 12; recebida: ${String(d)}.`,
    );
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(
      `Dia nao existe no mes informado; recebida: ${String(d)}.`,
    );
  }
  return { year, month, day };
}

/** Meses decorridos desde o marco zero. Base comum da aritmetica de mes. */
function toMonthIndex(year: number, month: number): number {
  return year * MONTHS_PER_YEAR + (month - 1);
}

/** Inverso de `toMonthIndex`. `Math.floor` mantem a conta correta no negativo. */
function fromMonthIndex(index: number): Competence {
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = index - year * MONTHS_PER_YEAR + 1;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `Competencia resultante fora do intervalo suportado (${String(MIN_YEAR)}-${String(MAX_YEAR)}): ano ${String(year)}.`,
    );
  }
  return `${String(year)}-${pad2(month)}`;
}

/** Competencia de uma data: `'2026-09-10'` -> `'2026-09'`. */
export function toCompetence(d: IsoDate): Competence {
  const { year, month } = parseIsoDate(d);
  return `${String(year)}-${pad2(month)}`;
}

/** Primeiro dia da competencia: `'2026-02'` -> `'2026-02-01'`. */
export function competenceStart(c: Competence): IsoDate {
  const { year, month } = parseCompetence(c);
  return `${String(year)}-${pad2(month)}-01`;
}

/**
 * Ultimo dia da competencia, respeitando 28/29/30/31:
 * `'2026-02'` -> `'2026-02-28'`, `'2024-02'` -> `'2024-02-29'`.
 */
export function competenceEnd(c: Competence): IsoDate {
  const { year, month } = parseCompetence(c);
  return `${String(year)}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

/**
 * Soma (ou subtrai) meses a uma competencia, cruzando a virada de ano nos dois
 * sentidos: `('2026-12', 1)` -> `'2027-01'`, `('2026-01', -1)` -> `'2025-12'`.
 */
export function addCompetence(c: Competence, months: number): Competence {
  const { year, month } = parseCompetence(c);
  if (!Number.isSafeInteger(months)) {
    throw new RangeError(
      `Deslocamento em meses deve ser inteiro; recebido: ${String(months)}.`,
    );
  }
  return fromMonthIndex(toMonthIndex(year, month) + months);
}

/**
 * Sequencia de `months` competencias consecutivas comecando em `from`
 * (inclusive). `('2026-11', 3)` -> `['2026-11', '2026-12', '2027-01']`.
 *
 * `months` e uma contagem: zero devolve lista vazia e negativo lanca. Uma
 * janela para tras se escreve com `competenceRange(addCompetence(c, -n), n)`,
 * que deixa explicito onde ela comeca.
 */
export function competenceRange(from: Competence, months: number): Competence[] {
  const { year, month } = parseCompetence(from);
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new RangeError(
      `Quantidade de meses deve ser inteiro >= 0; recebido: ${String(months)}.`,
    );
  }
  const start = toMonthIndex(year, month);
  const range: Competence[] = [];
  for (let offset = 0; offset < months; offset += 1) {
    range.push(fromMonthIndex(start + offset));
  }
  return range;
}

/**
 * Ancora um dia fixo (fechamento, vencimento, dia do salario) em um mes real,
 * limitando ao ultimo dia existente: dia 31 em fevereiro vira 28, ou 29 em ano
 * bissexto. Dia abaixo de 1 e elevado a 1 — e clamp nas duas pontas.
 */
export function clampDayToMonth(year: number, month: number, day: number): IsoDate {
  if (!Number.isSafeInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(
      `Ano deve ser inteiro entre ${String(MIN_YEAR)} e ${String(MAX_YEAR)}; recebido: ${String(year)}.`,
    );
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError(
      `Mes deve ser inteiro entre 1 e 12; recebido: ${String(month)}.`,
    );
  }
  if (!Number.isSafeInteger(day)) {
    throw new RangeError(`Dia deve ser inteiro; recebido: ${String(day)}.`);
  }
  const last = daysInMonth(year, month);
  const clamped = Math.min(Math.max(day, 1), last);
  return `${String(year)}-${pad2(month)}-${pad2(clamped)}`;
}

/**
 * Exibicao pt-BR: `'2026-09-10'` -> `'10/09/2026'`. Sem conversao de fuso —
 * ver a nota 2 no topo do arquivo.
 */
export function formatDateBR(d: IsoDate): string {
  const { year, month, day } = parseIsoDate(d);
  return `${pad2(day)}/${pad2(month)}/${String(year)}`;
}

/**
 * Distancia em meses entre duas competencias, no sentido `a - b`:
 * `diffMonths('2026-03', '2026-01')` = `2`, e o inverso = `-2`.
 *
 * Mesma orientacao de `differenceInMonths(dateLeft, dateRight)` do date-fns,
 * que SPEC §2.1 declarou como a biblioteca de data do projeto — a assinatura em
 * CONTRACTS §2 nao diz o sentido, e seguir a semantica ja declarada na SPEC e o
 * unico criterio disponivel que nao e preferencia.
 *
 * Invariante que fixa o sentido para quem consome:
 * `addCompetence(b, diffMonths(a, b)) === a`.
 */
export function diffMonths(a: Competence, b: Competence): number {
  const left = parseCompetence(a);
  const right = parseCompetence(b);
  return (
    toMonthIndex(left.year, left.month) - toMonthIndex(right.year, right.month)
  );
}
