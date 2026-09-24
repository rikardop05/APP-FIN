import { CalendarClock, CreditCard } from 'lucide-react';

import { EmptyState, Money } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';

type CommitmentSummaryProps = {
  totalCents: Cents;
  lastCommittedCompetence: string | null;
  windowEnd: string;
  competence: string;
  commitmentMonths: number;
};

/**
 * Resumo do comprometimento futuro para o dashboard (T-115).
 *
 * O painel consome `futureCommitment` (CONTRACTS §5) direto: `totalCents` e
 * `lastCommittedCompetence` JÁ são o resumo. Esta tela não recalcula nada
 * nem pede invólucro novo ao motor. A semântica de `lastCommittedCompetence`
 * é a do CONTRACTS §5 (último mês devedor da janela, `null` quando não há
 * nenhum).
 *
 * Rótulo fixo: "Você termina de pagar em MM/AAAA" — nunca "zera em", porque
 * o campo é "último mês devedor", não "primeiro mês sem dívida". Quando o
 * último mês devedor coincide com o fim da janela, exibimos "Comprometimento
 * até MM/AAAA" (mesma redação que o T-113 fixou para o caso de parcelas
 * além do fim da janela).
 */
export function CommitmentSummary({
  totalCents,
  lastCommittedCompetence,
  windowEnd,
  competence,
  commitmentMonths,
}: CommitmentSummaryProps) {
  const competenciaCurta = `${competence.slice(5)}/${competence.slice(0, 4)}`;
  const hasCommitment = lastCommittedCompetence !== null;
  const lastShort =
    lastCommittedCompetence === null
      ? null
      : `${lastCommittedCompetence.slice(5)}/${lastCommittedCompetence.slice(0, 4)}`;
  const endShort = `${windowEnd.slice(5)}/${windowEnd.slice(0, 4)}`;
  const atWindowEdge =
    lastCommittedCompetence !== null && lastCommittedCompetence === windowEnd;

  return (
    <section
      aria-labelledby="dashboard-commitment-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="dashboard-commitment-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
            Comprometimento futuro
          </h2>
          <p className="text-sm text-muted-foreground">
            Próximos {commitmentMonths} meses, a partir de {competenciaCurta}.
          </p>
        </div>
      </div>

      {hasCommitment ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm text-muted-foreground">
              {atWindowEdge ? 'Comprometimento até' : 'Você termina de pagar em'}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular text-foreground">
              {lastShort}
            </p>
            {atWindowEdge ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Pode haver parcelas depois desta janela ({endShort}).
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Janela vai até {endShort}.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted-foreground">Total comprometido ({commitmentMonths} m)</p>
            <p className="mt-1 text-2xl font-semibold tabular text-foreground">
              <Money value={totalCents} sign="never" />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Soma de todas as parcelas na janela de {commitmentMonths} meses. Detalhe por cartão na tela de{' '}
              <a href="/cartoes" className="underline underline-offset-2 hover:text-foreground">
                Cartões
              </a>
              .
            </p>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CreditCard}
          title="Nenhum comprometimento futuro"
          description={`Não há mês devedor na janela de ${commitmentMonths} meses. Estornos isolados não contam como comprometimento.`}
          action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
        />
      )}
    </section>
  );
}
