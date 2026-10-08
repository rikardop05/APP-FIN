import Link from 'next/link';
import { AlertTriangle, TrendingUp } from 'lucide-react';

import { BAR_X_CLASS, barScaleStyle } from '@/components/dashboard/bar-scale';
import { AccumulationChart } from '@/components/investment/accumulation-chart';
import { Money } from '@/components/ui-kit';
import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import { basisPoints } from '@/lib/money';

import type { PassiveIncomeState } from './passive-income';

const SECTION = 'rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5';

function Bar({ bp, label }: { bp: number; label: string }) {
  const percent = Math.min(100, Math.max(0, bp / 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div className={`${BAR_X_CLASS} bg-primary`} style={barScaleStyle(percent, 'x')} />
    </div>
  );
}

/**
 * Gráfico 5 da SPEC §5.8: progresso da renda passiva, patrimônio atual vs alvo, com as 3
 * curvas de cenário (T-306). Só desenha o que o planejador (`/investimentos`) calculou; o
 * estado vem de `buildPassiveIncomeState`. A prop é obrigatória no painel, e "indisponível"
 * é um estado escrito, não uma seção que some.
 */
export function PassiveIncomeCard({ state }: { state: PassiveIncomeState }) {
  if (state.kind === 'none') {
    return (
      <section aria-labelledby="dashboard-passive-heading" className={SECTION}>
        <h2 id="dashboard-passive-heading" className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
          Renda passiva
        </h2>
        <p className="text-sm text-muted-foreground">
          Descubra quanto juntar para viver de renda e em quanto tempo você chega lá.
        </p>
        <Link
          href="/investimentos"
          className="mt-3 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Monte seu plano de renda passiva
        </Link>
      </section>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <section
        aria-labelledby="dashboard-passive-heading"
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:p-5"
      >
        <h2 id="dashboard-passive-heading" className="mb-1 flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          Renda passiva indisponível
        </h2>
        <p>
          Não foi possível carregar o plano agora.{' '}
          <Link href="/investimentos" className="underline underline-offset-2">
            Tente abrir o planejador
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="dashboard-passive-heading" className={SECTION}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dashboard-passive-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
          Renda passiva
        </h2>
        <p className="text-xs text-muted-foreground">Valores em R$ de hoje</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {state.planName}: renda desejada de <Money value={state.desiredMonthlyIncomeCents} sign="never" /> por mês.
      </p>

      <p className="mt-3 text-sm text-muted-foreground">Patrimônio atual</p>
      <p className="text-2xl font-semibold tracking-tight"><Money value={state.currentPortfolioCents} sign="never" /></p>

      <ul className="mt-3 flex flex-col gap-3" aria-label="Alvo por cenário">
        {state.scenarios.map((row) => (
          <li key={row.label} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className={row.label === 'moderate' ? 'font-semibold' : 'font-medium text-muted-foreground'}>
                {row.name}: alvo <Money value={row.targetCents} sign="never" />
              </span>
              <span className="text-xs text-muted-foreground">
                {row.progressBp === null ? 'sem alvo' : formatBasisPoints(basisPoints(row.progressBp))}
              </span>
            </div>
            {row.progressBp === null ? null : <Bar bp={row.progressBp} label={`Progresso até o alvo do cenário ${row.name.toLowerCase()}`} />}
            <p className="text-xs text-muted-foreground">Com o aporte atual: {row.timeText}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <AccumulationChart
          compact
          scenarios={state.curves}
          reference={state.moderateTargetCents === null ? null : { label: 'Alvo médio', valueCents: state.moderateTargetCents }}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Patrimônio nos próximos {state.horizonYears} anos, mantendo o aporte atual. Retorno passado não é garantia de retorno futuro.
        </p>
      </div>

      <Link href="/investimentos" className="mt-3 inline-block text-sm font-medium underline underline-offset-2">
        Ver o planejador
      </Link>
    </section>
  );
}
