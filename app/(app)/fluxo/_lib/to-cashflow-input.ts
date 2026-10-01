import { addCompetence, toCompetence, type Competence } from '@/lib/date';
import type { CashflowData } from '@/lib/db/queries/cashflow';
import type { CashflowInput, PlannedOccurrence } from '@/lib/finance/cashflow';
import { addCents, cents, formatBRL, type Cents } from '@/lib/money';

/**
 * Adaptador PURO: linhas do banco (`getCashflowData`) → `CashflowInput`.
 *
 * Não faz conta de saldo — essa é do `projectCashflow`. Aqui só se DECIDE em que
 * balde do motor cada linha cai, e a regra é uma só: **cada linha cai em UM
 * balde, escolhido por onde ela bate no caixa**.
 *
 *   cartão (qualquer linha)          → `statementsDue`, no mês do vencimento
 *   conta, entrada                   → `incomes`
 *   conta, saída de parcela (plano)  → `installments`
 *   conta, aporte                    → `plannedContributions`
 *   conta, qualquer outra saída      → `recurringExpenses`
 *
 * Por que parcela de cartão NÃO vai em `installments`: ela é item da fatura, e a
 * fatura inteira já entra em `statementsDue`. Contá-la nos dois baldes tiraria o
 * dinheiro do caixa duas vezes (RC-03 por outra porta). Para a tela mostrar "da
 * fatura, R$ Y são parcelas" sem mexer no motor, a parcela de cartão sai
 * também em `composition` — exibição, nunca entrada de conta.
 *
 * O SINAL decide a direção, não o `kind`: um estorno (valor positivo numa linha
 * `expense`) é entrada, e o motor lança em sinal errado em vez de absorvê-lo.
 *
 * "Outra saída" inclui o gasto avulso JÁ REALIZADO no mês corrente (mercado no
 * débito). O motor só tem esse slot para saída em conta que não é parcela nem
 * aporte; o nome do campo ("recurringExpenses") é mais estreito que o conteúdo.
 */

export type MonthComposition = {
  /** Total da fatura que vence no mês (o mesmo número de `statementsDue`). */
  statementsCents: Cents;
  /** Quanto desse total é parcela de plano. Subconjunto de `statementsCents`. */
  statementInstallmentsCents: Cents;
};

export type CashflowBase = {
  input: CashflowInput;
  composition: Record<Competence, MonthComposition>;
  warnings: string[];
};

function competenceLabel(competence: Competence): string {
  return `${competence.slice(5)}/${competence.slice(0, 4)}`;
}

export function toCashflowInput(data: CashflowData): CashflowBase {
  const incomes: PlannedOccurrence[] = [];
  const recurringExpenses: PlannedOccurrence[] = [];
  const installments: { competence: Competence; amountCents: Cents }[] = [];
  const plannedContributions: { competence: Competence; amountCents: Cents }[] = [];
  const cardNet = new Map<Competence, Cents>();
  const cardInstallments = new Map<Competence, Cents>();

  for (const row of data.rows) {
    const competence = toCompetence(row.cashDate);
    const amount = row.amountCents;
    const occurrence = { competence, date: row.cashDate, amountCents: amount };

    if (row.origin === 'card') {
      cardNet.set(competence, addCents(cardNet.get(competence) ?? cents(0), amount));
      if (row.isInstallment && amount < 0) {
        cardInstallments.set(
          competence,
          addCents(cardInstallments.get(competence) ?? cents(0), cents(-amount)),
        );
      }
      continue;
    }

    if (amount > 0) {
      incomes.push(occurrence);
    } else if (amount < 0) {
      const magnitude = cents(-amount);
      if (row.kind === 'investment_contribution') {
        plannedContributions.push({ competence, amountCents: magnitude });
      } else if (row.isInstallment) {
        installments.push({ competence, amountCents: magnitude });
      } else {
        recurringExpenses.push(occurrence);
      }
    }
  }

  const warnings: string[] = [];
  const statementsDue: { competence: Competence; amountCents: Cents }[] = [];
  const composition: Record<Competence, MonthComposition> = {};

  for (const [competence, net] of [...cardNet.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (net > 0) {
      // Fatura com saldo credor (estornos maiores que as compras): não há saída
      // a registrar, e o motor recusa valor negativo em `statementsDue`.
      warnings.push(
        `A fatura que vence em ${competenceLabel(competence)} tem saldo credor de ${formatBRL(net)}; o crédito não foi somado ao caixa.`,
      );
      continue;
    }
    if (net === 0) continue;
    const due = cents(-net);
    statementsDue.push({ competence, amountCents: due });
    composition[competence] = {
      statementsCents: due,
      statementInstallmentsCents: cardInstallments.get(competence) ?? cents(0),
    };
  }

  if (data.cardRowsWithoutCashDate > 0) {
    warnings.push(
      `${String(data.cardRowsWithoutCashDate)} lançamento(s) de cartão sem data de vencimento ficaram fora da projeção.`,
    );
  }

  const windowEnd = addCompetence(data.fromCompetence, data.months - 1);
  if (data.recurrencePlannedThrough === null) {
    warnings.push('Não há despesas fixas nem receitas previstas cadastradas.');
  } else if (data.recurrencePlannedThrough < windowEnd) {
    warnings.push(
      `A previsão de despesas fixas e receitas vai só até ${competenceLabel(data.recurrencePlannedThrough)}; os meses seguintes estão sem elas.`,
    );
  }

  return {
    input: {
      openingBalanceCents: data.openingBalanceCents,
      fromCompetence: data.fromCompetence,
      months: data.months,
      incomes,
      recurringExpenses,
      installments,
      statementsDue,
      plannedContributions,
    },
    composition,
    warnings,
  };
}
