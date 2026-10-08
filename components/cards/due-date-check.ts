import { formatDateBR, type Competence, type IsoDate } from '@/lib/date';
import { statementWindow, type CardCycleConfig } from '@/lib/finance/billing';

/**
 * Aviso de vencimento desatualizado (decisão 11c do Ricardo, 2026-10-07): quando o vencimento
 * GRAVADO de uma fatura em aberto não bate com o ciclo ATUAL do cartão, a tela de cartões avisa.
 * Caso real: o Santander mudou o vencimento do dia 10 para o dia 7, e a fatura de setembro ficou
 * gravada com 2026-09-10.
 *
 * Só avisa. Não recalcula nem altera dado algum: quem decide se a data gravada ou o ciclo está
 * certo é a pessoa. A data esperada vem do motor de faturas (`statementWindow`, CONTRACTS §3), a
 * mesma regra que gravou a fatura: nenhuma conta de calendário é refeita aqui.
 *
 * Só fatura em ABERTO: fechada e paga são história, e o ciclo antigo era o correto naquela época.
 */

export type CheckedStatement = {
  id: string;
  period: Competence;
  dueDate: IsoDate;
  status: 'open' | 'closed' | 'paid';
};

export type DueDateWarning = {
  statementId: string;
  period: Competence;
  storedDueDate: IsoDate;
  /** O vencimento que o ciclo atual do cartão daria para este período. */
  expectedDueDate: IsoDate;
  message: string;
};

function expectedDueDate(period: Competence, cycle: CardCycleConfig): IsoDate | null {
  try {
    return statementWindow(period, cycle).dueDate;
  } catch {
    // Ciclo ou competência inválidos: sem base de comparação, então sem aviso (nunca lança na tela).
    return null;
  }
}

export function dueDateWarnings(
  statements: readonly CheckedStatement[],
  cycle: CardCycleConfig,
): DueDateWarning[] {
  return statements.flatMap((statement) => {
    if (statement.status !== 'open') return [];
    const expected = expectedDueDate(statement.period, cycle);
    if (expected === null || expected === statement.dueDate) return [];
    return [
      {
        statementId: statement.id,
        period: statement.period,
        storedDueDate: statement.dueDate,
        expectedDueDate: expected,
        message:
          `O vencimento gravado desta fatura (${formatDateBR(statement.dueDate)}) não bate com o ciclo atual ` +
          `do cartão (vence dia ${String(cycle.dueDay)}, o que daria ${formatDateBR(expected)}). ` +
          'Nada foi alterado: confira a data na fatura.',
      },
    ];
  });
}
