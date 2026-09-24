import { PiggyBank, Receipt } from 'lucide-react';

import { EmptyState, Money } from '@/components/ui-kit';
import { basisPoints, type BasisPoints, type Cents } from '@/lib/money';

type SpendingByCategoryProps = {
  items: {
    categoryId: string;
    name: string;
    nature: 'essential' | 'non_essential' | 'investment' | 'income';
    spentCents: Cents;
    average3mCents: Cents;
    variationBp: BasisPoints | null;
  }[];
  competence: string;
};

/**
 * Gastos por categoria do mês corrente (SPEC §5.8, linha 2, item 2).
 *
 * Cada item já vem do motor `spendingByCategory` (CONTRACTS §14):
 * - `spentCents` é o gasto do mês (líquido com piso em zero, mesma regra
 *   de sinal do §14);
 * - `average3mCents` é a média dos três meses anteriores;
 * - `variationBp` é `(spent - média) / média`, `null` quando a média é zero.
 *
 * Esta tela só desenha barras horizontais, ordena por gasto desc e exibe
 * a variação com sinal. Nenhum cálculo aqui: ordenação é feita pelo motor,
 * a largura da barra é a magnitude relativa dentro do conjunto já
 * fornecido — não é decisão financeira, é decisão de apresentação
 * (CONVENTIONS §2).
 */
export function SpendingByCategory({ items, competence }: SpendingByCategoryProps) {
  const competenciaCurta = `${competence.slice(5)}/${competence.slice(0, 4)}`;

  if (items.length === 0) {
    return (
      <section
        aria-labelledby="dashboard-spending-heading"
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="mb-3">
          <h2 id="dashboard-spending-heading" className="text-base font-semibold text-foreground">
            Gastos por categoria
          </h2>
          <p className="text-sm text-muted-foreground">
            Variação contra a média dos 3 meses anteriores.
          </p>
        </div>
        <EmptyState
          icon={Receipt}
          title="Nenhuma despesa categorizada"
          description="Quando houver lançamentos com categoria em Moradia, Alimentação ou outras, eles aparecem aqui."
          action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
        />
      </section>
    );
  }

  const maxSpent = items.reduce((max, item) => (item.spentCents > max ? item.spentCents : max), 0);

  return (
    <section
      aria-labelledby="dashboard-spending-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="dashboard-spending-heading" className="text-base font-semibold text-foreground">
            Gastos por categoria
          </h2>
          <p className="text-sm text-muted-foreground">
            {competenciaCurta} vs. média dos 3 meses anteriores.
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {items.length} {items.length === 1 ? 'categoria' : 'categorias'}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const width = maxSpent > 0 ? Math.max(2, (Number(item.spentCents) / Number(maxSpent)) * 100) : 0;
          const variation = item.variationBp === null ? null : formatVariationBasisPoints(item.variationBp);
          const tone = variation === null ? 'neutral' : variation.tone;
          return (
            <li key={item.categoryId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {item.nature === 'essential' ? (
                    <PiggyBank className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                  <span className="truncate text-sm font-medium text-foreground">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    média <Money value={item.average3mCents} sign="never" />
                  </span>
                  <Money value={item.spentCents} sign="never" className="text-sm font-semibold tabular" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
                  role="img"
                  aria-label={`${item.name}: ${Math.round(width)}% do maior gasto da lista`}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${width}%` }}
                  />
                </div>
                {variation === null ? (
                  <span className="min-w-[3.5rem] text-right text-xs text-muted-foreground">sem média</span>
                ) : (
                  <span
                    className={`min-w-[3.5rem] text-right text-xs font-medium tabular ${
                      tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-700' : 'text-muted-foreground'
                    }`}
                    title={`Variação contra a média dos 3 meses anteriores`}
                  >
                    {variation.label}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Converte a variação em basis points em rótulo + tom. Apresentação apenas;
 * o número vem do motor.
 */
function formatVariationBasisPoints(bp: BasisPoints): { label: string; tone: 'positive' | 'negative' | 'neutral' } {
  const value = basisPoints(bp);
  if (value === 0) return { label: '0%', tone: 'neutral' };
  const whole = Math.floor(Math.abs(value) / 100);
  const fraction = Math.abs(value) % 100;
  const label = `${value > 0 ? '+' : '−'}${whole},${String(fraction).padStart(2, '0')}%`;
  const tone: 'positive' | 'negative' | 'neutral' = value > 0 ? 'negative' : 'positive';
  return { label, tone };
}
