import Link from 'next/link';

import { competenceShort } from '@/components/cashflow/labels';
import { Money, Selo } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import type { Cents } from '@/lib/money';

import {
  monthName,
  surplusBaseLine,
  surplusLabel,
  verdictLine,
  type NextMonthCommitment,
  type PendingSummary,
} from './presentation';
import { pendingTitle } from './presentation';
import type { ProjectedState } from './projected-balance';

type HeadlineProps = {
  competence: Competence;
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents;
  projected: ProjectedState;
  nextMonth: NextMonthCommitment;
  pending: PendingSummary;
  /** `null` na contagem de orçamento = a consulta falhou; a faixa avisa que não deu para conferir. */
  pendingUnavailable: boolean;
};

/**
 * A resposta de 10 segundos: uma linha principal com TRÊS números, lida de cima para baixo no celular
 * e lado a lado no desktop. Sobra do mês (com a base visível), o veredito de 12 meses e o que já vem
 * comprometido no mês seguinte. Régua de 1px entre as colunas, sem cartão dentro de cartão. As
 * pendências vêm logo abaixo, só como contagem com link.
 */
export function Headline({
  competence,
  incomeCents,
  expenseCents,
  surplusCents,
  projected,
  nextMonth,
  pending,
  pendingUnavailable,
}: HeadlineProps) {
  const verdict =
    projected.kind === 'ok'
      ? verdictLine({
          kind: 'ok',
          firstNegativeCompetence: projected.projection.firstNegativeCompetence,
          monthsCount: projected.projection.months.length,
        })
      : verdictLine({ kind: projected.kind });

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="O mês em três números" className="border border-border bg-card">
        <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <div className="flex flex-col gap-2 p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">{surplusLabel(competence, surplusCents)}</h2>
            <p className="text-3xl font-semibold text-foreground">
              <Money value={surplusCents} />
            </p>
            <p className="text-sm text-muted-foreground">
              Receita <Money value={incomeCents} sign="never" /> menos despesa{' '}
              <Money value={expenseCents} sign="never" />
            </p>
            <p className="text-xs text-muted-foreground">{surplusBaseLine(competence)}</p>
          </div>

          <div className="flex flex-col items-start gap-2 p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Próximos 12 meses</h2>
            {verdict.tone === 'neutral' ? null : (
              <Selo
                tone={verdict.tone === 'danger' ? 'danger' : 'ok'}
                label={verdict.tone === 'danger' ? 'Saldo negativo' : 'Sem saldo negativo'}
              />
            )}
            <p className="text-lg font-semibold text-foreground">{verdict.text}</p>
            <Link href="/fluxo" className="min-h-11 text-sm text-primary underline underline-offset-2 sm:min-h-0">
              Ver o fluxo e simular
            </Link>
          </div>

          <div className="flex flex-col gap-2 p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">
              {nextMonth === null ? 'Mês que vem' : `Comprometido em ${monthName(nextMonth.competence)}`}
            </h2>
            {nextMonth === null ? (
              <p className="text-lg font-semibold text-foreground">Nada comprometido nos cartões.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-foreground">
                  <Money value={nextMonth.cents} sign="never" />
                </p>
                <p className="text-sm text-muted-foreground">
                  Faturas de {competenceShort(nextMonth.competence)} já lançadas e parcelas.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Pendências">
        <a href="#pendencias" className="min-h-11 py-2 font-medium text-foreground underline underline-offset-2 sm:min-h-0 sm:py-0">
          {pendingTitle(pending.total)}
        </a>
        {pending.parts.length > 0 ? (
          <span className="text-muted-foreground">{pending.parts.join(' · ')}</span>
        ) : null}
        {pendingUnavailable ? (
          <span className="text-muted-foreground">Não deu para conferir os orçamentos agora.</span>
        ) : null}
      </p>
    </div>
  );
}
