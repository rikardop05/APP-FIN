import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import {
  addCompetence,
  competenceStart,
  toCompetence,
  type Competence,
  type IsoDate,
} from '@/lib/date';
import { db } from '@/lib/db';
import type { TransactionKind, TransactionStatus } from '@/lib/db';
import { accounts, transactions } from '@/lib/db/schema';
import { cents, type Cents } from '@/lib/money';

/**
 * Leitura do fluxo de caixa (T-207). SÓ LÊ: nenhuma escrita, e em particular
 * nenhum `topUpPlanned` (CONTRACTS §11 / ORCHESTRATION §4.2b).
 *
 * Esta query não classifica nem soma por mês: devolve as linhas que batem no
 * caixa da janela e o saldo de abertura. Quem decide em que balde do motor cada
 * linha cai é o adaptador puro `app/_lib/to-cashflow-input.ts`.
 *
 * ## Eixo: CAIXA, não competência (RC-05)
 *
 * O mês de uma linha é o de `cash_date`. Em item de cartão, `cash_date` é o
 * vencimento da fatura (conferido nos três cartões reais), e é por isso que a
 * fatura entra no mês em que é PAGA. Linha de conta sem `cash_date` cai no
 * `occurred_on`; linha de cartão sem `cash_date` NÃO tem mês de caixa
 * conhecido, e por isso não é adivinhada: fica de fora da janela e é contada em
 * `cardRowsWithoutCashDate`, para a tela avisar.
 *
 * ## Saldo de abertura
 *
 * Saldo REAL da(s) conta(s) ativa(s) no 1º dia da competência de `today`:
 * `opening_balance_cents` + todo movimento `posted` de CONTA anterior ao dia 1,
 * de QUALQUER `kind` — inclusive `credit_card_payment`. Pagamento de fatura já
 * feito é dinheiro que saiu; deixá-lo de fora começaria a curva com um saldo que
 * não existe. Dentro da janela o oposto vale (a fatura entra por
 * `statementsDue`), e a fronteira é o dia 1: não há dupla contagem nem lacuna.
 *
 * Só conta movimento POSTERIOR a `accounts.opening_date`: o saldo informado é o
 * "saldo no dia" e já contém o que aconteceu nele.
 */

/** Tipos de linha que alguma ponta do motor consome. `transfer` e pagamento de fatura NÃO entram na janela (RC-03). */
const WINDOW_KINDS = ['expense', 'income', 'investment_contribution'] as const satisfies readonly TransactionKind[];

export type CashflowRow = {
  /** Data em que bate no caixa (`YYYY-MM-DD`). */
  cashDate: IsoDate;
  /** Com o sinal do banco: saída negativa. */
  amountCents: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
  /** De onde sai o dinheiro: direto da conta, ou via fatura de cartão. */
  origin: 'account' | 'card';
  /** Parcela de um plano (`installment_plan_id`). */
  isInstallment: boolean;
};

export type CashflowData = {
  /** Primeira competência da janela (a de `today`). */
  fromCompetence: Competence;
  months: number;
  openingBalanceCents: Cents;
  rows: CashflowRow[];
  /** Último mês coberto por previsão de recorrência/receita (`planned`), ou `null` se não há nenhuma. */
  recurrencePlannedThrough: Competence | null;
  /** Linhas de cartão da janela sem `cash_date`: o mês de caixa é desconhecido. */
  cardRowsWithoutCashDate: number;
};

function safeCents(value: string | number | null | undefined): Cents {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Valor monetário fora do intervalo seguro.');
  }
  return cents(numeric);
}

export async function getCashflowData(
  householdId: string,
  today: IsoDate,
  months: number,
): Promise<CashflowData> {
  const fromCompetence = toCompetence(today);
  const windowStart = competenceStart(fromCompetence);
  // Fim EXCLUSIVO: 1º dia do mês seguinte à janela.
  const windowEnd = competenceStart(addCompetence(fromCompetence, months));
  const cashDay = sql`coalesce(${transactions.cashDate}, ${transactions.occurredOn})`;

  const [baseAgg, movementAgg, windowRows, plannedAgg, withoutCashDateAgg] =
    await Promise.all([
      db
        .select({ total: sql<string>`coalesce(sum(${accounts.openingBalanceCents}), 0)` })
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true))),
      db
        .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(accounts.householdId, householdId),
            eq(accounts.active, true),
            eq(transactions.status, 'posted'),
            sql`${cashDay} > ${accounts.openingDate}`,
            sql`${cashDay} < ${windowStart}::date`,
          ),
        ),
      db
        .select({
          cashDate: transactions.cashDate,
          occurredOn: transactions.occurredOn,
          amountCents: transactions.amountCents,
          kind: transactions.kind,
          status: transactions.status,
          accountId: transactions.accountId,
          installmentPlanId: transactions.installmentPlanId,
        })
        .from(transactions)
        .leftJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(
          and(
            eq(transactions.householdId, householdId),
            inArray(transactions.kind, [...WINDOW_KINDS]),
            // Linha de conta de conta desativada fica fora, como na abertura.
            or(isNull(accounts.id), eq(accounts.active, true)),
            or(
              and(
                isNotNull(transactions.accountId),
                sql`${cashDay} >= ${windowStart}::date`,
                sql`${cashDay} < ${windowEnd}::date`,
              ),
              and(
                isNotNull(transactions.creditCardId),
                gte(transactions.cashDate, windowStart),
                lt(transactions.cashDate, windowEnd),
              ),
            ),
          ),
        ),
      db
        .select({ last: sql<string | null>`max(${cashDay})` })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.status, 'planned'),
            or(isNotNull(transactions.recurringExpenseId), isNotNull(transactions.incomeId)),
          ),
        ),
      db
        .select({ count: sql<string>`count(*)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            inArray(transactions.kind, [...WINDOW_KINDS]),
            isNotNull(transactions.creditCardId),
            isNull(transactions.cashDate),
            gte(transactions.competence, fromCompetence),
            lt(transactions.competence, addCompetence(fromCompetence, months)),
          ),
        ),
    ]);

  const openingBalanceCents = safeCents(
    safeCents(baseAgg[0]?.total) + safeCents(movementAgg[0]?.total),
  );

  const rows: CashflowRow[] = windowRows.map((row) => {
    const origin = row.accountId === null ? 'card' : 'account';
    const cashDate = row.cashDate ?? (origin === 'account' ? row.occurredOn : null);
    if (cashDate === null) {
      // O WHERE já exclui isto; se chegar aqui, o filtro e o tipo divergiram.
      throw new Error('Linha de cartão sem cash_date na janela de caixa.');
    }
    return {
      cashDate,
      amountCents: safeCents(row.amountCents),
      kind: row.kind,
      status: row.status,
      origin,
      isInstallment: row.installmentPlanId !== null,
    };
  });

  const last = plannedAgg[0]?.last ?? null;

  return {
    fromCompetence,
    months,
    openingBalanceCents,
    rows,
    recurrencePlannedThrough: last === null ? null : toCompetence(last),
    cardRowsWithoutCashDate: Number(withoutCashDateAgg[0]?.count ?? 0),
  };
}
