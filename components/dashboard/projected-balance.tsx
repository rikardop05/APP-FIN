import Link from 'next/link';
import { AlertTriangle, LineChart } from 'lucide-react';

import { BalanceChart } from '@/components/cashflow/balance-chart';
import { Verdict } from '@/components/cashflow/verdict';
import { EmptyState } from '@/components/ui-kit';
import type { CashflowProjection } from '@/lib/finance/cashflow';

/**
 * Os três estados possíveis da projeção no painel. É um tipo FECHADO e a prop é
 * OBRIGATÓRIA em `DashboardScreen`: quem monta a página tem de dizer qual é, e o
 * compilador reprova o esquecimento. (A versão anterior tinha `projected?` — a
 * página não passava nada, o gráfico nunca renderizou, e nenhum gate acusou.)
 *
 *  - `ok`          há o que projetar: curva, veredito e a ressalva do otimismo;
 *  - `empty`       saldo zero e nada cadastrado na janela (`hasProjectableData`);
 *  - `unavailable` o cálculo falhou. A tela diz que falhou — não some, e não finge
 *                  que está tudo bem —, e o erro vai para o log da página.
 */
export type ProjectedState =
  | { kind: 'ok'; projection: CashflowProjection; warnings: readonly string[] }
  | { kind: 'empty' }
  | { kind: 'unavailable' };

/**
 * Gráfico 3 da SPEC §5.8: saldo projetado, linha, próximos 12 meses.
 *
 * NÃO é um segundo gráfico de saldo: é o `BalanceChart` e o `Verdict` da tela de
 * fluxo (T-207), alimentados pela MESMA projeção — a página chama
 * `loadProjectedCashflow`, o mesmo caminho de `/fluxo`. Por isso o veredito, o mês
 * negativo e a ressalva do otimismo são idênticos nas duas telas; se um dia
 * divergirem, é porque alguém montou uma segunda entrada para o motor.
 */
export function ProjectedBalance({ state }: { state: ProjectedState }) {
  if (state.kind === 'empty') {
    return (
      <section
        aria-labelledby="dashboard-projected-heading"
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <h2 id="dashboard-projected-heading" className="mb-3 text-base font-semibold text-foreground">
          Saldo projetado
        </h2>
        <EmptyState
          icon={LineChart}
          title="Projeção ainda não disponível"
          description="Ela depende de saldo em conta, despesas recorrentes, receitas e faturas cadastradas."
          action={{ label: 'Ver fluxo de caixa', href: '/fluxo' }}
        />
      </section>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <section
        aria-labelledby="dashboard-projected-heading"
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:p-5"
      >
        <h2 id="dashboard-projected-heading" className="mb-1 flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          Saldo projetado indisponível
        </h2>
        <p>
          Não foi possível calcular a projeção agora.{' '}
          <Link href="/fluxo" className="underline underline-offset-2">
            Tente abrir o fluxo de caixa
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Verdict projection={state.projection} baseProjection={null} />
      <section
        aria-labelledby="dashboard-projected-heading"
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dashboard-projected-heading" className="text-base font-semibold text-foreground">
            Saldo projetado
          </h2>
          <Link
            href="/fluxo"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Ver fluxo completo e simular →
          </Link>
        </div>
        <BalanceChart months={state.projection.months} baseMonths={null} />
        {state.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-amber-900">
            {state.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
