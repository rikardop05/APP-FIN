/**
 * Núcleo puro da previsão de recorrência gravada como linha `planned`.
 *
 * Transforma as ocorrências de `expandRecurrence` (CONTRACTS §8) em linhas de
 * `transactions`, no desenho irmão de `lib/db/queries/import.ts` (onde a
 * parcela futura de fatura importada vira `planned`). Sem import de
 * `@/lib/db`: testável sem banco, como `recurring-shape.ts`.
 *
 * ## O que NÃO fazer com estas linhas (a armadilha que compila)
 *
 * - **Criação** → INSERT com `ON CONFLICT ... DO NOTHING` apontando para o
 *   índice parcial único (`transactions_hh_*_planned_unique`). É idempotente:
 *   gerar a mesma regra duas vezes não produz 24 linhas onde deviam ser 12.
 * - **Edição** → NUNCA `DO NOTHING`. Se a conta de luz muda de R$ 180 para
 *   R$ 220 e a regeneração pula "o que já existe", as linhas antigas ficam e o
 *   painel mostra R$ 180 para sempre, sem erro e sem aviso. A edição apaga as
 *   `planned` futuras NÃO conciliadas da regra e regenera, no padrão do
 *   `replanInstallments` (CONTRACTS §4). "Não conciliada" não é "ainda não
 *   passou": errar isso apaga lançamento real.
 *
 * Os dois caminhos compilam; só um está certo para cada caso. Este módulo só
 * monta as linhas. Quem escolhe o caminho é quem grava.
 *
 * ## Premissas escritas, não implícitas
 *
 * - **`kind` vem da ORIGEM, não do sinal.** Pela convenção, saída é negativa,
 *   mas `transfer` e `credit_card_payment` também são negativos e NÃO são
 *   despesa (RC-03). "O sinal determina o `kind`" é verdade só aqui, porque
 *   recorrência gera apenas despesa ou receita. Por isso o `kind` sai de qual
 *   origem pediu a linha, e o sinal é conferido contra ela — divergência lança.
 * - **`rawDescription = ''` NÃO é marcador de previsão no banco.** O pipeline de
 *   importação usa `''` internamente para "linha projetada", mas no banco `''`
 *   também é o lançamento manual (DATA-MODEL). Nenhuma consulta distingue por
 *   isso; o marcador real é `status = 'planned'`.
 * - **`dedupeHash = null`.** A unicidade da previsão é dos índices parciais por
 *   origem + competência. Um hash aqui poderia colidir com o índice de
 *   `dedupe_hash` de uma linha importada de mesmo valor, data e descrição.
 * - **O `dueDay` de uma despesa fixa em cartão é o dia em que a COBRANÇA ENTRA
 *   NO CARTÃO, não o vencimento da fatura** (decisão do Orquestrador,
 *   2026-09-30). É a leitura de "assinatura dia 28": o lojista cobra dia 28, e
 *   em que fatura isso cai é consequência do ciclo, não escolha de quem preenche
 *   o formulário. Quem sabe atravessar o ciclo é `billingPeriodFor`, a mesma
 *   função que o lançamento manual usa (`transactions.ts`,
 *   `transactionDateFields`) — um segundo jeito de calcular seria divergência
 *   esperando para acontecer. Se alguém inverter esta premissa, a despesa cai
 *   na fatura errada com um número plausível.
 * - **Competência**: em conta, o mês da ocorrência. Em cartão, a da FATURA
 *   (`billingPeriodFor(date, ciclo).competence`) e `cashDate` = vencimento dela.
 * - **Duas ocorrências na mesma competência lançam.** Com dia 31 e fechamento
 *   >= 28, janeiro (dia 31) cai na fatura de fevereiro e fevereiro (dia 28,
 *   ajustado) também. O índice parcial único rejeitaria a segunda, e o
 *   `ON CONFLICT DO NOTHING` a descartaria em silêncio. Falha alta.
 */

import type { Frequency, TransactionKind } from '@/lib/db/enums';
import { addCompetence, toCompetence, type Competence } from '@/lib/date';
import { billingPeriodFor, type CardCycleConfig } from '@/lib/finance/billing';
import {
  expandRecurrence,
  type PlannedOccurrence,
  type RecurrenceInput,
} from '@/lib/finance/recurrence';
import { basisPoints, cents, type Cents } from '@/lib/money';

/** Origem da previsão. Cada uma casa com um dos índices parciais. */
export type PlannedOrigin =
  | { kind: 'expense'; recurringExpenseId: string }
  | { kind: 'income'; incomeId: string };

/**
 * Onde a linha cai: exatamente um dos dois (CHECK `account_xor_credit_card`).
 * Em cartão, o ciclo vem junto: sem ele não há como saber a fatura.
 */
