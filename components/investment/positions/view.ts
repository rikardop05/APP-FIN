import { competenceShort } from '@/components/cashflow/labels';
import { scenarioName } from '@/components/investment/display';
import { formatDateBR } from '@/lib/date';
import { formatBRL, parseBRL, type Cents } from '@/lib/money';

import type { AdherenceMonth, ComparisonEntry, PositionsData, Snapshot } from './schemas';

/**
 * Texto e estado da tela de posições reais (T-404). Nenhuma conta de dinheiro aqui: aderência
 * e comparação vêm prontas do motor (`lib/finance/positions`, via `/api/investment/positions`).
 * Este módulo só escolhe o que dizer. Fora do .tsx porque o vitest não transforma JSX.
 */

/** RF-INV-01 na tela de posições: o registrado é nominal, a projeção é em R$ de hoje. */
export const NOMINAL_NOTICE =
  'O valor que você registra é o de hoje; a comparação usa a projeção em R$ de hoje.';

export const NO_PLAN_TEXT =
  'A comparação com os cenários precisa de um plano de renda passiva. Você já pode registrar posições; o aporte efetivo abaixo vale mesmo sem plano.';

// ---------------------------------------------------------------------------
// Aporte efetivo x planejado
// ---------------------------------------------------------------------------

export type MonthRow = {
  competence: string;
  /** `out/2026`. */
  label: string;
  actualCents: Cents;
  /**
   * `tracked`: mês desde o início do plano, com aderência. `before_plan`: o plano ainda não
   * existia, só se mostra o efetivo. `no_plan`: não há plano, só o efetivo.
   */
  state: 'tracked' | 'before_plan' | 'no_plan';
  plannedCents: Cents | null;
  adherenceBp: number | null;
  belowPlan: boolean;
  /** Mês corrente, ainda incompleto: o "abaixo" dele não é alerta. */
  inProgress: boolean;
  /** Preenchimento da barra de 0 a 10000 (efetivo sobre o planejado, limitado a 100%); `null` sem barra. */
  barBp: number | null;
};

/**
 * Os 13 meses da janela (D5), na ordem. Mês com aporte 0 é dado, não ausência: a linha existe e
 * mostra R$ 0,00. Mês antes da âncora do plano aparece sem aderência ("antes do plano").
 */
export function buildMonthRows(
  data: Pick<PositionsData, 'contributions' | 'adherence' | 'plan' | 'currentCompetence'>,
): MonthRow[] {
  const tracked = new Map<string, AdherenceMonth>(
    (data.adherence?.months ?? []).map((month) => [month.competence, month]),
  );
  return data.contributions.map((contribution) => {
    const inProgress = contribution.competence === data.currentCompetence;
    const month = tracked.get(contribution.competence);
    if (month !== undefined) {
      return {
        competence: contribution.competence,
        label: competenceShort(contribution.competence),
        actualCents: month.actualCents,
        state: 'tracked',
        plannedCents: month.plannedCents,
        adherenceBp: month.adherenceBp,
        belowPlan: month.belowPlan,
        inProgress: month.inProgress,
        barBp: month.adherenceBp === null ? null : Math.min(10_000, Math.max(0, month.adherenceBp)),
      };
    }
    return {
      competence: contribution.competence,
      label: competenceShort(contribution.competence),
      actualCents: contribution.actualCents,
      state: data.plan === null ? 'no_plan' : 'before_plan',
      plannedCents: null,
      adherenceBp: null,
      belowPlan: false,
      inProgress,
      barBp: null,
    };
  });
}

export type AdherenceSummaryText = { headline: string; detail: string | null };

function monthsWord(count: number): string {
  return count === 1 ? 'mês' : 'meses';
}

/**
 * Resumo do aporte: "N de M meses abaixo do planejado" e a aderência média, só dos meses
 * FECHADOS. `null` sem plano (não há planejado para comparar). Sem mês fechado ou sem aporte
 * planejado, diz isso em vez de inventar um número.
 */
