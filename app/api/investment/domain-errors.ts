import { InvestmentPlanExistsError, InvestmentPlanNotFoundError } from '@/lib/db/queries/investment';

import { InvestmentPremiseError } from './compute';

/**
 * Erro de domínio do planejador -> status HTTP e mensagem. Sem importar a sessão (que puxa o
 * Auth.js), para o teste de banco poder exercitar o mapeamento. `null` = não é erro de domínio.
 *
 * `InvestmentPremiseError`: o motor recusou as premissas na checagem que a rota faz ANTES de
 * gravar (o Zod barra o comum; isto pega o resto, por exemplo um valor que estoura o cálculo).
 * Um `RangeError` qualquer NÃO é mapeado: fora dessa checagem ele é defeito, e vira 500.
 */
export function domainFailure(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvestmentPlanNotFoundError) return { status: 404, error: error.message };
  if (error instanceof InvestmentPlanExistsError) return { status: 409, error: error.message };
  if (error instanceof InvestmentPremiseError) return { status: 400, error: error.message };
  return null;
}
