/**
 * Recorrencia de despesas e receitas — CONTRACTS §8.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados. A data de fato
 * financeiro e o eixo da janela vem de `lib/date` — nada aqui faz conta de
 * calendario nem le o relogio.
 *
 * Decisoes fixadas com o Orquestrador antes da implementacao (as quatro
 * estavam em aberto no contrato §8 e mudam o numero em silencio):
 *
 * 1. **Primeira ocorrencia = primeiro `dueDay` que cai em `startsOn` ou depois.**
 *    A cadencia de N meses e contada da COMPETENCIA de `startsOn`. Ex.:
 *    startsOn 2026-03-10, dueDay 5, bimestral -> a de marco (05/03) e anterior
 *    ao inicio e nao entra; seguem 05/05, 05/07, 05/09...
 *    E o que faz "vence dia 5, comeca em 01/03" virar a primeira parcela em
 *    05/03, e nao em 01/03.
 *
 * 2. **Reajuste anual no aniversario da COMPETENCIA de `startsOn`.** O numero de
 *    aniversarios de uma ocorrencia e `floor(diffMonths(competencia, competencia
 *    de startsOn) / 12)`. A ocorrencia de mar/2027 recebe o 1o reajuste, mar/2028
 *    o 2o — o que a familia espera de "reajuste no aniversario". Contar a data
 *    exata (o dia) adiaria o primeiro reajuste de um ano inteiro quando o
 *    vencimento cai antes do dia de `startsOn`.
 *
 * 3. **Reajuste composto ano a ano, com arredondamento por aniversario.**
 *    `valor_novo = valor_atual + applyRate(valor_atual, bp)` a cada ano, usando o
 *    valor JA arredondado como base do proximo — espelha o reajuste contratado
 *    sobre o valor vigente. `applyRate` devolve o ACRESCIMO do percentual, nao o
 *    valor final: somar `valor + applyRate(valor, bp)` e o que da `valor*(1+r)`.
 *
 * 4. **`one_off` segue a mesma regra da recorrencia, sem caso especial**
 *    (CONTRACTS §8, fixado em 2026-09-23): primeiro `dueDay` que caia em
 *    `startsOn` ou depois. `oneOffCompetence` preenchido FIXA a competencia (o
 *    dia continua sendo o `dueDay` clampado); ausente e o caso normal de despesa
 *    avulsa e NAO significa "nenhuma ocorrencia" — devolver vazio sumiria em
 *    silencio com uma despesa cadastrada. `one_off` nunca recebe reajuste: nao
 *    existe aniversario de ocorrencia unica.
 *
 * O sinal e preservado: `expectedCents` ja chega negativo (despesa) ou positivo
 * (receita) do schema (DATA-MODEL §2). Este modulo nao aplica direcao.
 */

import {
  addCompetence,
  clampDayToMonth,
  diffMonths,
  toCompetence,
  type Competence,
  type IsoDate,
} from '@/lib/date';
import { addCents, applyRate, cents, type BasisPoints, type Cents } from '@/lib/money';

export interface RecurrenceInput {
  expectedCents: Cents;
  dueDay: number;
  frequency:
    | 'monthly'
    | 'bimonthly'
    | 'quarterly'
    | 'semiannual'
    | 'annual'
    | 'one_off';
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  annualAdjustmentBp: BasisPoints | null;
  oneOffCompetence?: Competence | null;
}

export interface PlannedOccurrence {
  competence: Competence;
  date: IsoDate;
  amountCents: Cents;
}

const MONTHS_PER_YEAR = 12;

/** Passo em meses de cada frequencia. `one_off` nao tem passo (tratada a parte). */
type RecurringFrequency = Exclude<RecurrenceInput['frequency'], 'one_off'>;

const STEP_MONTHS: Record<RecurringFrequency, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** `dueDay` e dia de vencimento: 1 a 31. Acima disso nao e "ultimo dia", e lixo. */
function assertDueDay(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 31) {
    throw new RangeError(
      `dueDay deve ser inteiro entre 1 e 31; recebido: ${String(value)}.`,
    );
  }
  return value;
}

/** Janela de competencias: `months` e contagem, entao inteiro >= 0 (como lib/date). */
function assertWindow(window: { from: Competence; months: number }): void {
  if (!Number.isSafeInteger(window.months) || window.months < 0) {
    throw new RangeError(
      `window.months deve ser inteiro >= 0; recebido: ${String(window.months)}.`,
    );
  }
}

/** Ano e mes de uma competencia ja validada, para `clampDayToMonth`. */
function splitCompetence(c: Competence): { year: number; month: number } {
  return { year: Number(c.slice(0, 4)), month: Number(c.slice(5, 7)) };
}

