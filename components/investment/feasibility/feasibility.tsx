import { AlertTriangle } from 'lucide-react';

import { Money } from '@/components/ui-kit';

import type { InvestmentScenario, InvestmentSurplus } from '../schemas';

import { feasibilityLine, noScenarioFits, surplusBasisText } from './text';

/**
 * T-304 (RF-INV-05): a ligação do planejador com a sobra real do orçamento. Só desenha o
 * que a API devolveu; o texto sai de `./text.ts`.
 */

/** Topo dos cenários: a sobra média usada na comparação e, se nenhum cabe, o alerta. */
export function SurplusSummary({
  scenarios,
  surplus,
}: {
  scenarios: readonly InvestmentScenario[];
  surplus: InvestmentSurplus;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {surplus.averageMonthlyCents === null ? (
          <>Sobra real: sem histórico nos últimos 3 meses fechados.</>
        ) : (
          <>
            Sua sobra real (receitas menos despesas):{' '}
            <Money value={surplus.averageMonthlyCents} className="font-medium text-foreground" /> por mês, {surplusBasisText(surplus)}.
          </>
        )}
      </p>
      {noScenarioFits(scenarios, surplus) ? (
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Nenhum cenário cabe na sua sobra de hoje: o aporte necessário passa do que sobra por mês em todos os três. Para
            chegar lá, é preciso aumentar a sobra, alongar o prazo ou rever a renda desejada.
          </span>
        </p>
      ) : null}
    </div>
  );
}

const TONE_CLASS: Record<'neutral' | 'ok' | 'gap', string> = {
  neutral: 'text-muted-foreground',
  ok: 'text-emerald-800',
  gap: 'text-amber-800',
};

/** Linha "Cabe na sua sobra?" no cartão do cenário. */
export function FeasibilityLine({
  scenario,
  surplus,
}: {
  scenario: InvestmentScenario;
  surplus: InvestmentSurplus;
}) {
  const view = feasibilityLine(scenario.feasibility, surplus);
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-sm">
      <span className="text-muted-foreground">Cabe na sua sobra?</span>
      <span className={`font-medium ${TONE_CLASS[view.tone]}`}>{view.answer}</span>
      <span className="text-xs text-muted-foreground">{view.detail}</span>
    </div>
  );
}
