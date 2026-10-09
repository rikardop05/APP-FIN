import { competenceLong, competenceShort } from '@/components/cashflow/labels';
import type { Competence } from '@/lib/date';
import type { BasisPoints, Cents } from '@/lib/money';

/**
 * Textos e escolhas de apresentação do Painel (onda 2). Nada aqui calcula dinheiro novo: os números
 * vêm dos motores (`monthlyKpis`, `futureCommitment`, projeção do fluxo). Fora do .tsx porque o
 * vitest não transforma JSX.
 */

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

/** `2026-10` -> `outubro`. */
export function monthName(competence: Competence): string {
  const index = Number(competence.slice(5, 7)) - 1;
  const name = MONTH_NAMES[index];
  if (name === undefined) throw new RangeError(`Competência inválida: ${competence}.`);
  return name;
}

/** Rótulo do primeiro número do Painel: `Sobra de outubro` ou `Déficit de outubro`. */
export function surplusLabel(competence: Competence, surplusCents: number): string {
  return `${surplusCents < 0 ? 'Déficit' : 'Sobra'} de ${monthName(competence)}`;
}

/**
 * Linha de base da sobra: diz que é competência (em cartão, a da fatura) e que o mês está em andamento.
 */
export function surplusBaseLine(competence: Competence): string {
  return `Competência ${competenceShort(competence)}, em andamento: receita menos despesa, lançadas e previstas. Aporte e transferência ficam fora.`;
}

export type VerdictLine = { tone: 'ok' | 'danger' | 'neutral'; text: string };

/**
 * A frase do veredito de 12 meses, a mesma resposta de `/fluxo` (`firstNegativeCompetence`), em uma
 * linha. "Não fica negativo" vem sempre com a ressalva: só conta o que está cadastrado.
 */
export function verdictLine(
  state:
    | { kind: 'ok'; firstNegativeCompetence: Competence | null; monthsCount: number }
    | { kind: 'empty' }
    | { kind: 'unavailable' },
): VerdictLine {
  if (state.kind === 'unavailable') {
    return { tone: 'neutral', text: 'Não foi possível projetar o saldo agora.' };
  }
  if (state.kind === 'empty') {
    return { tone: 'neutral', text: 'Cadastre saldo, receitas e despesas fixas para ver o saldo dos próximos meses.' };
  }
  if (state.firstNegativeCompetence === null) {
    return {
      tone: 'ok',
      text: `O saldo não fica negativo nos próximos ${state.monthsCount} meses, com o que está cadastrado.`,
    };
  }
  return {
    tone: 'danger',
    text: `O saldo fica negativo em ${competenceLong(state.firstNegativeCompetence)}.`,
  };
}

export type NextMonthCommitment = { competence: Competence; cents: Cents } | null;

/** Comprometido do mês que vem (magnitude); `null` sem mês seguinte ou sem dívida nele. */
export function nextMonthCommitment(
  byCompetence: readonly { competence: Competence; totalCents: Cents }[],
): NextMonthCommitment {
  const next = byCompetence[1];
  if (next === undefined || next.totalCents >= 0) return null;
  return { competence: next.competence, cents: -next.totalCents as Cents };
}

export type PendingSummary = { total: number; parts: string[] };

/** "2 sem categoria · 1 fatura divergente": as partes da contagem de pendências. */
export function pendingSummary(input: {
  uncategorizedCount: number;
  divergentCount: number;
  overBudgetCount: number;
  overdueRecurringCount: number;
}): PendingSummary {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(input.uncategorizedCount, 'sem categoria', 'sem categoria');
  add(input.divergentCount, 'fatura divergente', 'faturas divergentes');
  add(input.overBudgetCount, 'orçamento estourado', 'orçamentos estourados');
  add(input.overdueRecurringCount, 'despesa fixa em atraso', 'despesas fixas em atraso');
  const total =
    input.uncategorizedCount + input.divergentCount + input.overBudgetCount + input.overdueRecurringCount;
  return { total, parts };
}

/** Título do bloco de pendências: contagem, nunca lista. */
export function pendingTitle(total: number): string {
  if (total === 0) return 'Nada pendente';
  return total === 1 ? '1 pendência' : `${total} pendências`;
}

