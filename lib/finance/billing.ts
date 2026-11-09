/**
 * Motor de faturas de cartao — CONTRACTS §3.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados. Nao le relogio,
 * nao toca banco, nao faz conta de calendario por si — todo fato de calendario
 * (ultimo dia do mes, ano bissexto, virada de mes) vem de `lib/date`.
 *
 * Comparacao de data aqui e comparacao de string: `'YYYY-MM-DD'` ordena
 * lexicograficamente na mesma ordem em que ordena cronologicamente, entao
 * `a <= b` e exato e nao precisa de aritmetica nenhuma.
 */

import {
  addCompetence,
  clampDayToMonth,
  competenceEnd,
  competenceStart,
  toCompetence,
  type Competence,
  type IsoDate,
} from '@/lib/date';
import { addCents, cents, type Cents } from '@/lib/money';

/** Dia de fechamento e de vencimento do cartao, ambos 1-31 (DATA-MODEL). */
export interface CardCycleConfig {
  closingDay: number;
  dueDay: number;
}

/** Menor e maior dia que um ciclo de cartao aceita. */
const MIN_CYCLE_DAY = 1;
const MAX_CYCLE_DAY = 31;

function assertCycleDay(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < MIN_CYCLE_DAY || value > MAX_CYCLE_DAY) {
    throw new RangeError(
      `${field} deve ser inteiro entre ${String(MIN_CYCLE_DAY)} e ${String(MAX_CYCLE_DAY)}; recebido: ${String(value)}.`,
    );
  }
  return value;
}

/** Ano de uma data ja validada. */
function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

/** Mes de uma data ja validada. */
function monthOf(d: IsoDate): number {
  return Number(d.slice(5, 7));
}

/** Dia de uma data ja validada. */
function dayOf(d: IsoDate): number {
  return Number(d.slice(8, 10));
}

/** O dia de fechamento ancorado num mes real: 31 em fevereiro vira 28 ou 29. */
function closingDateOf(competence: Competence, closingDay: number): IsoDate {
  const start = competenceStart(competence);
  return clampDayToMonth(yearOf(start), monthOf(start), closingDay);
}

/**
 * Dia seguinte a uma data.
 *
 * LACUNA DE CONTRATO, reportada ao orquestrador: `lib/date` (CONTRACTS §2) nao
 * declara aritmetica de dia, e `statementWindow.from` e por definicao o dia
 * seguinte ao fechamento anterior. Este helper existe para nao inventar uma
 * assinatura em `lib/date`, que nao e posse desta tarefa.
 *
 * Ele NAO carrega conhecimento de calendario: nao sabe quantos dias tem um mes
 * nem o que e ano bissexto. Pergunta as duas coisas a `lib/date` — "esta data e
 * o ultimo dia do mes?" (`competenceEnd`) e "qual o primeiro dia do mes
 * seguinte?" (`competenceStart` + `addCompetence`). O lugar definitivo disto e
 * `lib/date`, como `addDays`.
 */
function nextDay(date: IsoDate): IsoDate {
  const competence = toCompetence(date);
  if (date === competenceEnd(competence)) {
    return competenceStart(addCompetence(competence, 1));
  }
  // Fora do ultimo dia, dia + 1 sempre existe no mes, entao o clamp e
  // identidade — quem garante isso e a comparacao acima.
  return clampDayToMonth(yearOf(date), monthOf(date), dayOf(date) + 1);
}

/**
 * Quantos meses separam o fechamento do vencimento (0 ou 1).
 *
 * Decisao do Ricardo (2026-11-09): a competencia da fatura e o mes do
 * VENCIMENTO ("a fatura que vence em 07/11 e de novembro"). `dueDay <=
 * closingDay` vence no mes seguinte ao fechamento (fecha 30, vence 7); com
 * `dueDay > closingDay` o vencimento cai no proprio mes do fechamento. A
 * comparacao usa os dias CONFIGURADOS, nao os ja ancorados no mes: senao um
 * fechamento 31 ancorado em 28/02 mudaria de lado em fevereiro.
 */
function dueOffsetOf(cfg: CardCycleConfig): 0 | 1 {
  return cfg.dueDay <= cfg.closingDay ? 1 : 0;
}

/** Vencimento da fatura de `competence`: o `dueDay` ancorado no PROPRIO mes dela. */
function dueDateOf(competence: Competence, dueDay: number): IsoDate {
  const start = competenceStart(competence);
  return clampDayToMonth(yearOf(start), monthOf(start), dueDay);
}

