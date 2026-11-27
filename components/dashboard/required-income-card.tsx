import { Target } from 'lucide-react';

import { Money } from '@/components/ui-kit';

import { monthName } from './presentation';
import { averageNote, AVERAGE_WINDOW_MONTHS, previousMonthNote, type RequiredIncome } from './required-income';

type RequiredIncomeCardProps = {
  required: RequiredIncome;
};

function Item({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-4 sm:flex-col sm:items-start sm:justify-start sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold text-foreground">{children}</dd>
      <dd className="basis-full text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}

/**
 * "Renda necessária": quanto precisa entrar no próximo mês para repetir o padrão de gasto sem ficar no
 * vermelho, por duas réguas: a média dos últimos 6 meses fechados e o gasto do mês anterior. É a meta que a
 * pessoa usa para planejar a sobra (o que passar dela pode virar aporte). Esta tela NÃO calcula nada: os
 * valores vêm de `requiredIncome`, sobre a mesma despesa do card "Despesa do mês".
 */
export function RequiredIncomeCard({ required }: RequiredIncomeCardProps) {
  const { average, previousMonth, nextCompetence } = required;
  const hasPrevious = previousMonth.expenseCents > 0;

  return (
    <section aria-labelledby="dashboard-required-income-heading" className="flex flex-col gap-0 border border-border bg-card">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 id="dashboard-required-income-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Renda necessária para {monthName(nextCompetence)}
        </h2>
        <p className="text-sm text-muted-foreground">
          Se o gasto seguir nesse ritmo, esta é a renda mínima do mês para não ficar no vermelho. O que passar
          disso pode virar investimento.
        </p>
      </div>

      {average === null && !hasPrevious ? (
        <p className="p-4 text-sm text-muted-foreground sm:p-5">
          Ainda não há despesa nos meses fechados para calcular esta meta.
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Item
            label={`Pela média dos últimos ${AVERAGE_WINDOW_MONTHS} meses`}
            note={average === null ? 'Sem despesa nos meses fechados.' : averageNote(average)}
          >
            {average === null ? '—' : <Money value={average.averageCents} sign="never" />}
          </Item>
          <Item label={`Pelo gasto de ${monthName(previousMonth.competence)}`} note={previousMonthNote(previousMonth)}>
            {hasPrevious ? <Money value={previousMonth.expenseCents} sign="never" /> : '—'}
          </Item>
        </dl>
      )}
    </section>
  );
}