export type PlannedDestination =
  | { accountId: string; creditCardId: null }
  | { accountId: null; creditCardId: string; cycle: CardCycleConfig };

export interface PlannedSeries {
  householdId: string;
  origin: PlannedOrigin;
  description: string;
  categoryId: string | null;
  memberId: string | null;
  destination: PlannedDestination;
}

/** Linha pronta para `insert(transactions)`, sempre `planned`. */
export interface PlannedTransactionRow {
  householdId: string;
  occurredOn: string;
  competence: string;
  cashDate: string;
  description: string;
  rawDescription: '';
  amountCents: Cents;
  kind: TransactionKind;
  status: 'planned';
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  recurringExpenseId: string | null;
  incomeId: string | null;
  dedupeHash: null;
}

export class PlannedSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannedSeriesError';
  }
}

/** Confere que o sinal bate com a origem: despesa < 0, receita > 0. */
function assertSign(origin: PlannedOrigin, amountCents: Cents): void {
  if (origin.kind === 'expense' && amountCents >= 0) {
    throw new PlannedSeriesError(
      `Despesa fixa prevista com valor não negativo (${String(amountCents)}): despesa é saída e deve ser negativa.`,
    );
  }
  if (origin.kind === 'income' && amountCents <= 0) {
    throw new PlannedSeriesError(
      `Receita prevista com valor não positivo (${String(amountCents)}): receita é entrada e deve ser positiva.`,
    );
  }
}

/**
 * Monta as linhas `planned` de uma série. Lança (falha alto) se o sinal
 * contrariar a origem ou se duas ocorrências caírem na mesma competência: gravar
 * um valor errado, ou descartar uma ocorrência, em silêncio é pior do que
 * recusar. O destino (conta XOR cartão) já é garantido pelo tipo.
 */
