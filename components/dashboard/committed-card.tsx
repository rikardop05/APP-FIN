import Link from 'next/link';
import { CreditCard } from 'lucide-react';

import { competenceShort } from '@/components/cashflow/labels';
import { Canhoto, EmptyState, Money } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import { cents, formatBRL, type Cents } from '@/lib/money';

import { BarChart, type BarGroup } from './bar-chart';
import {
  commitmentEndLine,
  commitmentRows,
  commitmentStrip,
  commitmentTotal,
  nextMonthCommitment,
} from './presentation';

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
  /** Pago e pendente das faturas do mês (calculados na query); null sem fatura gravada. */
  currentSettlement: { paidCents: Cents; pendingCents: Cents } | null;
  byCompetence: readonly CommittedMonth[];
};

/** Quantos meses a faixa de barras desenha; a tabela traz todos. */
const STRIP_MONTHS = 12;

/** Canhoto dentro do card não vira caixa (card dentro de card): só a régua de cima. */
const FLAT = 'border-0 border-t border-border';

/**
 * "Comprometido nos cartões", compacto: o valor do MÊS QUE VEM em destaque com as duas linhas de composição
 * (parcelas e compras), o total comprometido ao lado e uma faixa de barras por mês. A lista mês a mês, a
 * fatura do mês e a composição do total ficam atrás de "Ver mês a mês" (a tabela é a alternativa acessível
 * ao gráfico). Fatura vencida e não paga continua visível: é aviso, não detalhe. Todo número vem de
 * `futureCommitment` (mesmo total e mesma soma por origem); aqui só se desenha.
 */
