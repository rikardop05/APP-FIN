/**
 * Projecao de fluxo de caixa — CONTRACTS §11.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados, sem I/O. O eixo de
 * competencia vem de `lib/date`; `today` e competencia entram por parametro,
 * nunca `new Date()` (CONVENTIONS §4 — o ESLint reprova o global `Date` aqui).
 *
 * ## Identidade do mes (RF-FLX-01)
 *
 *   netCents     = income − expense − installments − statements − contributions
 *   closingCents = openingCents + netCents
 *
 * `netCents` e o RESULTADO DO MES (receitas menos todas as saidas), nao o saldo.
 * `closingCents` e o acumulado. Um mes pode ter `netCents < 0` e `closingCents`
 * positivo — gastou mais do que entrou, mas ainda tinha saldo. Isso NAO e quebrar.
 *
 * ## Encadeamento (invariante dura)
 *
 * `closingCents` de um mes E o `openingCents` do mes seguinte, e o
 * `openingCents` do primeiro mes e `openingBalanceCents`. Um erro de um centavo
 * num mes se propaga pela janela inteira, entao isso e invariante testada sobre
 * TODA a janela (ver o teste), nao so entre dois meses vizinhos.
 *
 * ## `firstNegativeCompetence`
 *
 * E o primeiro mes da janela cujo `closingCents` e NEGATIVO, ou `null` quando
 * nenhum e. E a resposta a "quando eu quebro?". NAO e o menor saldo, e NAO e o
 * primeiro mes com `netCents` negativo: um mes com resultado negativo e saldo
 * ainda positivo nao e quebrar.
 *
 * ## Sinais (fixados com o Orquestrador — o contrato nao os declarava)
 *
 *   incomes               positivo (entrada)
 *   recurringExpenses     negativo (saida; `expandRecurrence` preserva o sinal de
 *                         `recurring_expenses.expected_cents`, que e negativo).
 *                         O motor usa o MODULO como despesa.
 *   installments          positivo, MAGNITUDE a subtrair
 *   statementsDue         positivo, MAGNITUDE a subtrair
 *   plannedContributions  positivo, MAGNITUDE a subtrair
 *   adjustments           positivo = entrada, negativo = saida (o modo "e se" e
 *                         um lancamento avulso, com sinal do usuario)
 * Sinal errado LANCA em vez de virar grafico torto em silencio.
 *
 * ## RC-03 — `transfer` e `credit_card_payment` NAO entram
 *
 * O motor nao recebe `kind` nem esses dois lancamentos (o §11 nao os expoe).
 * `expenseCents` e so despesa recorrente; o pagamento de fatura entra SEPARADO e
 * ja com o valor devido, em `statementsDue`, e e contado UMA vez. Pagar a fatura
 * e saida de caixa na conta e ja foi contado nos itens da fatura — conta-lo de
 * novo aqui e exatamente a dupla contagem que RC-03 impede.
 *
 * ## `adjustments` NAO PERSISTE
 *
 * O modo "e se" e puro: o usuario mexe, ve a curva mudar, fecha a tela e nada
 * aconteceu. Isso e de graca numa funcao pura — e deliberado. QUEM FOR LIGAR A
 * TELA vai ser tentado a gravar os `adjustments`; nao grave. A persistencia de
 * premissa e outro fluxo. Aqui o ajuste vive so na chamada.
 */

import { competenceRange, type Competence } from '@/lib/date';
import { addCents, cents, type Cents } from '@/lib/money';

/** Ocorrencia prevista — mesma forma de `expandRecurrence` (CONTRACTS §8). */
export interface PlannedOccurrence {
  competence: Competence;
  date: string;
  amountCents: Cents;
}

export interface CashflowInput {
  openingBalanceCents: Cents;
  fromCompetence: Competence;
  months: number;
  incomes: PlannedOccurrence[];
  recurringExpenses: PlannedOccurrence[];
  installments: { competence: Competence; amountCents: Cents }[];
  statementsDue: { competence: Competence; amountCents: Cents }[];
  plannedContributions: { competence: Competence; amountCents: Cents }[];
  adjustments?: { competence: Competence; amountCents: Cents; label: string }[];
}

