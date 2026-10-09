import Link from 'next/link';

import { Money, Picote, Selo } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import type { Cents } from '@/lib/money';

import {
  contributionsTitle,
  pendingTitle,
  verdictOverdueNote,
  verdictDivergence,
  verdictDivergenceText,
  DIVERGENCE_LINK_LABEL,
  DIVERGENCE_SELO_LABEL,
  surplusBaseLine,
  surplusLabel,
  verdictLine,
  type PendingSummary,
} from './presentation';
import type { ProjectedState } from './projected-balance';

type HeadlineProps = {
  competence: Competence;
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents;
  /** Só o LANÇADO; o planejado vem ao lado. */
  contributionsCents: Cents;
  /** Aporte mensal planejado do plano de investimento; `null` = sem plano. */
  plannedContributionCents: Cents | null;
  projected: ProjectedState;
  pending: PendingSummary;
  /** Magnitude das faturas anteriores não pagas (0 = nenhuma): o veredito avisa que não as conta. */
  overdueUnpaidCents: Cents;
  /** Meses das faturas anteriores não pagas (`futureCommitment().overdueCompetences`). */
  overdueCompetences: readonly Competence[];
  /** A consulta de orçamento falhou: a faixa avisa que não deu para conferir. */
  pendingUnavailable: boolean;
};

/**
 * O primeiro olhar do Painel: começa pelo VEREDITO como frase (o que acontece com o saldo nos próximos
 * 12 meses), e logo abaixo os dois números do mês corrente, a sobra com a base visível e os aportes
 * lançados contra o planejado. Nada de faixa de indicadores nem de cartões lado a lado: um bloco só,
 * dividido por um picote. O comprometido fica no carnê logo abaixo, e as pendências são só a contagem
 * com link.
 */
export function Headline({
  competence,
  incomeCents,
  expenseCents,
  surplusCents,
  contributionsCents,
  plannedContributionCents,
  projected,
  pending,
  pendingUnavailable,
  overdueUnpaidCents,
  overdueCompetences,
}: HeadlineProps) {
  // As duas leituras divergem (a principal não fica negativa, a com as faturas não pagas fica): o
  // veredito deixa de ser verde e passa a depender dessas faturas.
  const divergence =
    projected.kind === 'ok'
      ? verdictDivergence(projected.projection.firstNegativeCompetence, projected.withOverdue, overdueCompetences)
      : null;
  // "Sem contar R$ X": o que a projeção de fato NÃO leva (`consideredCents` da segunda leitura), não o
  // total do Comprometido, que também inclui fatura de mês anterior que vence dentro da janela.
  const notCountedCents =
    projected.kind === 'ok' && projected.withOverdue !== undefined
      ? projected.withOverdue.consideredCents
      : overdueUnpaidCents;
  const overdueNote = divergence === null ? verdictOverdueNote(notCountedCents) : null;
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
      <section aria-labelledby="dashboard-verdict-heading" className="flex flex-col gap-4 border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col items-start gap-2">
          {divergence !== null ? (
            <Selo tone="attention" label={DIVERGENCE_SELO_LABEL} />
          ) : verdict.tone === 'neutral' ? null : (
            <Selo
              tone={verdict.tone === 'danger' ? 'danger' : 'ok'}
              label={verdict.tone === 'danger' ? 'Saldo negativo' : 'Sem saldo negativo'}
            />
          )}
          <h2 id="dashboard-verdict-heading" className="max-w-3xl text-2xl font-semibold text-foreground">
            {divergence === null ? verdict.text : `${verdictDivergenceText(divergence)}.`}
          </h2>
          {divergence !== null ? (
            <p className="max-w-3xl text-sm text-muted-foreground">
              Sem contar as faturas anteriores, o saldo não fica negativo.{' '}
              <Link href="/cartoes" className="text-primary underline underline-offset-2">
                {DIVERGENCE_LINK_LABEL}
              </Link>
            </p>
          ) : null}
          {overdueNote ? (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {overdueNote}.{' '}
              <a href="#comprometido" className="text-primary underline underline-offset-2">
                Ver no comprometido
              </a>
            </p>
          ) : null}
          <Link href="/fluxo" className="min-h-11 text-sm text-primary underline underline-offset-2 sm:min-h-0">
            Ver o fluxo e simular
          </Link>
        </div>

        <Picote />

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">{surplusLabel(competence, surplusCents)}</dt>
            <dd className="text-3xl font-semibold text-foreground">
              <Money value={surplusCents} />
            </dd>
            <dd className="text-sm text-muted-foreground">
              Receita <Money value={incomeCents} sign="never" /> menos despesa{' '}
              <Money value={expenseCents} sign="never" />
            </dd>
            <dd className="text-xs text-muted-foreground">{surplusBaseLine(competence)}</dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">{contributionsTitle(competence)}</dt>
            <dd className="text-3xl font-semibold text-foreground">
              <Money value={contributionsCents} sign="never" />
            </dd>
            <dd className="text-sm text-muted-foreground">
              {plannedContributionCents !== null && plannedContributionCents > 0 ? (
                <>
                  lançados, de <Money value={plannedContributionCents} sign="never" /> planejados
                </>
              ) : (
                <>
                  Sem aporte planejado.{' '}
                  <Link href="/investimentos" className="underline underline-offset-2">
                    Definir no plano
                  </Link>
                </>
              )}
            </dd>
          </div>
        </dl>
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