export function CommittedCard({
  competence,
  windowEnd,
  totalCents,
  lastCommittedCompetence,
  breakdown,
  overdueCompetences,
  currentSettlement,
  byCompetence,
}: CommittedCardProps) {
  const endLine = commitmentEndLine(lastCommittedCompetence, windowEnd);
  const rows = commitmentRows(breakdown, competence);
  const next = nextMonthCommitment(byCompetence);
  const nextEntry = byCompetence[1];
  const current = byCompetence[0];
  const strip = commitmentStrip(byCompetence, STRIP_MONTHS);
  const debtMonths = commitmentStrip(byCompetence, byCompetence.length).filter((month) => month.debtCents > 0);
  const hasOverdue = breakdown.overdueUnpaidCents !== 0;
  const firstOverdue = overdueCompetences[0];
  const overdueStub =
    overdueCompetences.length === 1 && firstOverdue !== undefined
      ? competenceShort(firstOverdue)
      : `${overdueCompetences.length}×`;

  const groups: BarGroup[] = strip.map((month) => ({
    key: month.competence,
    label: competenceShort(month.competence),
    values: { debt: month.debtCents },
    titles: { debt: `${competenceShort(month.competence)} · comprometido ${formatBRL(month.debtCents)}` },
  }));
  const stripMax = strip.reduce((max, month) => Math.max(max, month.debtCents), 0);

  return (
    <section id="comprometido" aria-labelledby="dashboard-committed-heading" className="flex scroll-mt-4 flex-col gap-4 border border-border bg-card p-4 sm:p-5">
      <h2 id="dashboard-committed-heading" className="text-base font-semibold text-foreground">
        Comprometido nos cartões
      </h2>

      {lastCommittedCompetence === null && !hasOverdue ? (
        <EmptyState
          icon={CreditCard}
          title="Nenhum comprometimento futuro"
          description="Não há fatura devedora na janela. Estorno isolado não conta como comprometimento."
          action={{ label: 'Ver cartões', href: '/cartoes' }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                {next ? `Mês que vem · ${competenceShort(next.competence)}` : 'Mês que vem'}
              </p>
              {next && nextEntry ? (
                <>
                  {/* Headline (28px, 600), não Display: peso de manchete é SÓ da Sobra (distill, crítica 6.1). */}
                  <p className="whitespace-nowrap text-[1.75rem] font-semibold leading-8 text-foreground">
                    <Money value={next.cents} sign="never" />
                  </p>
                  <dl className="flex flex-col gap-0.5 text-sm text-muted-foreground" aria-label="De que é feito o mês que vem">
                    <div className="flex items-baseline justify-between gap-3 sm:justify-start">
                      <dt>Parcelas</dt>
                      <dd className="text-foreground">
                        <Money value={cents(0 - nextEntry.installmentCents)} sign="never" />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 sm:justify-start">
                      <dt>Compras já lançadas</dt>
                      <dd className="text-foreground">
                        <Money value={cents(0 - nextEntry.purchaseCents)} sign="never" />
                      </dd>
                    </div>
                  </dl>
                </>
              ) : nextEntry ? (
                <p className="text-sm text-foreground">Nada comprometido para o mês que vem.</p>
              ) : (
                <p className="text-sm text-foreground">Fora do horizonte de {competenceShort(windowEnd)} configurado.</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Total comprometido</p>
              <p className="whitespace-nowrap text-lg font-semibold text-foreground">
                <Money value={commitmentTotal(totalCents)} sign="never" />
              </p>
              {endLine ? <p className="text-sm text-muted-foreground">{endLine}</p> : null}
            </div>
          </div>

          {hasOverdue ? (
            <ul className="flex flex-col" aria-label="Faturas vencidas">
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
            </ul>
          ) : null}

          {stripMax > 0 ? (
            <BarChart
              series={[{ id: 'debt', label: 'Comprometido por mês', fillClass: 'fill-primary' }]}
              groups={groups}
              maxLabel={formatBRL(cents(stripMax))}
              height={150}
              ariaLabel={`Comprometido nos cartões, de ${competenceShort(competence)} a ${competenceShort(strip[strip.length - 1]?.competence ?? competence)}`}
            />
          ) : null}
          {stripMax > 0 ? <p className="sr-only">Os valores de cada mês estão na tabela de “Ver mês a mês”.</p> : null}

          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground sm:min-h-0">
              Ver mês a mês
            </summary>
            <div className="mt-2 flex flex-col gap-4">
              <p className="max-w-[65ch] text-xs text-muted-foreground">
                O comprometido é o carnê dos próximos meses: {hasOverdue ? 'faturas anteriores não pagas e faturas' : 'faturas'} de{' '}
                {competenceShort(competence)} a {competenceShort(windowEnd)}, compras lançadas e parcelas. Fatura marcada como paga
                sai da conta.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[20rem] text-sm">
                  <caption className="sr-only">Comprometido nos cartões, mês a mês</caption>
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-medium">Mês</th>
                      <th scope="col" className="py-1 text-right font-medium">Parcelas</th>
                      <th scope="col" className="py-1 text-right font-medium">Compras</th>
                      <th scope="col" className="py-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtMonths.map((month) => (
                      <tr key={month.competence} className="border-b border-border last:border-0">
                        <th scope="row" className="py-1 text-left font-normal">{competenceShort(month.competence)}</th>
                        <td className="whitespace-nowrap py-1 text-right"><Money value={month.installmentCents} sign="never" /></td>
                        <td className="whitespace-nowrap py-1 text-right"><Money value={month.purchaseCents} sign="never" /></td>
                        <td className="whitespace-nowrap py-1 text-right"><Money value={month.debtCents} sign="never" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {current !== undefined &&
              current.totalCents < 0 &&
              currentSettlement !== null &&
              (currentSettlement.paidCents > 0 || currentSettlement.pendingCents > 0) ? (
                <p className="text-sm text-muted-foreground">
                  Todas as faturas de {competenceShort(current.competence)}: pago{' '}
                  <Money value={currentSettlement.paidCents} sign="never" /> · pendente{' '}
                  <Money value={currentSettlement.pendingCents} sign="never" />
                  {currentSettlement.pendingCents !== -current.totalCents
                    ? '. O pendente soma só as faturas já gravadas; o valor do mês também conta parcelas ainda sem fatura.'
                    : ''}
                </p>
              ) : null}

              <dl className="flex flex-col divide-y divide-border text-sm" aria-label="De onde vem o total">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="whitespace-nowrap text-foreground">
                      <Money value={row.valueCents} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>

          <Link href="/cartoes" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2 sm:min-h-0">
            Ver faturas e limites em Cartões
          </Link>
        </>
      )}
    </section>
  );
}
