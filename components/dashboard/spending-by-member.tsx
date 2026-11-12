import { Users } from 'lucide-react';

import { Money } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';

import { BAR_X_CLASS, barScaleStyle } from './bar-scale';

export type SpendingByMemberItem = {
  memberId: string | null;
  name: string;
  spentCents: Cents;
};

type SpendingByMemberProps = {
  items: readonly SpendingByMemberItem[];
  totalCents: Cents;
};

/**
 * "Quem gastou": a despesa do mês por responsável, mais "Sem responsável". Os valores e o total vêm de
 * `spendingByMember` (mesmas exclusões de `monthlyKpis`; as partes fecham com a Despesa do mês). A largura
 * da barra é só apresentação: o maior da lista ocupa o trilho inteiro. Quem decide se o bloco aparece é a
 * página (só com pelo menos uma despesa com responsável).
 */
export function SpendingByMember({ items, totalCents }: SpendingByMemberProps) {
  const maxSpent = items.reduce((max, item) => (item.spentCents > max ? item.spentCents : max), 0);

  return (
    <section aria-labelledby="dashboard-by-member-heading" className="border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="dashboard-by-member-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Quem gastou
          </h2>
          <p className="text-sm text-muted-foreground">Despesa do mês por responsável.</p>
        </div>
        <p className="whitespace-nowrap text-sm text-muted-foreground">
          Total <Money value={totalCents} sign="never" className="font-semibold text-foreground" />
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const width = maxSpent > 0 ? Math.max(2, (Number(item.spentCents) / Number(maxSpent)) * 100) : 0;
          return (
            <li key={item.memberId ?? 'sem-responsavel'} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.name}</span>
                <Money value={item.spentCents} sign="never" className="whitespace-nowrap text-sm font-semibold" />
              </div>
              <div
                className="h-2 overflow-hidden bg-secondary"
                role="img"
                aria-label={`${item.name}: ${Math.round(width)}% do maior gasto da lista`}
              >
                <div
                  className={`${BAR_X_CLASS} ${item.memberId === null ? 'bg-muted-foreground' : 'bg-primary'}`}
                  style={barScaleStyle(width, 'x')}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
