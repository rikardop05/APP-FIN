import Link from 'next/link';
import { AlertTriangle, LineChart } from 'lucide-react';

import { BalanceChart } from '@/components/cashflow/balance-chart';
import { EmptyState } from '@/components/ui-kit';
import type { CashflowProjection } from '@/lib/finance/cashflow';
import type { OverdueScenario } from './presentation';

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
  | {
      kind: 'ok';
      projection: CashflowProjection;
      warnings: readonly string[];
      /** Segunda leitura (Esquadro): a projeção com as faturas anteriores não pagas descontadas. */
      withOverdue?: OverdueScenario;
    }
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
        className="border border-border bg-card p-4 sm:p-5"
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
        className="border border-warning/50 bg-warning-soft p-4 text-sm text-warning sm:p-5"
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
    <section
      aria-labelledby="dashboard-projected-heading"
      className="flex flex-col gap-2 border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-projected-heading" className="text-base font-semibold text-foreground">
          Saldo projetado
        </h2>
        <Link
          href="/fluxo"
          className="min-h-11 text-sm text-primary underline underline-offset-2 sm:min-h-0"
        >
          Ver fluxo completo e simular
        </Link>
      </div>
      <BalanceChart months={state.projection.months} baseMonths={null} />
      <p className="text-sm text-muted-foreground">
        Só enxerga o que já está cadastrado: gastos variáveis dos meses futuros não entram, então o saldo real
        tende a ficar abaixo da curva.
      </p>
      {state.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-warning">
          {state.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
