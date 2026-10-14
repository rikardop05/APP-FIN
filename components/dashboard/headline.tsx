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
 * O primeiro olhar do Painel (impeccable distill, decisão do Ricardo, 2026-10-14): o NÚMERO CALMO
 * lidera — a Sobra em Display (36px) na abertura do bloco, no celular também —, e o VEREDITO vem
 * depois como Faixa compacta (a manchete de alerta em âmbar não ocupa mais a dobra). Quando aparece
 * o veredito dividido (as duas leituras divergem), a Faixa de atenção leva o selo W ("Depende das
 * faturas") e o link "Já paguei: marcar em Cartões". No primeiro viewport lê-se o número, não o
 * alerta inteiro. O comprometido fica no carnê logo abaixo, e as pendências são só a contagem
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
      <section aria-labelledby="dashboard-sobra-heading" className="flex flex-col gap-4 border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h2 id="dashboard-sobra-heading" className="text-sm font-medium text-muted-foreground">
            {surplusLabel(competence, surplusCents)}
          </h2>
          {/* Display (36px): o número-manchete do Painel (DESIGN.md). Nunca a mão: vai pelo Money. */}
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

        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{contributionsTitle(competence)}</p>
          <p className="text-xl font-semibold text-foreground">
            <Money value={contributionsCents} sign="never" />
          </p>
          <p className="text-sm text-muted-foreground">
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
          </p>
        </div>

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
            tone={verdict.tone === 'ok' ? 'ok' : verdict.tone === 'danger' ? 'danger' : 'info'}
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
