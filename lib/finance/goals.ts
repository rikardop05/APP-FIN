/**
 * Metas e reserva de emergência — CONTRACTS §13 (RF-MET-01..03).
 *
 * Módulo puro (CONVENTIONS §5): recebe dados e `today`, devolve dados. Não lê relógio
 * nem banco. A aritmética de mês vem de `lib/date`.
 *
 * ## Decisões que o contrato não fixa e estão resolvidas aqui
 *
 * 1. **`progressBp` é limitado a [0, 10000].** Meta superada (ou saldo negativo) não
 *    desenha barra de 130% nem de -20%. A tela diferencia "atingida" por
 *    `remainingCents === 0`, não por um progresso acima de 100%.
 * 2. **`remainingCents = max(0, alvo - atual)`.** Nunca negativo.
 * 3. **`monthsRemaining`** = meses de calendário entre a competência de `today` e a de
 *    `targetDate`, com piso 0 (prazo vencido ou neste mês). `null` só sem prazo
 *    (tabela "Quando cada `null` acontece", CONTRACTS §12/§13).
 * 4. **`requiredMonthlyCents`** = `ceil(restante / max(1, monthsRemaining))`: arredonda
 *    PARA CIMA, para que pagar o valor mostrado todo mês de fato complete a meta. Prazo
 *    já vencido (ou neste mês) divide por 1: o que falta tem de entrar de uma vez.
 *    `0` quando já não falta nada (zero verdadeiro: nada a aportar). `null` só sem prazo.
 * 5. **`onTrack`** = "ainda dá tempo": `true` se nada falta ou se `targetDate >= today`;
 *    `false` se há saldo a completar e o prazo venceu. É o MÁXIMO que as entradas do
 *    contrato permitem: sem a data de início ou o aporte feito não existe ritmo para
 *    comparar. `null` só sem prazo.
 *
 * ## Reserva de emergência (RF-MET-02)
 *
 * Alvo = `N × média mensal de despesa ESSENCIAL`. A média é de `ESSENTIAL_AVERAGE_WINDOW_MONTHS`
 * meses FECHADOS (os anteriores ao mês de `today`; o mês corrente ainda está incompleto e
 * puxaria a média para baixo), contando só os meses em que há algum lançamento: um
 * histórico de 1 mês dá a média daquele mês, não a de um terço dele. Sem nenhum mês com
 * lançamento não há média, e `essentialMonthlyAverage` devolve `null` (a tela mostra a
 * ausência, nunca R$ 0,00 de mentira).
 */

import {
  addCompetence,
  diffMonths,
  toCompetence,
  type Competence,
  type IsoDate,
} from '@/lib/date';
import { basisPoints, cents, type BasisPoints, type Cents } from '@/lib/money';

const FULL_BP = 10_000;

/** Janela da média de despesa essencial: os 3 meses fechados antes do mês corrente. */
export const ESSENTIAL_AVERAGE_WINDOW_MONTHS = 3;

export type GoalProgress = {
  progressBp: BasisPoints;
  remainingCents: Cents;
  monthsRemaining: number | null;
  requiredMonthlyCents: Cents | null;
  onTrack: boolean | null;
};

export function goalProgress(input: {
  targetCents: Cents;
  currentCents: Cents;
  targetDate: IsoDate | null;
  today: IsoDate;
}): GoalProgress {
  const target = cents(input.targetCents);
  const current = cents(input.currentCents);
  if (target <= 0) {
    throw new RangeError(
      `targetCents deve ser > 0; recebido: ${String(target)}. Meta sem valor não tem progresso.`,
    );
  }

  const remaining = cents(Math.max(0, target - current));
  const clampedCurrent = Math.min(Math.max(current, 0), target);
  // Arredondamento para o bp mais próximo, em bigint: `current * 10000` estoura o inteiro seguro.
  const progress = basisPoints(
    Number((BigInt(clampedCurrent) * BigInt(FULL_BP) + BigInt(target) / 2n) / BigInt(target)),
  );

  if (input.targetDate === null) {
    return {
      progressBp: progress,
      remainingCents: remaining,
      monthsRemaining: null,
      requiredMonthlyCents: null,
      onTrack: null,
    };
  }

  const monthsRemaining = Math.max(
    0,
    diffMonths(toCompetence(input.targetDate), toCompetence(input.today)),
  );
  const divisor = Math.max(1, monthsRemaining);
  const required = remaining === 0 ? 0 : Math.ceil(remaining / divisor);

  return {
    progressBp: progress,
    remainingCents: remaining,
    monthsRemaining,
    requiredMonthlyCents: cents(required),
    onTrack: remaining === 0 ? true : input.targetDate >= input.today,
  };
}

export function emergencyFundTarget(input: {
  monthlyEssentialAverageCents: Cents;
  months: number;
}): Cents {
  const average = cents(input.monthlyEssentialAverageCents);
  if (average < 0) {
    throw new RangeError(
      `monthlyEssentialAverageCents deve ser >= 0 (magnitude de despesa); recebido: ${String(average)}.`,
    );
  }
  if (!Number.isSafeInteger(input.months) || input.months < 1) {
    throw new RangeError(`months deve ser inteiro >= 1; recebido: ${String(input.months)}.`);
  }
  return cents(Number(BigInt(average) * BigInt(input.months)));
}

/** As competências da janela da média essencial: as `ESSENTIAL_AVERAGE_WINDOW_MONTHS` fechadas antes de `today`. */
export function essentialAverageWindow(today: IsoDate): { from: Competence; to: Competence } {
  const current = toCompetence(today);
  return {
    from: addCompetence(current, -ESSENTIAL_AVERAGE_WINDOW_MONTHS),
    to: addCompetence(current, -1),
  };
}

/**
 * Média mensal de despesa essencial. Entrada: UMA entrada por mês com lançamento
 * (qualquer tipo) na janela, com `expenseNetCents` = soma com sinal dos `expense`
 * essenciais do mês (saída negativa; mês sem despesa essencial vale 0).
 *
 * Cada mês entra com `max(0, -líquido)` (CONTRACTS §14: estorno que supera o gasto não
 * vira despesa negativa). Média em centavos, arredondada ao mais próximo (meio centavo
 * sobe). `null` sem nenhum mês.
 */
export function essentialMonthlyAverage(
  months: { competence: Competence; expenseNetCents: Cents }[],
): Cents | null {
  if (months.length === 0) return null;
  let total = 0n;
  for (const month of months) {
    const net = cents(month.expenseNetCents);
    total += net < 0 ? BigInt(-net) : 0n;
  }
  const count = BigInt(months.length);
  return cents(Number((total * 2n + count) / (count * 2n)));
}

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, achieved: 2 };

/**
 * Ordem de exibição (RF-MET-03): ativas, pausadas, atingidas; dentro do grupo, `priority`
 * crescente (MENOR número = mais prioritária; o default do schema é 100), depois prazo mais
 * próximo (sem prazo por último) e nome. Cancelada não é exibida: quem chama a remove.
 */
export function sortGoals<
  T extends { status: string; priority: number; targetDate: IsoDate | null; name: string },
>(goals: readonly T[]): T[] {
  return [...goals].sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (byStatus !== 0) return byStatus;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.targetDate !== b.targetDate) {
      if (a.targetDate === null) return 1;
      if (b.targetDate === null) return -1;
      return a.targetDate < b.targetDate ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}