export type CommitmentRow = { key: string; label: string; valueCents: Cents };

/**
 * As linhas do card "Comprometido nos cartões". O motor devolve valores NEGATIVOS (saída); a tela mostra
 * a magnitude, então cada linha vira `-valor`. As linhas fecham EXATAMENTE com o total (`-total`).
 * "Compras já lançadas em faturas futuras" só aparece quando não é zero.
 */
export function commitmentRows(
  breakdown: { currentStatementCents: Cents; laterInstallmentsCents: Cents; laterPurchasesCents: Cents },
  competence: Competence,
): CommitmentRow[] {
  const rows: CommitmentRow[] = [
    {
      key: 'current',
      label: `Faturas de ${competenceShort(competence)}`,
      valueCents: -breakdown.currentStatementCents as Cents,
    },
    {
      key: 'installments',
      label: 'Parcelas das faturas seguintes',
      valueCents: -breakdown.laterInstallmentsCents as Cents,
    },
  ];
  if (breakdown.laterPurchasesCents !== 0) {
    rows.push({
      key: 'purchases',
      label: 'Compras já lançadas em faturas futuras',
      valueCents: -breakdown.laterPurchasesCents as Cents,
    });
  }
  return rows;
}

/** O total do card, na mesma convenção das linhas (magnitude de saída). */
export function commitmentTotal(totalCents: Cents): Cents {
  return -totalCents as Cents;
}

/** "Termina de pagar em mm/aaaa" (ou "Comprometido até", se bate no fim da janela). */
export function commitmentEndLine(
  lastCommittedCompetence: Competence | null,
  windowEnd: Competence,
): string | null {
  if (lastCommittedCompetence === null) return null;
  return lastCommittedCompetence === windowEnd
    ? `Comprometido até ${competenceShort(lastCommittedCompetence)}. Pode haver parcelas depois da janela.`
    : `Termina de pagar em ${competenceShort(lastCommittedCompetence)}.`;
}

/**
 * Canhotos presos: os meses seguintes com dívida, no máximo `limit`; o resto vira contagem. Só entram
 * meses devedores (total negativo): mês só com estorno não é comprometimento.
 */
export function stubMonths<T extends { competence: Competence; totalCents: Cents }>(
  byCompetence: readonly T[],
  limit: number,
): { shown: T[]; hiddenCount: number } {
  const later = byCompetence.slice(1).filter((entry) => entry.totalCents < 0);
  return { shown: later.slice(0, limit), hiddenCount: Math.max(0, later.length - limit) };
}

/** "Aportes de outubro". */
export function contributionsTitle(competence: Competence): string {
  return `Aportes de ${monthName(competence)}`;
}

export type VariationView = { text: string; tone: 'muted' | 'attention' | 'ok' };

/**
 * Variação contra a média de 3 meses. Sem gasto no mês, ou sem média, NÃO há variação a mostrar: nada
 * de "-100%" verde para categoria sem dado. Gastar mais que a média é atenção (não vermelho: vermelho é
 * perigo); gastar menos é verde.
 */
export function variationView(input: {
  spentCents: Cents;
  average3mCents: Cents;
  variationBp: BasisPoints | null;
}): VariationView {
  if (input.spentCents === 0) return { text: 'sem gasto no mês', tone: 'muted' };
  if (input.variationBp === null) return { text: 'sem média', tone: 'muted' };
  const value = input.variationBp as number;
  if (value === 0) return { text: '0%', tone: 'muted' };
  const whole = Math.floor(Math.abs(value) / 100);
  const fraction = Math.abs(value) % 100;
  const text = `${value > 0 ? '+' : '−'}${whole},${String(fraction).padStart(2, '0')}%`;
  return { text, tone: value > 0 ? 'attention' : 'ok' };
}

/** Explicação curta do KPI "Essenciais / renda". */
export const ESSENTIAL_SHARE_HINT =
  'Quanto da receita do mês foi para despesa essencial, como moradia, mercado e saúde.';

/** Explicação curta da taxa de poupança. */
export const SAVINGS_RATE_HINT = 'Quanto da receita do mês sobrou depois das despesas.';
