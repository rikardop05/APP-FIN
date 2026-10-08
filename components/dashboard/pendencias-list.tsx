import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';

import { EmptyState, Money } from '@/components/ui-kit';
import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import { formatDateBR } from '@/lib/date';
import type { BasisPoints, Cents } from '@/lib/money';

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

/**
 * Mesma forma de `OverBudgetItem` (`lib/db/queries/budgets.ts`, T-205), para a
 * página passar o retorno de `listOverBudget` sem adaptar. "Estourado" é o
 * `light === 'red'` de `budgetStatus`, decidido LÁ: este componente só exibe a
 * lista e NUNCA refaz a comparação gasto × planejado — refazer divergiria do
 * semáforo da tela de orçamento.
 */
export type OverBudgetListItem = {
  categoryId: string;
  categoryName: string;
  plannedCents: Cents;
  spentCents: Cents;
  /** Realizado + previsto: o que o vermelho mede (decisão 10b). */
  expectedCents: Cents;
  /** `null` só quando `plannedCents = 0`. */
  usageBp: BasisPoints | null;
};

export type OverdueRecurringListItem = {
  id: string;
  description: string;
  occurredOn: string;
  amountCents: Cents;
};

type PendenciasListProps = {
  uncategorizedCount: number;
  uncategorizedItems: UncategorizedItem[];
  divergentStatements: DivergentStatementItem[];
  /**
   * Orçamentos estourados no mês (T-205). `null` = a consulta falhou: a lista
   * avisa que não deu para conferir, em vez de sumir e deixar "nada pendente".
   */
  overBudget: OverBudgetListItem[] | null;
  /** Despesas recorrentes previstas, já vencidas e não realizadas. */
  overdueRecurring: { count: number; items: OverdueRecurringListItem[] };
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
  overBudget,
  overdueRecurring,
}: PendenciasListProps) {
  const hasUncategorized = uncategorizedCount > 0;
  const hasDivergent = divergentStatements.length > 0;
  const overBudgetUnavailable = overBudget === null;
  const overBudgetItems = overBudget ?? [];
  const hasOverBudget = overBudgetItems.length > 0;
  const hasOverdueRecurring = overdueRecurring.count > 0;
  // `overBudget === null` NÃO conta como "nada pendente": não sabemos.
  const isEmpty =
    !hasUncategorized && !hasDivergent && !hasOverBudget && !hasOverdueRecurring && !overBudgetUnavailable;

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
            Nenhuma categoria em aberto, fatura divergente, orçamento estourado ou despesa fixa em atraso.
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
        {hasOverBudget ? (
          <article aria-labelledby="dashboard-pendencias-budget-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="dashboard-pendencias-budget-heading" className="text-sm font-semibold text-foreground">
                Orçamentos estourados
              </h3>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                {overBudgetItems.length} {overBudgetItems.length === 1 ? 'categoria' : 'categorias'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Categorias em vermelho na tela de Orçamento: o realizado mais o previsto a realizar do mês passa do
              orçado.
            </p>
            <ul className="flex flex-col gap-1.5">
              {overBudgetItems.map((item) => (
                <li
                  key={item.categoryId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{item.categoryName}</span>
                    <span className="text-xs text-muted-foreground">
                      <Money value={item.expectedCents} sign="never" className="text-muted-foreground" /> previstos no mês de{' '}
                      <Money value={item.plannedCents} sign="never" className="text-muted-foreground" /> planejados
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular text-red-700">
                    {item.usageBp === null ? 'sem valor planejado' : formatBasisPoints(item.usageBp)}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/orcamento"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Abrir o orçamento →
            </Link>
          </article>
        ) : null}

        {overBudgetUnavailable ? (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Não foi possível conferir os orçamentos estourados agora.{' '}
            <Link href="/orcamento" className="underline underline-offset-2">
              Abrir o orçamento
            </Link>
            .
          </p>
        ) : null}

        {hasOverdueRecurring ? (
          <article aria-labelledby="dashboard-pendencias-recurring-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="dashboard-pendencias-recurring-heading" className="text-sm font-semibold text-foreground">
                Despesas fixas previstas e não realizadas
              </h3>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                {overdueRecurring.count} {overdueRecurring.count === 1 ? 'item' : 'itens'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Previsões cuja data já passou. Ainda não conferimos isso sozinhos com o que você importou: se já pagou e
              importou, a linha continua aqui.
            </p>
            <ul className="flex flex-col gap-1.5">
              {overdueRecurring.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{item.description}</span>
                    <span className="text-xs text-muted-foreground">previsto para {formatDateBR(item.occurredOn)}</span>
                  </div>
                  <Money value={item.amountCents} sign="never" className="shrink-0 text-sm font-medium tabular" />
                </li>
              ))}
            </ul>
            {overdueRecurring.count > overdueRecurring.items.length ? (
              <Link
                href="/lancamentos"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Ver mais {overdueRecurring.count - overdueRecurring.items.length} em Lançamentos →
              </Link>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
