import { toCompetence } from '@/lib/date';
import { getCashflowData } from '@/lib/db/queries/cashflow';
import { getOverdueUnpaidStatements, type OverdueUnpaidStatements } from '@/lib/db/queries/dashboard';
import { topUpPlanned } from '@/lib/db/queries/recurring-planned-write';
import {
  projectCashflow,
  projectWithOverdueStatements,
  type CashflowProjection,
  type OverdueStatementsScenario,
} from '@/lib/finance/cashflow';

import { toCashflowInput, type CashflowBase } from './to-cashflow-input';

/** Janela da projeção: a mesma em `/fluxo` e no painel. */
export const CASHFLOW_WINDOW_MONTHS = 12;

export type LoadedCashflow = CashflowBase & {
  projection: CashflowProjection;
  /**
   * `false` quando não há NADA para projetar (saldo zero e nenhum lançamento na
   * janela). Nesse caso a curva seria uma linha reta em zero e o veredito diria
   * "não fica negativo" sobre uma casa vazia — as duas telas mostram um estado
   * vazio em vez disso, e decidem pelo MESMO critério, que mora aqui.
   */
  hasProjectableData: boolean;
  /**
   * Faturas de competências anteriores, existentes e não marcadas como pagas (mesma regra do
   * "Comprometido nos cartões"). A projeção NÃO as desconta (decisão do Ricardo, 2026-10-09):
   * o campo existe para a tela avisar quanto fica de fora. `totalCents` negativo = a pagar.
   */
  overdueUnpaidStatements: OverdueUnpaidStatements;
  /**
   * Segunda leitura do veredito: a MESMA entrada da projeção, com
   * `overdueUnpaidStatements.notInProjectionCents` descontado no mês corrente (pior fechamento, mês dele, primeiro mês negativo e o valor
   * considerado). `projection` não muda: isto é só aviso (decisão do Ricardo, 2026-10-09).
   */
  withOverdueStatements: OverdueStatementsScenario;
};

/**
 * ÚNICO caminho que monta a entrada do motor de fluxo e o roda: previsão →
 * leitura → adaptador → `projectCashflow`. `/fluxo` e o painel chamam esta
 * função, e é isso que garante que mostrem o MESMO saldo projetado. Montar a
 * entrada em outro lugar (outro recorte, outra regra de balde) faria as duas
 * telas divergirem, e o Ricardo veria dois números para a mesma coisa.
 *
 * Vive em `app/_lib/` porque serve a duas rotas; `_lib` de uma rota não pode
 * servir a outra.
 *
 * Chama `topUpPlanned` primeiro, de propósito: a projeção lê as linhas previstas
 * de recorrência. Se só uma das telas completasse, a que fosse aberta primeiro
 * mostraria um saldo diferente da outra. É a ÚNICA chamada de `topUpPlanned` no
 * request de `/fluxo` e do painel: o painel chama este loader antes das suas
 * outras leituras e não chama `topUpPlanned` por conta própria.
 * É escrita idempotente (`ON CONFLICT DO NOTHING` nos índices parciais) e nunca
 * lança. O resto é só leitura, e o motor roda no servidor: sinal errado lança
 * aqui, nunca vira gráfico torto.
 */
export async function loadProjectedCashflow(
  householdId: string,
  today: string,
  months: number = CASHFLOW_WINDOW_MONTHS,
): Promise<LoadedCashflow> {
  await topUpPlanned(householdId, today);
  const [data, overdueUnpaidStatements] = await Promise.all([
    getCashflowData(householdId, today, months),
    getOverdueUnpaidStatements(householdId, toCompetence(today)),
  ]);
  const base = toCashflowInput(data);
  const { input } = base;
  const hasProjectableData =
    input.openingBalanceCents !== 0 ||
    input.incomes.length +
      input.recurringExpenses.length +
      input.installments.length +
      input.statementsDue.length +
      input.plannedContributions.length >
      0;
  return {
    ...base,
    projection: projectCashflow(input),
    hasProjectableData,
    overdueUnpaidStatements,
    // So a parte que a projecao ainda nao leva (vencimento antes da janela): a fatura
    // anterior que vence dentro da janela ja esta em `statementsDue`.
    withOverdueStatements: projectWithOverdueStatements(input, overdueUnpaidStatements.notInProjectionCents),
  };
}
