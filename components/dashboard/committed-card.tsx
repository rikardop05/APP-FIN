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
  breakdown: { currentStatementCents: Cents; laterInstallmentsCents: Cents; laterPurchasesCents: Cents };
  byCompetence: readonly CommittedMonth[];
};

/** Quantos canhotos presos mostrar; o resto vira link para Cartões. */
const STUB_LIMIT = 6;

/**
 * "Comprometido nos cartões": UM card, no lugar de "Parcelas a vencer" e "Total comprometido". O total e
 * as linhas saem do MESMO `futureCommitment` (a soma fecha), e os meses seguintes aparecem como
 * canhotos ainda presos (tracejados). Fatura marcada como paga já saiu do motor.
 */
export function CommittedCard({
  competence,
  windowEnd,
  totalCents,
  lastCommittedCompetence,
  breakdown,
  byCompetence,
}: CommittedCardProps) {
  const endLine = commitmentEndLine(lastCommittedCompetence, windowEnd);
  const rows = commitmentRows(breakdown, competence);
  const { shown, hiddenCount } = stubMonths(byCompetence, STUB_LIMIT);

  return (
    <section aria-labelledby="dashboard-committed-heading" className="flex flex-col gap-4 border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="dashboard-committed-heading" className="text-base font-semibold text-foreground">
          Comprometido nos cartões
        </h2>
        <p className="text-sm text-muted-foreground">
          Faturas de {competenceShort(competence)} a {competenceShort(windowEnd)}: compras lançadas e parcelas. Fatura
          marcada como paga sai da conta.
        </p>
      </div>

      {lastCommittedCompetence === null ? (
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

          <dl className="flex flex-col divide-y divide-border border-y border-border text-sm">
            {rows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-foreground">
                  <Money value={row.valueCents} />
                </dd>
              </div>
            ))}
          </dl>

          {shown.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Picote />
              <h3 className="text-sm font-medium text-foreground">Ainda presos</h3>
              <ul className="flex flex-col gap-1">
                {shown.map((entry) => (
                  <Canhoto
                    as="li"
                    key={entry.competence}
                    preso
                    stub={competenceShort(entry.competence)}
                    valor={<Money value={-entry.totalCents as Cents} />}
                  >
                    <span className="text-sm">
                      Parcelas <Money value={-entry.installmentCents as Cents} />
                      {entry.purchaseCents !== 0 ? (
                        <>
                          {' '}
                          · compras <Money value={-entry.purchaseCents as Cents} />
                        </>
                      ) : null}
                    </span>
                  </Canhoto>
                ))}
              </ul>
              {hiddenCount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Mais {hiddenCount} {hiddenCount === 1 ? 'mês' : 'meses'} em Cartões.
                </p>
              ) : null}
            </div>
          ) : null}

          <Link href="/cartoes" className="min-h-11 text-sm text-primary underline underline-offset-2 sm:min-h-0">
            Ver faturas e limites em Cartões
          </Link>
        </>
      )}
    </section>
  );
}
