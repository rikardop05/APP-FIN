import { competenceLabel } from '@/components/budget/labels';
import { formatBRL, type Cents } from '@/lib/money';

import { bpToPercentInput, formatMonthsToTarget } from '../display';
import type { InvestmentScenario, InvestmentSurplus } from '../schemas';

/**
 * Textos da ligação com a sobra real (T-304, RF-INV-05). Nada aqui calcula dinheiro: a
 * lacuna, o uso da sobra e a base da comparação vêm prontos da API
 * (`contributionFeasibility` do motor). Fora do .tsx porque o vitest não transforma JSX.
 */

type Feasibility = NonNullable<InvestmentScenario['feasibility']>;

const money = (value: Cents) => formatBRL(value, { sign: 'auto' });

/** Contra qual aporte a sobra foi comparada: "até o prazo do plano (2 anos)" / "em 20 anos". */
export function basisText(basis: Feasibility['basis']): string {
  return basis.kind === 'targetDate'
    ? `até o prazo do plano (${formatMonthsToTarget(basis.months).text})`
    : `em ${String(basis.years)} anos`;
}

export type FeasibilityLineView = {
  tone: 'neutral' | 'ok' | 'gap';
  /** Resposta curta para "Cabe na sua sobra?". */
  answer: string;
  detail: string;
};

/** A linha "Cabe na sua sobra?" de um cartão de cenário. */
export function feasibilityLine(
  feasibility: InvestmentScenario['feasibility'],
  surplus: InvestmentSurplus,
): FeasibilityLineView {
  if (surplus.averageMonthlyCents === null) {
    return {
      tone: 'neutral',
      answer: 'Sem histórico de sobra',
      detail:
        (surplus.excludedMonths ?? []).length > 0
          ? 'Nenhum dos últimos 3 meses fechados teve receita lançada, então não há sobra para comparar com o aporte necessário.'
          : 'Não há lançamentos nos últimos 3 meses fechados para comparar com o aporte necessário.',
    };
  }
  if (feasibility === null) {
    return { tone: 'neutral', answer: 'Sem aporte para comparar', detail: 'O plano não tem prazo nem horizonte.' };
  }
  const basis = basisText(feasibility.basis);
  const surplusText = `${money(surplus.averageMonthlyCents)} por mês`;
  if (feasibility.feasible) {
    if (feasibility.requiredCents === 0) {
      return { tone: 'ok', answer: 'Sim', detail: `A meta não pede aporte ${basis}: o patrimônio atual já basta.` };
    }
    const usage =
      feasibility.surplusUsageBp === null ? '' : ` (${bpToPercentInput(feasibility.surplusUsageBp)}% dela)`;
    return {
      tone: 'ok',
      answer: 'Sim',
      detail: `O aporte necessário ${basis}, ${money(feasibility.requiredCents)} por mês, cabe na sua sobra média de ${surplusText}${usage}.`,
    };
  }
  const why =
    surplus.averageMonthlyCents <= 0
      ? `e nos últimos meses não sobrou dinheiro (média de ${surplusText})`
      : `e sua sobra média é de ${surplusText}`;
  return {
    tone: 'gap',
    answer: `Não: faltam ${money(feasibility.gapCents)} por mês`,
    detail: `O aporte necessário ${basis} é de ${money(feasibility.requiredCents)} por mês, ${why}.`,
  };
}

/** De onde vem a sobra média: "média de 3 meses, de julho de 2026 a setembro de 2026". */
export function surplusBasisText(surplus: InvestmentSurplus): string {
  const months = surplus.monthsWithData === 1 ? '1 mês' : `${String(surplus.monthsWithData)} meses`;
  return `média de ${months} com lançamentos, entre ${competenceLabel(surplus.windowFrom)} e ${competenceLabel(surplus.windowTo)}`;
}

/** "Ficaram fora da média: julho de 2026 e agosto de 2026", ou `null` se nenhum mês saiu. */
export function surplusExcludedText(surplus: InvestmentSurplus): string | null {
  const excluded = surplus.excludedMonths ?? [];
  if (excluded.length === 0) return null;
  const names = excluded.map((month) => competenceLabel(month));
  const list = names.length === 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1] ?? ''}`;
  return `${excluded.length === 1 ? 'Ficou fora da média 1 mês' : `Ficaram fora da média ${String(excluded.length)} meses`}, por não terem receita lançada: ${list}.`;
}

/**
 * UMA linha para "sem média": nenhum dos meses da janela teve receita lançada. Nomeia os meses quando a API
 * os devolve, em vez de repetir "Sem histórico" e "ficaram fora" em duas frases.
 */
export function surplusNoHistoryText(surplus: InvestmentSurplus): string {
  const excluded = surplus.excludedMonths ?? [];
  if (excluded.length === 0) return 'Sem histórico: nenhum dos últimos 3 meses fechados teve receita lançada.';
  const names = excluded.map((month) => competenceLabel(month));
  const list = names.length === 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1] ?? ''}`;
  return `Sem histórico: nenhum dos últimos 3 meses fechados teve receita lançada (${list}).`;
}

/** Alerta do topo: só quando há sobra conhecida e NENHUM cenário cabe nela. */
export function noScenarioFits(scenarios: readonly InvestmentScenario[], surplus: InvestmentSurplus): boolean {
  return (
    surplus.averageMonthlyCents !== null &&
    scenarios.length > 0 &&
    scenarios.every((scenario) => scenario.feasibility !== null && !scenario.feasibility.feasible)
  );
}
