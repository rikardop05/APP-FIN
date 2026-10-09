import { Faixa, Money } from '@/components/ui-kit';

import type { InvestmentScenario, InvestmentSurplus } from '../schemas';

import { feasibilityLine, noScenarioFits, surplusBasisText, surplusExcludedText } from './text';

/**
 * T-304 (RF-INV-05): a ligação do planejador com a sobra real do orçamento. Só desenha o
 * que a API devolveu; o texto sai de `./text.ts`.
 */

/** Topo dos cenários: a "Sobra média mensal" (com os meses que ficaram fora) e, se nenhum cabe, o alerta. */
export function SurplusSummary({
  scenarios,
  surplus,
}: {
  scenarios: readonly InvestmentScenario[];
  surplus: InvestmentSurplus;
}) {
  const excluded = surplusExcludedText(surplus);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 border-y border-foreground py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sobra média mensal</p>
        {surplus.averageMonthlyCents === null ? (
          <p className="text-sm text-muted-foreground">Sem histórico: nenhum dos últimos 3 meses fechados teve receita lançada.</p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-foreground">
              <Money value={surplus.averageMonthlyCents} />
              <span className="text-sm font-normal text-muted-foreground"> por mês</span>
            </p>
            <p className="text-sm text-muted-foreground">Receitas menos despesas, {surplusBasisText(surplus)}.</p>
          </>
        )}
        {excluded ? <p className="text-sm text-muted-foreground">{excluded}</p> : null}
      </div>
      {noScenarioFits(scenarios, surplus) ? (
        <Faixa tone="attention" role="alert">
          <span>
            Nenhum cenário cabe na sua sobra de hoje: o aporte necessário passa do que sobra por mês em todos os três. Para
            chegar lá, é preciso aumentar a sobra, alongar o prazo ou rever a renda desejada.
          </span>
        </Faixa>
      ) : null}
    </div>
  );
}

const TONE_CLASS: Record<'neutral' | 'ok' | 'gap', string> = {
  neutral: 'text-muted-foreground',
  ok: 'text-success',
  gap: 'text-warning',
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
    <div className="flex flex-col gap-0.5 border border-border px-3 py-2 text-sm">
      <span className="text-muted-foreground">Cabe na sua sobra?</span>
      <span className={`font-medium ${TONE_CLASS[view.tone]}`}>{view.answer}</span>
      <span className="text-xs text-muted-foreground">{view.detail}</span>
    </div>
  );
}