/**
 * Data da ocorrencia: `dueDay` ancorado no mes real. Dia 31 em fevereiro vira
 * 28/29 e VOLTA a 31 no mes seguinte — a ancora e o dia pedido, nao o ultimo
 * valor clampado (e por isso `clampDayToMonth` e recalculado a cada mes).
 */
function occurrenceDate(c: Competence, dueDay: number): IsoDate {
  const { year, month } = splitCompetence(c);
  return clampDayToMonth(year, month, dueDay);
}

/**
 * Valor no enesimo aniversario: `valor * (1 + r)^n`, composto com arredondamento
 * por ano.
 *
 * `bp` negativo NAO e rejeitado: `applyRate` trata o sinal, e um "reajuste"
 * negativo e uma reducao legitima (renegociacao para baixo). O modulo nao
 * inventa validacao que o contrato nao pede — quem chama decide se aceita.
 */
function adjustedAmount(
  expected: Cents,
  bp: BasisPoints | null,
  years: number,
): Cents {
  if (bp === null || years <= 0) return expected;
  let amount = expected;
  for (let year = 0; year < years; year += 1) {
    amount = addCents(amount, applyRate(amount, bp));
  }
  return amount;
}

/** Ocorrencia eventual: exatamente uma, pela mesma regra da recorrencia. */
function expandOneOff(
  input: RecurrenceInput,
  window: { from: Competence; months: number },
  dueDay: number,
  expected: Cents,
  startCompetence: Competence,
): PlannedOccurrence[] {
  const lastCompetence = addCompetence(window.from, window.months - 1);

  // Competencia eventual explicita FIXA o mes; o dia segue sendo o dueDay
  // clampado. E o caso de receita com `one_off_competence` (13o, PLR).
  if (input.oneOffCompetence != null) {
    const competence = input.oneOffCompetence;
    if (competence < window.from || competence > lastCompetence) return [];
    const date = occurrenceDate(competence, dueDay);
    if (input.endsOn !== null && date > input.endsOn) return [];
    return [{ competence, date, amountCents: expected }];
  }

  // Ausente (caso normal de despesa avulsa): primeiro dueDay em startsOn ou
  // depois, com startsOn como piso. O primeiro vencimento cai no mes de
  // startsOn ou no seguinte, nunca antes.
  for (let offset = 0; offset <= 1; offset += 1) {
    const competence = addCompetence(startCompetence, offset);
    const date = occurrenceDate(competence, dueDay);
    if (date < input.startsOn) continue;
    if (competence < window.from || competence > lastCompetence) return [];
    if (input.endsOn !== null && date > input.endsOn) return [];
    return [{ competence, date, amountCents: expected }];
  }
  return [];
}

/**
 * Ocorrencias previstas na janela. Aplica reajuste anual no aniversario de
 * `startsOn` (ver o cabecalho do modulo para as quatro decisoes).
 *
 * A janela e por COMPETENCIA, inclusive nas duas pontas: `months` competencias
 * a partir de `from`. Ocorrencia fora da janela nao e devolvida, mesmo que a
 * serie exista antes ou depois dela.
 */
export function expandRecurrence(
  input: RecurrenceInput,
  window: { from: Competence; months: number },
): PlannedOccurrence[] {
  assertWindow(window);
  const dueDay = assertDueDay(input.dueDay);
  const expected = cents(input.expectedCents);
  // Valida startsOn em qualquer caminho, inclusive one_off com competencia fixa
  // (achado do Corvo na revisao do T-201).
  const startCompetence = toCompetence(input.startsOn);

  if (window.months === 0) return [];

  if (input.frequency === 'one_off') {
    return expandOneOff(input, window, dueDay, expected, startCompetence);
  }

  const step = STEP_MONTHS[input.frequency];
  const lastCompetence = addCompetence(window.from, window.months - 1);

  // Menor k tal que startCompetence + k*step cai em window.from ou depois.
  // `Math.ceil` mantem a cadencia ancorada em startsOn sem iterar meses fora da
  // janela quando o inicio esta muito no passado.
  const monthsToWindow = diffMonths(window.from, startCompetence);
  const firstK = Math.max(0, Math.ceil(monthsToWindow / step));

  const occurrences: PlannedOccurrence[] = [];
  for (let k = firstK; ; k += 1) {
    const competence = addCompetence(startCompetence, k * step);
    if (competence > lastCompetence) break;

    const date = occurrenceDate(competence, dueDay);
    // Primeira ocorrencia e o primeiro dueDay em startsOn ou depois; so o
    // candidato inicial pode cair antes do inicio.
    if (date < input.startsOn) continue;
    // Datas crescem com k: passou de endsOn, acabou a vigencia.
    if (input.endsOn !== null && date > input.endsOn) break;

    const years = Math.floor((k * step) / MONTHS_PER_YEAR);
    occurrences.push({
      competence,
      date,
      amountCents: adjustedAmount(expected, input.annualAdjustmentBp, years),
    });
  }

  return occurrences;
}
