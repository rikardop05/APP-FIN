import { addCompetence, type Competence } from '@/lib/date';
import { cents, divideRounded, type Cents } from '@/lib/money';

import type { IncomeExpenseMonth } from './income-expense-series';
import { monthName } from './presentation';

/** Quantos meses fechados entram na média. */
export const AVERAGE_WINDOW_MONTHS = 6;

export type RequiredIncomeAverage = {
  /** Quantos meses entraram de fato: menos que `AVERAGE_WINDOW_MONTHS` quando o histórico é curto. */
  monthsCounted: number;
  fromCompetence: Competence;
  toCompetence: Competence;
  averageCents: Cents;
};

export type RequiredIncome = {
  /** O mês para o qual a meta vale: o seguinte ao corrente. */
  nextCompetence: Competence;
  /** Média da despesa dos meses fechados; `null` sem nenhuma despesa nesses meses. */
  average: RequiredIncomeAverage | null;
  /** Despesa do mês anterior ao corrente (zero quando não houve). */
  previousMonth: { competence: Competence; expenseCents: Cents };
};

/**
 * Renda necessária para repetir o padrão de gasto: quanto precisa entrar no mês para a despesa não
 * deixar o saldo no vermelho. Não há regra de dinheiro nova aqui — a despesa de cada mês é a de
 * `buildIncomeExpenseSeries` (o motor `monthlyKpis`): a mesma do card "Despesa do mês", sem transferência,
 * sem pagamento de fatura e sem aporte. O aporte fica de fora de propósito: o que passar da meta é a
 * sobra que dá para investir.
 *
 * Só meses FECHADOS contam (o corrente está em andamento e puxaria a média para baixo). Meses sem
 * despesa ANTES do primeiro mês com despesa não contam: é o tempo em que a pessoa ainda não usava o app,
 * não um mês de gasto zero. Depois do primeiro mês com despesa, o zero é gasto zero de verdade e entra.
 *
 * `series` é a série de `buildIncomeExpenseSeries`, da mais antiga à corrente.
 */
export function requiredIncome(
  series: readonly IncomeExpenseMonth[],
  currentCompetence: Competence,
): RequiredIncome {
  const previousCompetence = addCompetence(currentCompetence, -1);
  const windowStart = addCompetence(currentCompetence, -AVERAGE_WINDOW_MONTHS);

  const closed = series.filter(
    (month) => month.competence >= windowStart && month.competence < currentCompetence,
  );
  const firstWithExpense = closed.findIndex((month) => month.expenseCents > 0);
  const counted = firstWithExpense === -1 ? [] : closed.slice(firstWithExpense);

  const first = counted[0];
  const last = counted[counted.length - 1];
  let average: RequiredIncomeAverage | null = null;
  if (first !== undefined && last !== undefined) {
    const total = counted.reduce((sum, month) => sum + BigInt(month.expenseCents), 0n);
    average = {
      monthsCounted: counted.length,
      fromCompetence: first.competence,
      toCompetence: last.competence,
      averageCents: cents(divideRounded(total, BigInt(counted.length))),
    };
  }

  const previous = series.find((month) => month.competence === previousCompetence);
  return {
    nextCompetence: addCompetence(currentCompetence, 1),
    average,
    previousMonth: {
      competence: previousCompetence,
      expenseCents: previous?.expenseCents ?? cents(0),
    },
  };
}

/** "Média de maio a outubro." / "Gasto de outubro, o único mês fechado até agora." */
export function averageNote(average: RequiredIncomeAverage): string {
  const from = monthName(average.fromCompetence);
  const to = monthName(average.toCompetence);
  if (average.monthsCounted === 1) {
    return `Gasto de ${to}, o único mês fechado até agora.`;
  }
  if (average.monthsCounted < AVERAGE_WINDOW_MONTHS) {
    return `Média de ${average.monthsCounted} meses, de ${from} a ${to}: o histórico ainda é curto.`;
  }
  return `Média de ${from} a ${to}.`;
}

/** Nota do mês anterior; sem despesa, diz por que o valor está vazio em vez de mostrar zero como meta. */
export function previousMonthNote(previous: RequiredIncome['previousMonth']): string {
  const name = monthName(previous.competence);
  return previous.expenseCents > 0
    ? `Despesa total de ${name}.`
    : `Sem despesa lançada em ${name}.`;
}
