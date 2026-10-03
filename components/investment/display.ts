import type { BasisPoints, Cents } from '@/lib/money';

/**
 * Apresentação do planejador (T-303). Nada aqui calcula dinheiro: só escolhe o texto de
 * um valor que a API já entregou. Fora do .tsx porque o vitest não transforma JSX.
 */

export type ScenarioLabel = 'conservative' | 'moderate' | 'optimistic';

export const SCENARIO_ORDER: readonly ScenarioLabel[] = ['conservative', 'moderate', 'optimistic'];

const SCENARIO_NAMES: Record<ScenarioLabel, string> = {
  conservative: 'Conservador',
  moderate: 'Médio',
  optimistic: 'Otimista',
};

export function scenarioName(label: ScenarioLabel): string {
  return SCENARIO_NAMES[label];
}

/** Acima disto o tempo deixa de ser plano e vira "mais de 100 anos" (handoff T-303). */
export const MAX_MONTHS_SHOWN = 1200;

export type MonthsSummary =
  | { kind: 'unreachable'; text: string }
  | { kind: 'reached'; text: string }
  | { kind: 'too-long'; text: string }
  | { kind: 'time'; text: string };

/**
 * `monthsWithCurrentContribution` (CONTRACTS §12) em português.
 * `null` é "não existe resposta" (a curva nunca cruza o alvo), nunca zero. Valor que não
 * seja um inteiro finito >= 0 também cai em "inalcançável": jamais `NaN` na tela.
 */
export function formatMonthsToTarget(months: number | null): MonthsSummary {
  if (months === null || !Number.isInteger(months) || months < 0) {
    return { kind: 'unreachable', text: 'Inalcançável com o aporte atual' };
  }
  if (months === 0) return { kind: 'reached', text: 'Meta já atingida' };
  if (months > MAX_MONTHS_SHOWN) return { kind: 'too-long', text: 'Mais de 100 anos' };
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${String(years)} ${years === 1 ? 'ano' : 'anos'}`);
  if (rest > 0) parts.push(`${String(rest)} ${rest === 1 ? 'mês' : 'meses'}`);
  return { kind: 'time', text: parts.join(' e ') };
}

/** Texto do "viável": o aporte atual chega ao alvo dentro do maior horizonte? */
export function feasibleText(feasible: boolean, maxYears: number): string {
  return feasible
    ? `Sim: o aporte atual chega ao alvo em até ${String(maxYears)} anos.`
    : `Não: com o aporte atual o alvo passa de ${String(maxYears)} anos.`;
}

/** `300` -> `3`, `350` -> `3,5`, `-150` -> `-1,5`: o que a pessoa digita, com vírgula. */
export function bpToPercentInput(bp: BasisPoints | number): string {
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  if (fraction === 0) return `${sign}${String(whole)}`;
  const digits = String(fraction).padStart(2, '0').replace(/0$/, '');
  return `${sign}${String(whole)},${digits}`;
}

/**
 * `"3,5"`, `"3.5"`, `" 4,50% "` -> basis points (350, 350, 450). Sem float: separa a parte
 * inteira da fracionária no texto. Até 2 casas; fora do formato ou da faixa -> `null`.
 */
export function percentInputToBp(text: string, min: number, max: number): number | null {
  const match = /^(-)?(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/%$/, '').trim());
  if (match === null) return null;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(2, '0') || '0');
  const bp = (match[1] === '-' ? -1 : 1) * (whole * 100 + fraction);
  const normalized = bp === 0 ? 0 : bp;
  return normalized < min || normalized > max ? null : normalized;
}

/**
 * Valor compacto para o eixo do gráfico: `R$ 1,2 mi`, `R$ 350 mil`, `R$ 80`. É só rótulo
 * de eixo (o valor exato aparece nas tabelas, via `Money`); arredonda para a legibilidade.
 */
export function formatCompactBRL(value: Cents): string {
  const reais = Math.abs(value) / 100;
  const sign = value < 0 ? '-' : '';
  if (reais >= 1_000_000) {
    return `${sign}R$ ${String(Math.round(reais / 100_000) / 10).replace('.', ',')} mi`;
  }
  if (reais >= 1_000) return `${sign}R$ ${String(Math.round(reais / 1_000))} mil`;
  return `${sign}R$ ${String(Math.round(reais))}`;
}

/** Rótulo do eixo X da curva: `month` = meses desde hoje. */
export function yearTickLabel(month: number): string {
  if (month === 0) return 'hoje';
  const years = month / 12;
  return `${String(years)} ${years === 1 ? 'ano' : 'anos'}`;
}

export type SaveEvent = 'created' | 'saved';

/** Confirmação curta depois do POST (criar) e do PUT (salvar). */
export function confirmationText(event: SaveEvent): string {
  return event === 'created' ? 'Plano criado.' : 'Alterações salvas.';
}

/**
 * Texto ao lado do botão "Salvar e recalcular". O botão fica cinza quando não há mudança, e
 * cinza sem explicação parece "não salvou": enquanto não há o que salvar, a tela diz isso.
 * Durante o envio o botão já diz "Salvando…", então não há dica.
 */
export function saveButtonHint(state: { dirty: boolean; saving: boolean }): string | null {
  if (state.saving || state.dirty) return null;
  return 'Nada para salvar: altere algum valor acima.';
}

/** A confirmação só vale enquanto o formulário está igual ao que foi salvo: editar a apaga. */
export function visibleConfirmation(event: SaveEvent | null, dirty: boolean): string | null {
  return event === null || dirty ? null : confirmationText(event);
}
