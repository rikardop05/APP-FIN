import { BarChart3 } from 'lucide-react';

import { competenceShort } from '@/components/cashflow/labels';
import { EmptyState, Money } from '@/components/ui-kit';
import { cents, formatBRL } from '@/lib/money';

import { BarChart, type BarGroup } from './bar-chart';
import type { IncomeExpenseMonth } from './income-expense-series';

type IncomeExpenseChartProps = {
  months: readonly IncomeExpenseMonth[];
  currentCompetence: string;
};

/**
 * Gráfico 1 da SPEC §5.8: receita × despesa, barras agrupadas, últimos 12 meses.
 * Os números vêm de `buildIncomeExpenseSeries` (→ `monthlyKpis`), então a barra do
 * mês corrente é a mesma do card "Receita/Despesa do mês". O mês corrente inclui o
 * PREVISTO restante — o subtítulo diz isso, para ninguém achar que é só o
 * realizado. Verde = receita, cinza-escuro = despesa; vermelho fica reservado para
 * "saldo negativo", como na tela de fluxo.
 */
export function IncomeExpenseChart({ months, currentCompetence }: IncomeExpenseChartProps) {
  const hasData = months.some((month) => month.incomeCents > 0 || month.expenseCents > 0);

  const header = (
    <div className="mb-3">
      <h2 id="dashboard-income-expense-heading" className="text-base font-semibold text-foreground">
        Receita × despesa
      </h2>
      <p className="text-sm text-muted-foreground">
        Últimos {months.length} meses. {competenceShort(currentCompetence)} inclui o que ainda está previsto.
      </p>
    </div>
  );

  if (!hasData) {
    return (
      <section
        aria-labelledby="dashboard-income-expense-heading"
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        {header}
        <EmptyState
          icon={BarChart3}
          title="Sem lançamentos nos últimos 12 meses"
          description="Importe uma fatura ou cadastre receitas e despesas para ver a comparação."
          action={{ label: 'Importar', href: '/importar' }}
        />
      </section>
    );
  }

  const groups: BarGroup[] = months.map((month) => ({
    key: month.competence,
    label: competenceShort(month.competence),
    values: { income: month.incomeCents, expense: month.expenseCents },
    titles: {
      income: `${competenceShort(month.competence)} · receita ${formatBRL(month.incomeCents)}`,
      expense: `${competenceShort(month.competence)} · despesa ${formatBRL(month.expenseCents)}`,
    },
  }));
  const max = months.reduce((m, month) => Math.max(m, month.incomeCents, month.expenseCents), 0);
  const first = months[0];

  return (
    <section
      aria-labelledby="dashboard-income-expense-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      {header}
      <BarChart
        series={[
          { id: 'income', label: 'Receita', fillClass: 'fill-emerald-600' },
          { id: 'expense', label: 'Despesa', fillClass: 'fill-slate-600' },
        ]}
        groups={groups}
        maxLabel={formatBRL(cents(max))}
        ariaLabel={`Receita e despesa de ${competenceShort(first?.competence ?? currentCompetence)} a ${competenceShort(currentCompetence)}`}
      />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Ver os valores mês a mês</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Receita e despesa por mês</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-1 text-left font-medium">Mês</th>
              <th scope="col" className="py-1 text-right font-medium">Receita</th>
              <th scope="col" className="py-1 text-right font-medium">Despesa</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.competence} className="border-b border-border last:border-0">
                <th scope="row" className="py-1 text-left font-normal">{competenceShort(month.competence)}</th>
                <td className="py-1 text-right"><Money value={month.incomeCents} sign="never" /></td>
                <td className="py-1 text-right"><Money value={month.expenseCents} sign="never" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
