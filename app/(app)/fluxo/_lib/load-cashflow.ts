import { getCashflowData } from '@/lib/db/queries/cashflow';
import { projectCashflow, type CashflowProjection } from '@/lib/finance/cashflow';

import { toCashflowInput, type CashflowBase } from './to-cashflow-input';

/** Janela da projeção: a mesma em `/fluxo` e no painel. */
export const CASHFLOW_WINDOW_MONTHS = 12;

export type LoadedCashflow = CashflowBase & { projection: CashflowProjection };

/**
 * ÚNICO caminho que monta a entrada do motor de fluxo e o roda: leitura →
 * adaptador → `projectCashflow`. `/fluxo` e o painel chamam esta função, e é isso
 * que garante que mostrem o MESMO saldo projetado. Montar a entrada em outro lugar
 * (outro recorte, outra regra de balde) faria as duas telas divergirem, e o
 * Ricardo veria dois números para a mesma coisa.
 *
 * Só leitura. Roda o motor no servidor: sinal errado lança aqui, nunca vira
 * gráfico torto.
 */
export async function loadProjectedCashflow(
  householdId: string,
  today: string,
  months: number = CASHFLOW_WINDOW_MONTHS,
): Promise<LoadedCashflow> {
  const data = await getCashflowData(householdId, today, months);
  const base = toCashflowInput(data);
  return { ...base, projection: projectCashflow(base.input) };
}
