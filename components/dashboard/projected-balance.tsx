import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { BalanceChart } from '@/components/cashflow/balance-chart';
import { Verdict } from '@/components/cashflow/verdict';
import type { CashflowProjection } from '@/lib/finance/cashflow';

type ProjectedBalanceProps = {
  projection: CashflowProjection;
  /** Avisos de cobertura do adaptador do fluxo (previsão que acaba antes de 12 meses etc.). */
  warnings: readonly string[];
};

/**
 * Gráfico 3 da SPEC §5.8: saldo projetado, linha, próximos 12 meses.
 *
 * NÃO é um segundo gráfico de saldo: é o `BalanceChart` e o `Verdict` da tela de
 * fluxo (T-207), alimentados pela MESMA projeção — a página chama
 * `loadProjectedCashflow`, o mesmo caminho de `/fluxo`. Por isso o veredito, o
 * mês negativo e a ressalva do otimismo são idênticos nas duas telas; se um dia
 * divergirem, é porque alguém montou uma segunda entrada para o motor.
 */
export function ProjectedBalance({ projection, warnings }: ProjectedBalanceProps) {
  return (
    <div className="flex flex-col gap-3">
      <Verdict projection={projection} baseProjection={null} />
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
        <BalanceChart months={projection.months} baseMonths={null} />
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-amber-900">
            {warnings.map((warning) => (
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
