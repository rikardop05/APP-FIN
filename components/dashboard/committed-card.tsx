import Link from 'next/link';
import { CreditCard } from 'lucide-react';

import { competenceShort } from '@/components/cashflow/labels';
import { Canhoto, EmptyState, Money, Picote } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import type { Cents } from '@/lib/money';

import { commitmentEndLine, commitmentRows, commitmentTotal, stubMonths } from './presentation';

export type CommittedMonth = {
  competence: Competence;
  totalCents: Cents;
  installmentCents: Cents;
  purchaseCents: Cents;
};

type CommittedCardProps = {
  competence: Competence;
  windowEnd: Competence;
  totalCents: Cents;
  lastCommittedCompetence: Competence | null;
  breakdown: {
    overdueUnpaidCents: Cents;
    currentStatementCents: Cents;
    laterInstallmentsCents: Cents;
    laterPurchasesCents: Cents;
  };
  /** Meses de faturas vencidas e não pagas (`futureCommitment().overdueCompetences`). */
  overdueCompetences: readonly Competence[];
  byCompetence: readonly CommittedMonth[];
};

/** Quantos canhotos presos mostrar; o resto vira link para Cartões. */
const STUB_LIMIT = 6;

/** Canhoto dentro do card não vira caixa (card dentro de card): só a régua de cima. */
const FLAT = 'border-0 border-t border-border';
const FLAT_PRESO = 'border-0 border-t border-dashed border-input';

/**
 * "Comprometido nos cartões" lido como CARNÊ: o total, a fatura do mês como canhoto, os meses seguintes
 * como canhotos ainda PRESOS (tracejados) e, quando existem, as faturas vencidas e não pagas com selo de
 * carimbo. A soma por origem fecha EXATAMENTE com o total (mesmo `futureCommitment`). Fatura marcada
 * como paga já saiu do motor.
 */
export function CommittedCard({
  competence,
  windowEnd,
  totalCents,
  lastCommittedCompetence,
  breakdown,
  overdueCompetences,
  byCompetence,
}: CommittedCardProps) {
  const endLine = commitmentEndLine(lastCommittedCompetence, windowEnd);
  const rows = commitmentRows(breakdown, competence);
  const { shown, hiddenCount } = stubMonths(byCompetence, STUB_LIMIT);
  const current = byCompetence[0];
  const hasOverdue = breakdown.overdueUnpaidCents !== 0;
  const firstOverdue = overdueCompetences[0];
  const overdueStub =
    overdueCompetences.length === 1 && firstOverdue !== undefined
      ? competenceShort(firstOverdue)
      : `${overdueCompetences.length}×`;

  return (
    <section aria-labelledby="dashboard-committed-heading" className="flex flex-col gap-4 border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="dashboard-committed-heading" className="text-base font-semibold text-foreground">
          Comprometido nos cartões
        </h2>
        <p className="text-sm text-muted-foreground">
          {hasOverdue ? 'Faturas anteriores não pagas e faturas' : 'Faturas'} de {competenceShort(competence)} a{' '}
          {competenceShort(windowEnd)}: compras lançadas e parcelas. Fatura marcada como paga sai da conta.
        </p>
      </div>

      {lastCommittedCompetence === null && !hasOverdue ? (
        <EmptyState
          icon={CreditCard}
          title="Nenhum comprometimento futuro"
          description="Não há fatura devedora na janela. Estorno isolado não conta como comprometimento."
          action={{ label: 'Ver cartões', href: '/cartoes' }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-semibold text-foreground">
              <Money value={commitmentTotal(totalCents)} sign="never" />
            </p>
            {endLine ? <p className="text-sm text-muted-foreground">{endLine}</p> : null}
          </div>

          <ul className="flex flex-col" aria-label="Canhotos do carnê">
            {hasOverdue ? (
              <Canhoto
                as="li"
                className={FLAT}
                stub={overdueStub}
                marca={{ label: 'Não paga', tone: 'attention' as const }}
                valor={<Money value={-breakdown.overdueUnpaidCents as Cents} />}
              >
                <span className="text-sm">
                  Faturas anteriores não pagas
                  {overdueCompetences.length > 1 ? `: ${overdueCompetences.map(competenceShort).join(', ')}` : ''}
                </span>
                <span className="text-sm text-muted-foreground">
                  Continuam contando até você marcar como paga em Cartões.
                </span>
              </Canhoto>
            ) : null}
            {current !== undefined && current.totalCents < 0 ? (
              <Canhoto
                as="li"
                className={FLAT}
                stub={competenceShort(current.competence)}
                valor={<Money value={-current.totalCents as Cents} />}
              >
                <span className="text-sm">Fatura do mês</span>
              </Canhoto>
            ) : null}
            {shown.map((entry) => (
              <Canhoto
                as="li"
                key={entry.competence}
                preso
                className={FLAT_PRESO}
                stub={competenceShort(entry.competence)}
                valor={<Money value={-entry.totalCents as Cents} />}
              >
                <span className="text-sm">
                  {entry.purchaseCents !== 0 ? (
                    <>
                      Parcelas <Money value={-entry.installmentCents as Cents} /> · compras{' '}
                      <Money value={-entry.purchaseCents as Cents} />
                    </>
                  ) : (
                    'Parcelas'
                  )}
                </span>
              </Canhoto>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              Mais {hiddenCount} {hiddenCount === 1 ? 'mês' : 'meses'} em Cartões.
            </p>
          ) : null}

          <Picote />
          <dl className="flex flex-col divide-y divide-border text-sm" aria-label="De onde vem o total">
            {rows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-foreground">
                  <Money value={row.valueCents} />
                </dd>
              </div>
            ))}
          </dl>

          <Link href="/cartoes" className="min-h-11 text-sm text-primary underline underline-offset-2 sm:min-h-0">
            Ver faturas e limites em Cartões
          </Link>
        </>
      )}
    </section>
  );
}
