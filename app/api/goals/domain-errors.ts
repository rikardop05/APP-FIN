import { EmergencyFundExistsError, GoalNotFoundError, GoalReferenceError } from '@/lib/db/queries/goals';

/**
 * Erro de domínio das metas -> status HTTP e mensagem. Sem importar a sessão (que puxa o
 * Auth.js), para o teste de banco poder exercitar o mapeamento. `null` = não é erro de domínio.
 */
export function domainFailure(error: unknown): { status: number; error: string } | null {
  if (error instanceof GoalNotFoundError) return { status: 404, error: error.message };
  if (error instanceof GoalReferenceError) return { status: 400, error: 'Conta inválida para a meta.' };
  if (error instanceof EmergencyFundExistsError) return { status: 409, error: error.message };
  return null;
}
