import { InvestmentPlanNotFoundError } from '@/lib/db/queries/investment';
import { SnapshotDateTakenError, SnapshotNotFoundError } from '@/lib/db/queries/investment-positions';

import { InvestmentPremiseError } from '../compute';

/**
 * Erro de domínio das posições -> status HTTP e mensagem. Sem importar a sessão (que puxa
 * o Auth.js), para o teste de banco exercitar o mapeamento. `null` = não é de domínio.
 */
export function domainFailure(error: unknown): { status: number; error: string } | null {
  if (error instanceof SnapshotNotFoundError) return { status: 404, error: error.message };
  if (error instanceof InvestmentPlanNotFoundError) return { status: 404, error: error.message };
  if (error instanceof SnapshotDateTakenError) return { status: 409, error: error.message };
  if (error instanceof InvestmentPremiseError) return { status: 400, error: error.message };
  return null;
}
