import { addCompetence, toCompetence, type Competence } from '@/lib/date';

/**
 * Mês mostrado em `/lancamentos` (Lote 2, item 5): uma competência `YYYY-MM` ou todos os meses.
 * Lógica pura, fora do .tsx (o vitest não transforma JSX). O mês é a COMPETÊNCIA, o eixo do app:
 * em cartão, a da fatura.
 */
export type MonthView = Competence | 'all';

export const ALL_MONTHS = 'all' satisfies MonthView;

/** Valor de `?mes=` para "Todos os meses". */
const ALL_PARAM = 'todos';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type InitialView = {
  month: MonthView;
  /** Deep link do Painel (`?semCategoria=1`): abre já filtrado nos não categorizados. */
  uncategorized: boolean;
};

/**
 * O que a URL pede ao abrir a tela.
 *
 * - `?mes=2026-11` abre aquele mês; `?mes=todos` abre todos; sem `mes` (ou com valor inválido) abre o
 *   mês corrente.
 * - `?semCategoria=1` (deep link do Painel) abre em TODOS os meses e com o filtro "não categorizados":
 *   a pendência pode estar em qualquer mês, e abrir só no corrente a esconderia. Um `mes` explícito
 *   junto vence.
 * - `?aplicarRegras=1` não muda o mês; quem o trata é a tela.
 */
export function initialView(params: SearchParams, today: string): InitialView {
  const uncategorized = first(params.semCategoria) === '1';
  const requested = first(params.mes);
  if (requested === ALL_PARAM) return { month: ALL_MONTHS, uncategorized };
  if (requested !== undefined && MONTH_PATTERN.test(requested)) return { month: requested, uncategorized };
  return { month: uncategorized ? ALL_MONTHS : toCompetence(today), uncategorized };
}

/**
 * A URL que representa o estado da tela (para `history.replaceState`): o mês corrente é o padrão e não
 * leva parâmetro; "não categorizados" só entra quando veio do deep link e segue ativo.
 */
export function viewHref(month: MonthView, today: string, options: { uncategorized?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (options.uncategorized === true) {
    params.set('semCategoria', '1');
    // Com o deep link, "todos" é o padrão; só um mês específico precisa aparecer.
    if (month !== ALL_MONTHS) params.set('mes', month);
  } else if (month === ALL_MONTHS) {
    params.set('mes', ALL_PARAM);
  } else if (month !== toCompetence(today)) {
    params.set('mes', month);
  }
  const query = params.toString();
  return query === '' ? '/lancamentos' : `/lancamentos?${query}`;
}

/** Mês anterior (`-1`) ou seguinte (`+1`). Em "todos os meses" não há de onde andar: fica como está. */
export function shiftMonth(month: MonthView, delta: -1 | 1): MonthView {
  return month === ALL_MONTHS ? month : addCompetence(month, delta);
}

/** Alterna "Todos os meses": ligado volta ao mês corrente; desligado abre todos. */
export function toggleAllMonths(month: MonthView, today: string): MonthView {
  return month === ALL_MONTHS ? toCompetence(today) : ALL_MONTHS;
}

/** `'2026-11'` para a consulta; `undefined` em "todos os meses" (a consulta não filtra por mês). */
export function competenceParam(month: MonthView): Competence | undefined {
  return month === ALL_MONTHS ? undefined : month;
}

/** Rótulo do terceiro número do resumo: `Sobra`, ou `Déficit` quando a despesa passa da receita. */
export function surplusLabel(surplusCents: number): 'Sobra' | 'Déficit' {
  return surplusCents < 0 ? 'Déficit' : 'Sobra';
}

/** `1 lançamento` / `73 lançamentos`. */
export function countLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

/** Texto do botão de revisão: só existe com pendência, e leva a contagem do household. */
export function reviewLabel(uncategorizedCount: number): string | null {
  if (uncategorizedCount <= 0) return null;
  return `Revisar ${String(uncategorizedCount)} sem categoria`;
}
