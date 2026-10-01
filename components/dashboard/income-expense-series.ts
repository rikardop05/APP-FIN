import { competenceRange, addCompetence, type Competence } from '@/lib/date';
import { monthlyKpis, type TransactionKind, type TransactionStatus } from '@/lib/finance/kpis';
import { cents, type Cents } from '@/lib/money';

export type IncomeExpenseInputRow = {
  competence: Competence;
  amountCents: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
};

export type IncomeExpenseMonth = {
  competence: Competence;
  incomeCents: Cents;
  expenseCents: Cents;
};

/**
 * Série do gráfico "receita × despesa" (SPEC §5.8, gráfico 1): uma entrada por
 * competência, da mais antiga à corrente, SEMPRE as `months` — mês sem lançamento
 * vira zero, não buraco, para a barra não "pular" um mês.
 *
 * Não há regra de dinheiro aqui: cada mês passa por `monthlyKpis`, o mesmo motor
 * do card "Receita/Despesa do mês". É isso que faz a barra do mês corrente bater
 * com o card (piso em zero, estorno puro não vira despesa, transfer e pagamento
 * de fatura invisíveis — RC-03). `categoryNature` não entra em receita nem em
 * despesa, então vai um valor neutro.
 */
export function buildIncomeExpenseSeries(
  rows: readonly IncomeExpenseInputRow[],
  currentCompetence: Competence,
  months: number,
): IncomeExpenseMonth[] {
  const window = competenceRange(addCompetence(currentCompetence, -(months - 1)), months);
  const byCompetence = new Map<Competence, IncomeExpenseInputRow[]>();
  for (const row of rows) {
    const list = byCompetence.get(row.competence) ?? [];
    list.push(row);
    byCompetence.set(row.competence, list);
  }
  return window.map((competence) => {
    const kpis = monthlyKpis({
      competence,
      transactions: (byCompetence.get(competence) ?? []).map((row) => ({
        amountCents: row.amountCents,
        kind: row.kind,
        status: row.status,
        categoryNature: 'non_essential' as const,
      })),
      futureInstallmentsCents: cents(0),
      uncategorizedCount: 0,
    });
    return { competence, incomeCents: kpis.incomeCents, expenseCents: kpis.expenseCents };
  });
}