export function buildPlannedRows(
  series: PlannedSeries,
  occurrences: readonly PlannedOccurrence[],
): PlannedTransactionRow[] {
  const { origin, destination } = series;
  const seen = new Set<string>();

  return occurrences.map((occurrence) => {
    assertSign(origin, occurrence.amountCents);
    // Conta: o mês da ocorrência. Cartão: a fatura em que a cobrança cai.
    const placement =
      destination.creditCardId === null
        ? { competence: occurrence.competence, cashDate: occurrence.date }
        : (() => {
            const period = billingPeriodFor(occurrence.date, destination.cycle);
            return { competence: period.competence, cashDate: period.dueDate };
          })();
    if (seen.has(placement.competence)) {
      throw new PlannedSeriesError(
        `Duas ocorrências caem na competência ${placement.competence}: com dia de cobrança perto do fechamento, o ajuste de fim de mês junta duas cobranças na mesma fatura. Ajuste o dia de cobrança.`,
      );
    }
    seen.add(placement.competence);
    return {
      householdId: series.householdId,
      occurredOn: occurrence.date,
      competence: placement.competence,
      cashDate: placement.cashDate,
      description: series.description,
      rawDescription: '',
      amountCents: occurrence.amountCents,
      kind: origin.kind === 'expense' ? 'expense' : 'income',
      status: 'planned',
      categoryId: series.categoryId,
      accountId: destination.accountId,
      creditCardId: destination.creditCardId,
      memberId: series.memberId,
      recurringExpenseId: origin.kind === 'expense' ? origin.recurringExpenseId : null,
      incomeId: origin.kind === 'income' ? origin.incomeId : null,
      dedupeHash: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Da regra às linhas: o que a criação e o `topUpPlanned` têm em comum.
// ---------------------------------------------------------------------------

/** Despesa fixa como vem do banco (campos que importam para a previsão). */
export interface ExpenseRule {
  id: string;
  description: string;
  expectedCents: number;
  categoryId: string;
  dueDay: number;
  frequency: Frequency;
  accountId: string | null;
  creditCardId: string | null;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: number | null;
}

/** Receita como vem do banco. */
export interface IncomeRule {
  id: string;
  description: string;
  expectedCents: number;
  memberId: string;
  accountId: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * Janela da previsão: da competência de `today` por `months` meses. Nunca gera
 * o passado — uma regra com `startsOn` antigo só projeta de hoje em diante.
 * `today` é parâmetro: esta camada não lê o relógio.
 */
export function plannedWindow(today: string, months: number): {
  from: Competence;
  months: number;
} {
  return { from: toCompetence(today), months };
}

/** Último mês (inclusive) coberto pela janela, para mensagens e testes. */
export function plannedWindowEnd(window: { from: Competence; months: number }): Competence {
  return addCompetence(window.from, Math.max(0, window.months - 1));
}

/** A regra de recorrência de uma despesa fixa, no formato do motor. */
export function expenseRecurrence(rule: ExpenseRule): RecurrenceInput {
  return {
    expectedCents: cents(rule.expectedCents),
    dueDay: rule.dueDay,
    frequency: rule.frequency,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
    annualAdjustmentBp:
      rule.annualAdjustmentBp === null ? null : basisPoints(rule.annualAdjustmentBp),
  };
}

/** A série (origem, destino, campos copiados) de uma despesa fixa. */
export function expenseSeries(
  householdId: string,
  rule: ExpenseRule,
  cycle: CardCycleConfig | null,
): PlannedSeries {
  let destination: PlannedDestination;
  if (rule.creditCardId !== null && rule.accountId === null) {
    if (cycle === null) {
      throw new PlannedSeriesError('Cartão da despesa fixa sem ciclo de fatura.');
    }
    destination = { accountId: null, creditCardId: rule.creditCardId, cycle };
  } else if (rule.accountId !== null && rule.creditCardId === null) {
    destination = { accountId: rule.accountId, creditCardId: null };
  } else {
    throw new PlannedSeriesError('Despesa fixa sem destino único (conta XOR cartão).');
  }
  return {
    householdId,
    origin: { kind: 'expense', recurringExpenseId: rule.id },
    description: rule.description,
    categoryId: rule.categoryId,
    memberId: null,
    destination,
  };
}

export function plannedRowsForExpense(
  householdId: string,
  rule: ExpenseRule,
  cycle: CardCycleConfig | null,
  window: { from: Competence; months: number },
): PlannedTransactionRow[] {
  return buildPlannedRows(
    expenseSeries(householdId, rule, cycle),
    expandRecurrence(expenseRecurrence(rule), window),
  );
}

/** A regra de recorrência de uma receita, no formato do motor. */
export function incomeRecurrence(rule: IncomeRule): RecurrenceInput {
  // `expandRecurrence` valida `startsOn` em todo caminho, inclusive `one_off`
  // com competência fixa. Receita eventual pode ter `startsOn` nulo (a
  // competência é o que vale): ancora no primeiro dia dela.
  const startsOn =
    rule.startsOn ??
    (rule.oneOffCompetence === null ? null : `${rule.oneOffCompetence}-01`);
  if (startsOn === null) {
    throw new PlannedSeriesError('Receita sem data de início nem competência fixa.');
  }
  return {
    expectedCents: cents(rule.expectedCents),
    dueDay: rule.receiveDay,
    frequency: rule.frequency,
    startsOn,
    endsOn: rule.endsOn,
    annualAdjustmentBp: null,
    oneOffCompetence: rule.oneOffCompetence,
  };
}

/** A série (origem, destino, campos copiados) de uma receita. */
export function incomeSeries(householdId: string, rule: IncomeRule): PlannedSeries {
  return {
    householdId,
    origin: { kind: 'income', incomeId: rule.id },
    description: rule.description,
    categoryId: null,
    memberId: rule.memberId,
    destination: { accountId: rule.accountId, creditCardId: null },
  };
}

export function plannedRowsForIncome(
  householdId: string,
  rule: IncomeRule,
  window: { from: Competence; months: number },
): PlannedTransactionRow[] {
  return buildPlannedRows(
    incomeSeries(householdId, rule),
    expandRecurrence(incomeRecurrence(rule), window),
  );
}

/**
 * Descarta as linhas que cairiam numa competência JÁ OCUPADA por outra linha da
 * mesma origem, `planned` ou `posted`.
 *
 * Por que existe, além do índice parcial: (1) o índice só cobre `planned`, e
 * inserir uma `planned` ao lado de uma `posted` da mesma origem e competência
 * conta o gasto duas vezes; (2) uma `planned` VENCIDA e não conciliada é
 * preservada na edição e continua ocupando a competência — gerar outra ao lado
 * dela violaria o índice. Nos dois casos a regra é a mesma: quando a competência
 * já tem ocorrência, o valor novo começa na PRÓXIMA (CONTRACTS §8). A de
 * competência ocupada não é inserida e a pendência continua visível.
 *
 * `occupied` são as competências COLOCADAS (em cartão, a da fatura): as mesmas
 * que `buildPlannedRows` grava.
 */
export function dropOccupied(
  rows: readonly PlannedTransactionRow[],
  occupied: ReadonlySet<string>,
): { kept: PlannedTransactionRow[]; skipped: string[] } {
  const kept: PlannedTransactionRow[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (occupied.has(row.competence)) skipped.push(row.competence);
    else kept.push(row);
  }
  return { kept, skipped };
}