/**
 * Em qual fatura cai uma compra.
 *
 * Compra ATE o fechamento (inclusive) entra na fatura que fecha no mes da
 * compra; um dia depois do fechamento, na seguinte (RF-CC-02). A competencia
 * da fatura e o mes em que ela VENCE: o mes do fechamento, mais `dueOffset`.
 */
export function billingPeriodFor(
  occurredOn: IsoDate,
  cfg: CardCycleConfig,
): { competence: Competence; closingDate: IsoDate; dueDate: IsoDate } {
  assertCycleDay(cfg.closingDay, 'closingDay');
  assertCycleDay(cfg.dueDay, 'dueDay');

  // `toCompetence` valida a data: '2026-02-30' lanca aqui, nao vira 02/03.
  const purchaseCompetence = toCompetence(occurredOn);
  const closingOfPurchaseMonth = closingDateOf(purchaseCompetence, cfg.closingDay);

  const closingCompetence =
    occurredOn <= closingOfPurchaseMonth
      ? purchaseCompetence
      : addCompetence(purchaseCompetence, 1);

  const competence = addCompetence(closingCompetence, dueOffsetOf(cfg));

  return {
    competence,
    closingDate: closingDateOf(closingCompetence, cfg.closingDay),
    dueDate: dueDateOf(competence, cfg.dueDay),
  };
}

/**
 * Janela de uma fatura: `from` e `to` sao INCLUSIVOS, isto e, a fatura cobre
 * `from <= occurredOn <= to`. `to` e o proprio dia de fechamento e `from` e o
 * dia seguinte ao fechamento anterior, entao duas faturas consecutivas nao se
 * sobrepoem nem deixam buraco.
 *
 * `competence` e o mes do VENCIMENTO: `dueDate` cai sempre nele, e o
 * fechamento cai em `competence - dueOffset` (fecha 30/10, vence 07/11 =>
 * fatura de novembro, `closingDate` 2026-10-30).
 */
export function statementWindow(
  competence: Competence,
  cfg: CardCycleConfig,
): { from: IsoDate; to: IsoDate; closingDate: IsoDate; dueDate: IsoDate } {
  assertCycleDay(cfg.closingDay, 'closingDay');
  assertCycleDay(cfg.dueDay, 'dueDay');

  const closingCompetence = addCompetence(competence, -dueOffsetOf(cfg));
  const closingDate = closingDateOf(closingCompetence, cfg.closingDay);
  const previousClosing = closingDateOf(
    addCompetence(closingCompetence, -1),
    cfg.closingDay,
  );

  return {
    from: nextDay(previousClosing),
    to: closingDate,
    closingDate,
    dueDate: dueDateOf(competence, cfg.dueDay),
  };
}

/**
 * Confere a soma dos lancamentos contra o total informado no arquivo
 * (SPEC: "Total calculado da fatura = total informado, ou o app avisa").
 *
 * `differenceCents` e `computedTotal - reportedTotal`.
 *
 * CUIDADO COM O SENTIDO DO SINAL, que e contraintuitivo: como saida de dinheiro
 * e negativa (CONVENTIONS §2), somar MAIS gasto deixa o computado MENOR, entao
 * a diferenca fica NEGATIVA quando lancamos mais do que a fatura informou, e
 * POSITIVA quando faltou lancamento. Quem montar a mensagem em pt-BR a partir
 * deste sinal precisa ler assim, sob pena de trocar "faltou" por "sobrou".
 *
 * Os dois lados tem de estar na mesma convencao
 * de sinal (CONVENTIONS §2: saida de dinheiro e negativa) — esta funcao nao
 * normaliza sinal, porque nao tem como saber qual lado veio trocado.
 *
 * `reportedTotal` nulo significa fatura sem total informado (lancamento
 * manual): nao ha o que conferir, entao a diferenca e zero e `matches` e
 * verdadeiro. Nao ha divergencia a avisar quando nao ha numero para comparar.
 */
export function reconcileStatement(input: {
  reportedTotal: Cents | null;
  transactions: { amountCents: Cents }[];
}): { computedTotal: Cents; differenceCents: Cents; matches: boolean } {
  const computedTotal = addCents(...input.transactions.map((t) => t.amountCents));

  if (input.reportedTotal === null) {
    return { computedTotal, differenceCents: cents(0), matches: true };
  }

  const reported = cents(input.reportedTotal);
  const differenceCents = addCents(computedTotal, cents(-reported));

  return {
    computedTotal,
    differenceCents,
    matches: differenceCents === 0,
  };
}
