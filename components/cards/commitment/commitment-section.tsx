'use client';

import { BarChart3, CreditCard } from 'lucide-react';
import { toCompetence, type Competence } from '@/lib/date';
import { futureCommitment } from '@/lib/finance/commitment';
import type { BasisPoints, Cents } from '@/lib/money';
import { Badge, EmptyState, Money } from '@/components/ui-kit';
import type { CardList } from '../schemas';
import type { Transaction } from '@/components/transactions/schemas';

type CommitmentSectionProps = {
  cards: CardList['cards'];
  transactions: Transaction[];
  today: string;
};

const COMMITMENT_MONTHS = 24;

function competenceLabel(competence: Competence): string {
  return `${competence.slice(5)}/${competence.slice(0, 4)}`;
}

function formatBasisPoints(value: BasisPoints): string {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return `${whole},${String(fraction).padStart(2, '0')}%`;
}

function magnitude(value: Cents): number {
  return Math.abs(value);
}

function CommitmentChart({
  entries,
  maxMagnitude,
}: {
  entries: ReturnType<typeof futureCommitment>['byCompetence'];
  maxMagnitude: number;
}) {
  return (
    <div className="overflow-x-auto pb-2" role="img" aria-label="Gráfico de comprometimento por competência">
      <div className="flex min-w-[720px] items-end gap-2 px-1 pt-4 sm:min-w-0 sm:gap-3">
        {entries.map((entry) => {
          const isDebt = entry.totalCents < 0;
          const height = isDebt && maxMagnitude > 0
            ? Math.max(8, (magnitude(entry.totalCents) / maxMagnitude) * 100)
            : 0;

          return (
            <div key={entry.competence} className="flex min-w-6 flex-1 flex-col items-center gap-2">
              <div className="flex h-36 w-full items-end justify-center rounded-sm bg-secondary/50 px-1" title={isDebt ? undefined : 'Sem comprometimento devedor'}>
                {isDebt ? (
                  <div
                    className="w-full rounded-t-sm bg-primary transition-[height]"
                    style={{ height: `${height}%` }}
                    aria-label={`${competenceLabel(entry.competence)}: comprometimento devedor`}
                  />
                ) : null}
              </div>
              <span className="text-[10px] tabular text-muted-foreground [writing-mode:vertical-rl] sm:[writing-mode:horizontal-tb]">
                {entry.competence.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommitmentTable({
  entries,
}: {
  entries: ReturnType<typeof futureCommitment>['byCompetence'];
}) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[480px] text-left text-sm">
          <caption className="sr-only">Comprometimento futuro por competência</caption>
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Competência</th>
              <th className="px-3 py-3 text-right font-medium">Comprometimento</th>
              <th className="px-3 py-3 text-right font-medium">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => (
              <tr key={entry.competence} className={entry.totalCents < 0 ? undefined : 'text-muted-foreground'}>
                <th className="whitespace-nowrap px-3 py-3 font-medium">
                  {competenceLabel(entry.competence)}
                </th>
                <td className="px-3 py-3 text-right font-medium"><Money value={entry.totalCents} sign={entry.totalCents < 0 ? 'never' : 'auto'} /></td>
                <td className="px-3 py-3 text-right">
                  {entry.totalCents < 0 ? <Badge variant="neutral">Devedor</Badge> : <span>Sem comprometimento</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 sm:hidden">
        {entries.map((entry) => (
          <article key={entry.competence} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3">
            <div className="min-w-0">
              <h4 className="font-medium">{competenceLabel(entry.competence)}</h4>
              <p className="text-xs text-muted-foreground">
                {entry.totalCents < 0 ? 'Comprometimento devedor' : 'Sem comprometimento'}
              </p>
            </div>
            <Money value={entry.totalCents} sign={entry.totalCents < 0 ? 'never' : 'auto'} className="shrink-0 font-medium" />
          </article>
        ))}
      </div>
    </>
  );
}

function LimitUsage({
  cards,
  usage,
}: {
  cards: CardList['cards'];
  usage: ReturnType<typeof futureCommitment>['limitUsage'];
}) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));

  return (
    <section aria-labelledby="commitment-limit-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="commitment-limit-heading" className="text-base font-semibold tracking-tight">Uso de limite por cartão</h3>
        <p className="text-sm text-muted-foreground">Quanto do limite está comprometido na janela de 24 meses.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {usage.map((item) => {
          const card = cardsById.get(item.cardId);
          const usageBp = item.usageBp;
          const limitCents = card?.creditLimitCents;
          const hasLimit = usageBp !== null && limitCents !== null && limitCents !== undefined;
          const width = hasLimit ? Math.min(100, Math.max(0, usageBp / 100)) : 0;

          return (
            <article key={item.cardId} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h4 className="truncate font-medium">{card?.name ?? 'Cartão não identificado'}</h4>
                  {hasLimit ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      <Money value={item.usedCents} sign="never" /> de <Money value={limitCents} sign="never" />
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Limite não informado</p>
                  )}
                </div>
                {hasLimit ? <Badge variant="neutral">{formatBasisPoints(usageBp)}</Badge> : null}
              </div>
              {hasLimit ? (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`Uso de limite: ${formatBasisPoints(usageBp)}`}>
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${width}%` }} />
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CommitmentSection({ cards, transactions, today }: CommitmentSectionProps) {
  const fromCompetence = toCompetence(today);
  const result = futureCommitment({
    fromCompetence,
    months: COMMITMENT_MONTHS,
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      creditLimitCents: card.creditLimitCents,
    })),
    transactions: transactions.flatMap((transaction) =>
      transaction.creditCardId === null
        ? []
        : [{
            competence: transaction.competence,
            amountCents: transaction.amountCents,
            creditCardId: transaction.creditCardId,
            status: transaction.status,
          }],
    ),
  });
  const maxMagnitude = result.byCompetence.reduce(
    (maximum, entry) => Math.max(maximum, magnitude(entry.totalCents)),
    0,
  );
  const lastCommittedCompetence = result.lastCommittedCompetence;

  return (
    <section aria-labelledby="commitment-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="commitment-heading" className="text-lg font-semibold tracking-tight">Comprometimento futuro</h2>
        <p className="text-sm text-muted-foreground">Parcelas já contratadas nos próximos 24 meses.</p>
      </div>

      {lastCommittedCompetence !== null ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">
            {lastCommittedCompetence === result.byCompetence.at(-1)?.competence
              ? 'Comprometimento até'
              : 'Você termina de pagar em'}
          </p>
          <p className="mt-1 text-lg font-semibold">{competenceLabel(lastCommittedCompetence)}</p>
          {lastCommittedCompetence === result.byCompetence.at(-1)?.competence ? (
            <p className="mt-1 text-xs text-muted-foreground">Pode haver parcelas depois desta janela.</p>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Nenhum comprometimento futuro"
          description="Não há mês devedor na janela de 24 meses. Estornos isolados não contam como comprometimento."
          action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
        />
      )}

      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Visão mensal</h3>
            <p className="text-sm text-muted-foreground">Barras mostram apenas meses devedores.</p>
          </div>
          <Badge variant="neutral">24 meses</Badge>
        </div>
        <CommitmentChart entries={result.byCompetence} maxMagnitude={maxMagnitude} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="mb-3">
          <h3 className="font-semibold">Tabela por competência</h3>
          <p className="text-sm text-muted-foreground">A saída comprometida é exibida pela sua magnitude.</p>
        </div>
        <CommitmentTable entries={result.byCompetence} />
      </div>

      <LimitUsage cards={cards} usage={result.limitUsage} />
    </section>
  );
}
