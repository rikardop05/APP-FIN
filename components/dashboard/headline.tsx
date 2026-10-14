import Link from 'next/link';

import { Faixa, Money, Picote, Selo } from '@/components/ui-kit';
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
  /** Só o LANÇADO; o planejado vem na linha de aportes. */
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
 * O primeiro olhar do Painel (impeccable distill, 2026-10-14, mãe do P2 da crítica): UM
 * protagonista por dobra. O bloco Sobra é o único card: a Sobra em Display (36px), a base que a
 * explica e, abaixo de um picote, a linha secundária dos Aportes. O VEREDITO de 12 meses vem
 * depois como Faixa compacta FORA do card (nunca card dentro de card), herdando a dobra do número
 * que a gerou; a divergência leva o selo W ("Depende das faturas") e o link "Já paguei: marcar em
 * Cartões". As pendências viram pill-resumo, e o comprometido fica no carnê logo abaixo. Nem no
 * celular a dobra abre em alerta: abre no número.
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
      <section aria-labelledby="dashboard-sobra-heading" className="flex flex-col gap-3 border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h2 id="dashboard-sobra-heading" className="text-sm font-medium text-muted-foreground">
            {surplusLabel(competence, surplusCents)}
          </h2>
          {/* Display (36px): o número-manchete do Painel (DESIGN.md). Nunca na mão: vai pelo Money. */}
          <p className="text-4xl font-semibold leading-10 text-foreground">
            <Money value={surplusCents} />
          </p>
          <p className="text-sm text-muted-foreground">
            Receita <Money value={incomeCents} sign="never" /> menos despesa{' '}
            <Money value={expenseCents} sign="never" />
          </p>
          <p className="text-xs text-muted-foreground">{surplusBaseLine(competence)}</p>
        </div>

        <Picote />

        {/* Aportes como linha secundária do bloco Sobra (impeccable distill). */}
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{contributionsTitle(competence)}:</span>{' '}
          <Money value={contributionsCents} sign="never" />{' '}
          {plannedContributionCents !== null && plannedContributionCents > 0 ? (
            <>
              lançados, de <Money value={plannedContributionCents} sign="never" /> planejados
            </>
          ) : (
            <>
              lançados. Sem aporte planejado:{' '}
              <Link href="/investimentos" className="underline underline-offset-2">
                definir no plano
              </Link>
            </>
          )}
        </p>
      </section>

      {divergence !== null ? (
        <Faixa tone="attention">
          <p className="flex flex-wrap items-center gap-2">
            <Selo tone="attention" label={DIVERGENCE_SELO_LABEL} />
            <span className="font-medium">{verdictDivergenceText(divergence)}.</span>
          </p>
          <p>
            <Link href="/cartoes" className="font-medium underline underline-offset-2">
              {DIVERGENCE_LINK_LABEL}
            </Link>{' '}
            ·{' '}
            <Link href="/fluxo" className="underline underline-offset-2">
              Ver o fluxo e simular
            </Link>
          </p>
        </Faixa>
      ) : (
        <Faixa
          tone={
            verdict.tone === 'danger' || projected.kind === 'unavailable'
              ? 'danger'
              : verdict.tone === 'ok'
                ? 'ok'
                : 'info'
          }
        >
          <p>{verdict.text}</p>
          {verdict.tone !== 'neutral' && overdueNote ? (
            <p>
              {overdueNote}.{' '}
              <a href="#comprometido" className="font-medium underline underline-offset-2">
                Ver no comprometido
              </a>
            </p>
          ) : null}
          {verdict.tone !== 'neutral' ? (
            <p>
              <Link href="/fluxo" className="underline underline-offset-2">
                Ver o fluxo e simular
              </Link>
            </p>
          ) : null}
        </Faixa>
      )}

      {/* Pendências como pill-resumo (impeccable distill): contagem e link, sem moldura pesada. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Pendências">
        <a
          href="#pendencias"
          className="inline-flex min-h-9 items-center border border-border bg-secondary px-3 text-xs font-medium text-foreground hover:bg-secondary/70"
        >
          {pendingTitle(pending.total)}
        </a>
        {pending.parts.length > 0 ? (
          <span className="text-xs text-muted-foreground">{pending.parts.join(' · ')}</span>
        ) : null}
        {pendingUnavailable ? (
          <span className="text-xs text-muted-foreground">Não deu para conferir os orçamentos agora.</span>
        ) : null}
      </p>
    </div>
  );
}
