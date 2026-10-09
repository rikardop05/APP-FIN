'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import type { MonthComposition } from '@/app/_lib/to-cashflow-input';
import { type CashflowInput, type CashflowProjection, projectCashflow } from '@/lib/finance/cashflow';
import type { Competence } from '@/lib/date';

import { adjustmentTotals, expandAdjustments, type WhatIfItem } from './adjustments';
import { BalanceChart } from './balance-chart';
import { MonthTable } from './month-table';
import { Verdict } from './verdict';
import { WhatIfPanel } from './what-if-panel';

type FluxoScreenProps = {
  input: CashflowInput;
  /** Projeção real, calculada no servidor (falha lá, em voz alta, se a entrada estiver torta). */
  projection: CashflowProjection;
  composition: Record<Competence, MonthComposition>;
  warnings: string[];
};

/**
 * Tela do fluxo (T-207). A projeção real chega pronta do servidor; o "e se"
 * chama o MESMO motor puro, aqui, com `adjustments`. Nada daqui para fora: o
 * estado dos ajustes é `useState` e não é lido nem escrito em lugar nenhum.
 *
 * Não há conta de dinheiro neste arquivo.
 */
export function FluxoScreen({ input, projection, composition, warnings }: FluxoScreenProps) {
  const [items, setItems] = useState<WhatIfItem[]>([]);
  const window = useMemo(() => projection.months.map((month) => month.competence), [projection]);

  const simulation = useMemo(() => {
    if (items.length === 0) return null;
    const adjustments = expandAdjustments(items, window);
    return {
      projection: projectCashflow({ ...input, adjustments }),
      totals: adjustmentTotals(adjustments),
    };
  }, [items, window, input]);

  const shown = simulation?.projection ?? projection;

  return (
    <div className="flex flex-col gap-6">
      {warnings.length > 0 ? (
        <section
          aria-label="Avisos sobre os dados"
          className="flex flex-col gap-1 border border-warning/50 bg-warning-soft p-4 text-sm text-warning"
        >
          {warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          ))}
        </section>
      ) : null}

      <Verdict projection={shown} baseProjection={simulation ? projection : null} />

      <section
        aria-labelledby="fluxo-chart-heading"
        className="flex flex-col gap-2 border border-border bg-card p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="fluxo-chart-heading" className="text-base font-semibold">
            Saldo no fim de cada mês
          </h2>
          {simulation ? (
            <span className="text-xs text-muted-foreground">
              Linha cheia = com a simulação · tracejada = sem ela
            </span>
          ) : null}
        </div>
        <BalanceChart months={shown.months} baseMonths={simulation ? projection.months : null} />
      </section>

      <WhatIfPanel window={window} items={items} onChange={setItems} />

      <section
        aria-labelledby="fluxo-table-heading"
        className="flex flex-col gap-3 border border-border bg-card p-4 sm:p-5"
      >
        <h2 id="fluxo-table-heading" className="text-base font-semibold">
          Mês a mês{simulation ? ' (com a simulação)' : ''}
        </h2>
        <MonthTable
          months={shown.months}
          composition={composition}
          adjustments={simulation?.totals ?? null}
        />
      </section>
    </div>
  );
}