export interface CashflowMonth {
  competence: Competence;
  openingCents: Cents;
  incomeCents: Cents;
  expenseCents: Cents;
  installmentsCents: Cents;
  statementsCents: Cents;
  contributionsCents: Cents;
  netCents: Cents;
  closingCents: Cents;
  negative: boolean;
}

export interface CashflowProjection {
  months: CashflowMonth[];
  firstNegativeCompetence: Competence | null;
  /**
   * Menor `closingCents` dos meses da janela — o pior FECHAMENTO, nao o ponto
   * mais baixo da trajetoria. A abertura NAO entra (achado do Corvo no T-206: o
   * nome promete "menor fechamento" e a versao anterior incluia a abertura).
   *
   * `null` quando `months` e 0: nao ha fechamento nenhum para minimizar, e
   * devolver a abertura reintroduziria o mesmo defeito — um valor que nao e
   * fechamento com nome de fechamento. Quando o pior momento e hoje, isso ja
   * aparece no saldo atual; este campo responde "qual o pior mes".
   */
  minClosingCents: Cents | null;
}

function assertMonths(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `months deve ser inteiro >= 0; recebido: ${String(value)}.`,
    );
  }
  return value;
}

/**
 * Soma por competencia, em `Map`, para a janela inteira ser uma passada.
 *
 * `sign` valida a direcao de cada entrada, porque sinal errado vira grafico
 * torto em silencio:
 *   'positive'  cada valor tem de ser >= 0 (renda, parcela, fatura, aporte)
 *   'negative'  cada valor tem de ser <= 0 (despesa recorrente, que o schema
 *               `recurring_expenses.expected_cents` ja entrega negativo)
 *   'any'       sem validacao (nao usado aqui; reservado)
 */
function sumByCompetence(
  entries: readonly { competence: Competence; amountCents: Cents }[],
  label: string,
  sign: 'positive' | 'negative',
): Map<Competence, Cents> {
  const totals = new Map<Competence, Cents>();
  for (const entry of entries) {
    const amount = cents(entry.amountCents);
    if (sign === 'positive' && amount < 0) {
      throw new RangeError(
        `${label} deve chegar com sinal positivo; recebido: ${String(amount)} na competencia ${entry.competence}.`,
      );
    }
    if (sign === 'negative' && amount > 0) {
      throw new RangeError(
        `${label} deve chegar com sinal negativo (saida); recebido: ${String(amount)} na competencia ${entry.competence}. Um valor positivo aqui somaria em vez de subtrair.`,
      );
    }
    const current = totals.get(entry.competence) ?? cents(0);
    totals.set(entry.competence, addCents(current, amount));
  }
  return totals;
}

/**
 * Projeta o fluxo de caixa mes a mes. Ver o cabecalho para a identidade do mes, a
 * invariante de encadeamento e o tratamento de sinal e de RC-03.
 *
 * `months` e uma contagem a partir de `fromCompetence` (inclusive); zero devolve
 * janela vazia, `firstNegativeCompetence: null` e `minClosingCents: null` (nao
 * ha fechamento para minimizar — ver o docblock do campo).
 */