export function adherenceSummaryText(
  adherence: PositionsData['adherence'],
  formatPercent: (bp: number) => string,
): AdherenceSummaryText | null {
  if (adherence === null) return null;
  const { closedMonths, averageAdherenceBp, monthsBelowPlan } = adherence.summary;
  if (closedMonths === 0) {
    return { headline: 'Ainda não há mês fechado desde o início do plano.', detail: null };
  }
  if (averageAdherenceBp === null) {
    return { headline: 'Sem aporte planejado: a aderência não é calculada.', detail: null };
  }
  const closed = `${monthsWord(closedMonths)} ${closedMonths === 1 ? 'fechado' : 'fechados'}`;
  const headline =
    monthsBelowPlan === 0
      ? closedMonths === 1
        ? 'O único mês fechado não ficou abaixo do planejado.'
        : `Nenhum dos ${String(closedMonths)} ${closed} ficou abaixo do planejado.`
      : `${String(monthsBelowPlan)} de ${String(closedMonths)} ${closed} abaixo do planejado.`;
  return { headline, detail: `Aderência média: ${formatPercent(averageAdherenceBp)}.` };
}

// ---------------------------------------------------------------------------
// Posição real x projeção
// ---------------------------------------------------------------------------

export type ComparisonLine = { label: string; text: string; tone: 'ahead' | 'behind' | 'even' | 'none' };

/** Uma linha por cenário, ou uma só explicando por que não há comparação. */
export function comparisonLines(entry: ComparisonEntry | undefined): ComparisonLine[] {
  if (entry === undefined) return [];
  if (entry.status === 'before_plan') {
    return [{ label: '', text: 'Antes do plano: sem comparação com a projeção.', tone: 'none' }];
  }
  if (entry.status === 'beyond_curve') {
    return [{ label: '', text: 'Além da projeção: sem comparação.', tone: 'none' }];
  }
  return entry.byScenario.map((scenario) => {
    const label = scenarioName(scenario.label);
    const name = `cenário ${label.toLowerCase()}`;
    if (scenario.projectedCents === null || scenario.diffCents === null) {
      return { label, text: `Sem projeção do ${name} para esta data.`, tone: 'none' as const };
    }
    const projected = `projetado ${formatBRL(scenario.projectedCents, { sign: 'never' })}`;
    if (scenario.diffCents === 0) {
      return { label, text: `Igual ao ${name} (${projected}).`, tone: 'even' as const };
    }
    const amount = formatBRL(scenario.diffCents, { sign: 'never' });
    return scenario.diffCents > 0
      ? { label, text: `${amount} à frente do ${name} (${projected}).`, tone: 'ahead' as const }
      : { label, text: `${amount} atrás do ${name} (${projected}).`, tone: 'behind' as const };
  });
}

/** O registro com a comparação dele (a lista vem na mesma ordem de data, mas casa por data). */
export function comparisonFor(data: Pick<PositionsData, 'comparison'>, snapshot: Snapshot): ComparisonEntry | undefined {
  return data.comparison?.find((entry) => entry.asOf === snapshot.asOf);
}

/** Registros do mais recente para o mais antigo (o que se quer ver primeiro). */
export function sortSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  return [...snapshots].sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0));
}

// ---------------------------------------------------------------------------
// Formulário "Registrar posição"
// ---------------------------------------------------------------------------

export type SnapshotFormValues = { asOf: string; amount: string; note: string };
export type SnapshotFormErrors = Partial<Record<keyof SnapshotFormValues, string>>;
export type SnapshotRequestBody = { asOf: string; portfolioCents: Cents; note: string | null };

export const NOTE_MAX = 280;

export function emptySnapshotValues(today: string): SnapshotFormValues {
  return { asOf: today, amount: '', note: '' };
}

export function snapshotToValues(snapshot: Snapshot): SnapshotFormValues {
  return { asOf: snapshot.asOf, amount: formatBRL(snapshot.portfolioCents), note: snapshot.note ?? '' };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    formatDateBR(value);
    return true;
  } catch {
    return false;
  }
}

