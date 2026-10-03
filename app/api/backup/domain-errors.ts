import { BackupInvalidError, BackupTargetNotEmptyError } from '@/lib/db/queries/backup';

/**
 * Erro de domínio do backup -> status HTTP e corpo. Sem importar a sessão (que puxa o
 * Auth.js), para o teste de banco poder exercitar o mapeamento. `null` = não é de domínio.
 */
export function domainFailure(
  error: unknown,
): { status: number; body: { error: string; problems?: string[]; nonEmpty?: string[] } } | null {
  if (error instanceof BackupInvalidError) {
    return { status: 400, body: { error: error.message, problems: error.problems } };
  }
  if (error instanceof BackupTargetNotEmptyError) {
    return { status: 409, body: { error: error.message, nonEmpty: error.nonEmpty } };
  }
  return null;
}
