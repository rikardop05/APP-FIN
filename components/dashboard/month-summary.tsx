import Link from 'next/link';

import { Money } from '@/components/ui-kit';
import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import type { Competence } from '@/lib/date';
import type { BasisPoints, Cents } from '@/lib/money';

import {
  contributionsTitle,
  ESSENTIAL_SHARE_HINT,
  monthName,
  SAVINGS_RATE_HINT,
} from './presentation';

type MonthSummaryProps = {
  competence: Competence;
  incomeCents: Cents;
  expenseCents: Cents;
  /** Só o LANÇADO (decisão do Ricardo, 2026-10-08). */
  contributionsCents: Cents;
  /** Aporte mensal planejado do plano de investimento; `null` = sem plano. */
  plannedContributionCents: Cents | null;
  savingsRateBp: BasisPoints | null;
  essentialShareBp: BasisPoints | null;
};

function Item({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold text-foreground">{children}</dd>
      {note ? <dd className="text-sm text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * Resumo do mês: o que entrou, o que saiu e quanto foi aportado. A sobra mora no topo da tela; as
 * "Parcelas a vencer" saíram daqui (viraram parte de "Comprometido nos cartões"). Taxa de poupança e
 * essenciais, que pouca gente lê todo dia, ficam atrás de "Mais indicadores".
 */
export function MonthSummary({
  competence,
  incomeCents,
  expenseCents,
  contributionsCents,
  plannedContributionCents,
  savingsRateBp,
  essentialShareBp,
}: MonthSummaryProps) {
  return (
    <section aria-labelledby="dashboard-month-heading" className="flex flex-col gap-0 border border-border bg-card">
      <h2 id="dashboard-month-heading" className="px-4 pt-4 text-base font-semibold text-foreground sm:px-5 sm:pt-5">
        Resumo de {monthName(competence)}
      </h2>
      <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Item label="Receita do mês">
          <Money value={incomeCents} sign="never" />
        </Item>
        <Item label="Despesa do mês">
          <Money value={expenseCents} sign="never" />
        </Item>
        <Item
          label={contributionsTitle(competence)}
          note={
            plannedContributionCents !== null && plannedContributionCents > 0 ? (
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
            )
          }
        >
          <Money value={contributionsCents} sign="never" />
        </Item>
      </dl>

      <details className="border-t border-border">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm text-muted-foreground sm:px-5">
          Mais indicadores
        </summary>
        <dl className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Item label="Taxa de poupança" note={savingsRateBp === null ? 'Sem receita no mês.' : SAVINGS_RATE_HINT}>
            {savingsRateBp === null ? '—' : <span className="num">{formatBasisPoints(savingsRateBp)}</span>}
          </Item>
          <Item label="Essenciais / renda" note={essentialShareBp === null ? 'Sem receita no mês.' : ESSENTIAL_SHARE_HINT}>
            {essentialShareBp === null ? '—' : <span className="num">{formatBasisPoints(essentialShareBp)}</span>}
          </Item>
        </dl>
      </details>
    </section>
  );
}
