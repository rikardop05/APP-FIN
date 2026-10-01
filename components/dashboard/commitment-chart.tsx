import { CalendarClock } from 'lucide-react';

import { competenceShort } from '@/components/cashflow/labels';
import { EmptyState } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import { cents, formatBRL, type Cents } from '@/lib/money';

import { BarChart, type BarGroup } from './bar-chart';

type CommitmentChartProps = {
  /** `futureCommitment().byCompetence`: `totalCents` NEGATIVO = saldo devedor naquele mês. */
  entries: readonly { competence: Competence; totalCents: Cents }[];
};

/**
 * Gráfico 4 da SPEC §5.8: comprometimento futuro, barras, próximos N meses (N =
 * `commitment_months` do household, nunca um número fixo aqui).
 *
 * Alimentado por `futureCommitment().byCompetence` — o MESMO retorno do resumo de
 * texto ao lado, para o gráfico e o texto não discordarem. A barra é a magnitude
 * do saldo DEVEDOR: mês com total positivo (só estorno) não é comprometimento
 * (CONTRACTS §5) e fica sem barra.
 *
 * O subtítulo diz o que a soma realmente é: o que já está lançado nas faturas de
 * cartão de cada mês. O feed é toda linha de cartão, então previsão recorrente em
 * cartão entra junto — não prometo "só parcelas".
 */
export function CommitmentChart({ entries }: CommitmentChartProps) {
  const indebted = entries.filter((entry) => entry.totalCents < 0);

  const header = (
    <div className="mb-3">
      <h2 id="dashboard-commitment-chart-heading" className="text-base font-semibold text-foreground">
        Comprometimento futuro
      </h2>
      <p className="text-sm text-muted-foreground">
        Já lançado nas faturas de cartão dos próximos {entries.length} meses.
      </p>
    </div>
  );

  if (indebted.length === 0) {
    return (
      <section
        aria-labelledby="dashboard-commitment-chart-heading"
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        {header}
        <EmptyState
          icon={CalendarClock}
          title="Nenhum comprometimento futuro"
          description="Não há mês devedor na janela. Estorno isolado não conta como comprometimento."
          action={{ label: 'Ver cartões', href: '/cartoes' }}
        />
      </section>
    );
  }

  const groups: BarGroup[] = entries.map((entry) => {
    const debt = entry.totalCents < 0 ? -entry.totalCents : 0;
    return {
      key: entry.competence,
      label: competenceShort(entry.competence),
      values: { debt },
      titles: {
        debt: `${competenceShort(entry.competence)} · ${debt > 0 ? formatBRL(cents(debt)) : 'sem comprometimento'}`,
      },
    };
  });
  const max = indebted.reduce((m, entry) => Math.max(m, -entry.totalCents), 0);
  const first = entries[0];
  const last = entries[entries.length - 1];

  return (
    <section
      aria-labelledby="dashboard-commitment-chart-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      {header}
      <BarChart
        series={[{ id: 'debt', label: 'Comprometido no mês', fillClass: 'fill-indigo-600' }]}
        groups={groups}
        maxLabel={formatBRL(cents(max))}
        ariaLabel={`Comprometimento em cartão de ${first ? competenceShort(first.competence) : ''} a ${last ? competenceShort(last.competence) : ''}`}
      />
    </section>
  );
}
