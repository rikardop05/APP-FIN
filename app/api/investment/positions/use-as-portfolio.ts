import { getInvestmentPlan, InvestmentPlanNotFoundError } from '@/lib/db/queries/investment';
import { copySnapshotToPlan, getSnapshot } from '@/lib/db/queries/investment-positions';
import { toCompetence } from '@/lib/date';

import { assertComputable } from '../compute';

/**
 * D4: copia o valor do registro para `current_portfolio_cents` do plano, e a data dele para
 * `current_portfolio_as_of` (D7: a curva passa a partir dali). Antes de gravar, o
 * motor confere que o plano com o patrimônio novo ainda é calculável (o mesmo cuidado do PUT
 * do plano): recusa -> 400, nada gravado. Sem sessão aqui, para o teste exercitar.
 */
export async function applySnapshotToPlan(householdId: string, snapshotId: string, today: string): Promise<void> {
  const [snapshot, stored] = await Promise.all([getSnapshot(householdId, snapshotId), getInvestmentPlan(householdId)]);
  if (stored === null) throw new InvestmentPlanNotFoundError();
  assertComputable(
    { ...stored.plan, currentPortfolioCents: snapshot.portfolioCents },
    stored.scenarios,
    toCompetence(today),
  );
  await copySnapshotToPlan(householdId, snapshot);
}