/** Formulário -> corpo da API. Mesmas regras da borda (`schemas.ts`/`body.ts`): data real, não futura; total >= 0. */
export function buildSnapshotBody(
  values: SnapshotFormValues,
  today: string,
): { ok: true; body: SnapshotRequestBody } | { ok: false; errors: SnapshotFormErrors } {
  const errors: SnapshotFormErrors = {};
  if (!validDate(values.asOf)) errors.asOf = 'Informe uma data válida.';
  else if (values.asOf > today) errors.asOf = 'A data da posição não pode estar no futuro.';

  const amount = parseBRL(values.amount);
  if (values.amount.trim() === '' || amount === null || amount < 0) {
    errors.amount = 'Informe o total investido (zero ou mais).';
  }

  const note = values.note.trim();
  if (note.length > NOTE_MAX) errors.note = `A observação tem no máximo ${String(NOTE_MAX)} caracteres.`;

  if (Object.keys(errors).length > 0 || amount === null) return { ok: false, errors };
  return { ok: true, body: { asOf: values.asOf, portfolioCents: amount, note: note === '' ? null : note } };
}

const FIELD_LABELS: Record<keyof SnapshotFormValues, string> = {
  asOf: 'Data',
  amount: 'Total investido',
  note: 'Observação',
};

/** Resumo para o texto perto do botão: "Data: ... · Total investido: ...". */
export function snapshotErrorSummary(errors: SnapshotFormErrors): string {
  const order: (keyof SnapshotFormValues)[] = ['asOf', 'amount', 'note'];
  const parts = order.flatMap((key) => (errors[key] === undefined ? [] : [`${FIELD_LABELS[key]}: ${errors[key]}`]));
  return `Confira os campos antes de registrar. ${parts.join(' · ')}`;
}

/** Id do campo a focar (o primeiro com erro). */
export function firstSnapshotErrorId(errors: SnapshotFormErrors): string | null {
  if (errors.asOf !== undefined) return 'position-date';
  if (errors.amount !== undefined) return 'position-amount';
  if (errors.note !== undefined) return 'position-note';
  return null;
}

// ---------------------------------------------------------------------------
// Confirmações e avisos
// ---------------------------------------------------------------------------

export type PositionEvent = 'created' | 'replaced' | 'edited' | 'deleted' | 'applied';

/** Confirmação curta depois de gravar (padrão do planejador, 8067aca). */
export function confirmationText(event: PositionEvent): string {
  switch (event) {
    case 'created':
      return 'Posição registrada.';
    case 'replaced':
      return 'Já havia um registro nesta data: ele foi atualizado.';
    case 'edited':
      return 'Registro atualizado.';
    case 'deleted':
      return 'Registro apagado.';
    case 'applied':
      return 'Patrimônio atual do plano atualizado.';
  }
}

/** POST devolve `saved.replaced`; PUT é sempre edição. */
export function eventAfterSave(input: { editing: boolean; replaced: boolean | undefined }): PositionEvent {
  if (input.editing) return 'edited';
  return input.replaced === true ? 'replaced' : 'created';
}

/** Pergunta curta antes de usar um registro como patrimônio do plano (D4). */
export function applyToPlanQuestion(snapshot: Snapshot): string {
  return (
    `Usar ${formatBRL(snapshot.portfolioCents, { sign: 'never' })} (posição de ${formatDateBR(snapshot.asOf)}) ` +
    'como o patrimônio atual do plano? Isso muda o ponto de partida das projeções: ' +
    'os cenários passam a partir deste valor e desta data.'
  );
}

export function deleteQuestion(snapshot: Snapshot): string {
  return `Apagar o registro de ${formatDateBR(snapshot.asOf)} (${formatBRL(snapshot.portfolioCents, { sign: 'never' })})?`;
}

/** O registro já é o ponto de partida do plano? (mesmo valor e a mesma competência da âncora da curva) */
export function isCurrentPortfolio(data: Pick<PositionsData, 'plan'>, snapshot: Snapshot): boolean {
  return (
    data.plan !== null &&
    data.plan.currentPortfolioCents === snapshot.portfolioCents &&
    data.plan.startCompetence === snapshot.asOf.slice(0, 7)
  );
}