export function projectCashflow(input: CashflowInput): CashflowProjection {
  const months = assertMonths(input.months);
  const openingBalance = cents(input.openingBalanceCents);
  const window = competenceRange(input.fromCompetence, months);

  const incomeByCompetence = sumByCompetence(input.incomes, 'incomes', 'positive');
  const expenseByCompetence = sumByCompetence(
    input.recurringExpenses,
    'recurringExpenses',
    'negative',
  );
  const installmentByCompetence = sumByCompetence(
    input.installments,
    'installments',
    'positive',
  );
  const statementByCompetence = sumByCompetence(
    input.statementsDue,
    'statementsDue',
    'positive',
  );
  const contributionByCompetence = sumByCompetence(
    input.plannedContributions,
    'plannedContributions',
    'positive',
  );

  // Ajustes do modo "e se": sinal livre (entrada ou saida), nunca persistidos.
  const adjustmentTotals = new Map<Competence, Cents>();
  for (const adjustment of input.adjustments ?? []) {
    const current = adjustmentTotals.get(adjustment.competence) ?? cents(0);
    adjustmentTotals.set(
      adjustment.competence,
      addCents(current, cents(adjustment.amountCents)),
    );
  }

  const rows: CashflowMonth[] = [];
  let opening = openingBalance;
  let firstNegativeCompetence: Competence | null = null;
  // Menor FECHAMENTO da janela. `null` ate o primeiro mes; ver o docblock de
  // `CashflowProjection`. NAO entra a abertura — o nome e o contrato (§11) dizem
  // "menor fechamento" (achado do Corvo no T-206).
  let minClosing: Cents | null = null;

  for (const competence of window) {
    const income = incomeByCompetence.get(competence) ?? cents(0);
    // Despesa recorrente: modulo do total (que chega negativo). O sinal de
    // entrada e validado aqui, nao no agregado, para o erro apontar o campo.
    const expenseNet = expenseByCompetence.get(competence) ?? cents(0);
    const expense = expenseNet < 0 ? cents(-expenseNet) : expenseNet;
    const installments = installmentByCompetence.get(competence) ?? cents(0);
    const statements = statementByCompetence.get(competence) ?? cents(0);
    const contributions = contributionByCompetence.get(competence) ?? cents(0);
    const adjustment = adjustmentTotals.get(competence) ?? cents(0);

    // net = resultado do mes (RF-FLX-01). expense entra subtraindo; o ajuste
    // entra com o proprio sinal.
    const net = addCents(
      income,
      cents(-expense),
      cents(-installments),
      cents(-statements),
      cents(-contributions),
      adjustment,
    );
    const closing = addCents(opening, net);
    const negative = closing < 0;

    if (negative && firstNegativeCompetence === null) {
      firstNegativeCompetence = competence;
    }
    if (minClosing === null || closing < minClosing) minClosing = closing;

    rows.push({
      competence,
      openingCents: opening,
      incomeCents: income,
      expenseCents: expense,
      installmentsCents: installments,
      statementsCents: statements,
      contributionsCents: contributions,
      netCents: net,
      closingCents: closing,
      negative,
    });

    opening = closing;
  }

  return {
    months: rows,
    firstNegativeCompetence,
    minClosingCents: minClosing,
  };
}

/** Segunda leitura do veredito: a projecao com as faturas anteriores nao pagas descontadas. */
export interface OverdueStatementsScenario {
  /** Quanto foi descontado no mes corrente (magnitude da divida; 0 sem divida). */
  consideredCents: Cents;
  /** Pior fechamento da janela nesta leitura; null com janela vazia. */
  minClosingCents: Cents | null;
  /** Mes do pior fechamento (o primeiro, em empate); null com janela vazia. */
  minClosingCompetence: Competence | null;
  /** Primeiro mes com fechamento negativo nesta leitura; null se nenhum. */
  firstNegativeCompetence: Competence | null;
}

/**
 * Projecao "e se eu pagar agora as faturas de competencias anteriores que nao estao
 * marcadas como pagas" (decisao do Ricardo, 2026-10-09: a projecao PRINCIPAL nao muda,
 * isto so avisa). O valor entra como fatura devida no PRIMEIRO mes da janela
 * (`statementsDue`, o mesmo canal das faturas na projecao), entao abate o fechamento
 * dele e de todos os seguintes pelo encadeamento.
 *
 * `overdueUnpaidCents` chega com o sinal do Comprometido (`breakdown.overdueUnpaidCents`:
 * negativo = a pagar). Saldo credor (so estorno) nao vira entrada de caixa: considerado 0.
 * Nao altera `input`.
 */
export function projectWithOverdueStatements(
  input: CashflowInput,
  overdueUnpaidCents: Cents,
): OverdueStatementsScenario {
  const debt = cents(overdueUnpaidCents);
  const consideredCents = debt < 0 ? cents(-debt) : cents(0);
  const projection = projectCashflow(
    consideredCents === 0
      ? input
      : {
          ...input,
          statementsDue: [...input.statementsDue, { competence: input.fromCompetence, amountCents: consideredCents }],
        },
  );

  let worst: CashflowMonth | null = null;
  for (const month of projection.months) {
    if (worst === null || month.closingCents < worst.closingCents) worst = month;
  }
  return {
    consideredCents,
    minClosingCents: worst === null ? null : worst.closingCents,
    minClosingCompetence: worst === null ? null : worst.competence,
    firstNegativeCompetence: projection.firstNegativeCompetence,
  };
}
