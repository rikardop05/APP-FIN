import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';

import { EmptyState, Money } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';

export type UncategorizedItem = {
  id: string;
  description: string;
  amountCents: number;
  occurredOn: string;
};

export type DivergentStatementItem = {
  statementId: string;
  cardName: string;
  period: string;
  reportedTotalCents: Cents | null;
  differenceCents: Cents;
};

type PendenciasListProps = {
  uncategorizedCount: number;
  uncategorizedItems: UncategorizedItem[];
  divergentStatements: DivergentStatementItem[];
};

/**
 * Fila de pendências do dashboard (T-115) — não categorizados e faturas
 * divergentes. Os números vêm dos motores `monthlyKpis` (uncategorizedCount)
 * e `divergentStatements` (lista com `differenceCents`). Esta tela só
 * formata e apresenta.
 *
 * O que cada seção significa:
 * - **Não categorizados**: lançamentos do mês sem `category_id` (definidos
 *   pela query `listUncategorizedTransactionItems`). Cada item aponta para
 *   `/lancamentos?ids=...` — o T-112 lê o filtro e abre a tela já filtrada.
 * - **Faturas divergentes**: o motor `divergentStatements` devolve apenas
 *   faturas com `differenceCents !== 0`; as sem `reportedTotalCents`
 *   declarado ou com soma idêntica ficam fora. O usuário precisa conferir
 *   a fatura real e marcar como conciliada (T-112 / T-202 — Fase 2).
 */
export function PendenciasList({
  uncategorizedCount,
  uncategorizedItems,
  divergentStatements,
}: PendenciasListProps) {
  const hasUncategorized = uncategorizedCount > 0;
  const hasDivergent = divergentStatements.length > 0;
  const isEmpty = !hasUncategorized && !hasDivergent;

  if (isEmpty) {
    return (
      <section
        aria-labelledby="dashboard-pendencias-heading"
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="mb-3">
          <h2 id="dashboard-pendencias-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Nada pendente neste mês
          </h2>
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria em aberto e nenhuma fatura divergente.
          </p>
        </div>
        <EmptyState
          icon={Inbox}
          title="Tudo em ordem"
          description="Quando aparecer um lançamento sem categoria ou uma fatura com total diferente do informado, ele aparece aqui."
          action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="dashboard-pendencias-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4">
        <h2 id="dashboard-pendencias-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          Pendências
        </h2>
        <p className="text-sm text-muted-foreground">
          O que precisa de atenção antes de fechar o mês.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {hasUncategorized ? (
          <article aria-labelledby="dashboard-pendencias-uncat-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="dashboard-pendencias-uncat-heading" className="text-sm font-semibold text-foreground">
                Não categorizados
              </h3>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                {uncategorizedCount} {uncategorizedCount === 1 ? 'item' : 'itens'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Lançamentos do mês sem categoria. Vá em Lançamentos e aplique uma regra ou crie uma.
            </p>
            <ul className="flex flex-col gap-1.5">
              {uncategorizedItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.description}
                    </span>
                    <span className="text-xs text-muted-foreground">{item.occurredOn}</span>
                  </div>
                  <Money value={item.amountCents as Cents} className="shrink-0 text-sm font-medium tabular" />
                </li>
              ))}
            </ul>
            {uncategorizedCount > uncategorizedItems.length ? (
              <Link
                href="/lancamentos"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Ver mais {uncategorizedCount - uncategorizedItems.length}{' '}
                {uncategorizedCount - uncategorizedItems.length === 1 ? 'item' : 'itens'} em Lançamentos →
              </Link>
            ) : null}
          </article>
        ) : null}

        {hasDivergent ? (
          <article aria-labelledby="dashboard-pendencias-fat-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="dashboard-pendencias-fat-heading" className="text-sm font-semibold text-foreground">
                Faturas divergentes
              </h3>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                {divergentStatements.length}{' '}
                {divergentStatements.length === 1 ? 'fatura' : 'faturas'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Total somado pelos lançamentos é diferente do total informado na fatura.
            </p>
            <ul className="flex flex-col gap-1.5">
              {divergentStatements.map((item) => (
                <li
                  key={item.statementId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.cardName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.period.slice(5)}/{item.period.slice(0, 4)} · diferença{' '}
                        <Money
                          value={item.differenceCents}
                          sign={item.differenceCents < 0 ? 'never' : 'never'}
                          className="font-medium"
                        />
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </div>
    </section>
  );
}
