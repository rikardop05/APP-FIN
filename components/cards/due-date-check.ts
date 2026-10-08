import { competenceLong } from '@/components/cashflow/labels';
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
 * O recorte é por DATA, não por `status`: o app nunca tira a fatura de "aberta" (`statements.status`
 * só nasce `open`), então filtrar por status avisaria faturas pagas há meses. Só avisa fatura cujo
 * vencimento gravado AINDA NÃO PASSOU (`dueDate >= today`): depois do vencimento ela é história, o
 * ciclo antigo era o correto naquela época, e o aviso some sozinho.
 */

export type CheckedStatement = {
  id: string;
  period: Competence;
  dueDate: IsoDate;
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
  /** Hoje (`YYYY-MM-DD`): o relógio só se lê em `app/`, aqui chega por parâmetro. */
  today: IsoDate,
): DueDateWarning[] {
  return statements.flatMap((statement) => {
    // Comparação de string: 'YYYY-MM-DD' ordena como as datas.
    if (statement.dueDate < today) return [];
    const expected = expectedDueDate(statement.period, cycle);
    if (expected === null || expected === statement.dueDate) return [];
    return [
      {
        statementId: statement.id,
        period: statement.period,
        storedDueDate: statement.dueDate,
        expectedDueDate: expected,
        // As duas datas completas, sem "vence dia N": quando só o fechamento muda, o esperado pode
        // cair no mês seguinte e "vence dia 7" não diria isso.
        message:
          `A fatura de ${competenceLong(statement.period)} está gravada com vencimento em ` +
          `${formatDateBR(statement.dueDate)}, mas o ciclo atual do cartão daria ${formatDateBR(expected)}. ` +
          'Nada foi alterado: confira a data na fatura.',
      },
    ];
  });
}
