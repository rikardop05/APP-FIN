import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { investmentPlans, investmentSnapshots, transactions } from '@/lib/db/schema';
import type { Competence, IsoDate } from '@/lib/date';
import { cents, type Cents } from '@/lib/money';

import { InvestmentPlanNotFoundError } from './investment';

/**
 * Posições reais de investimento — T-404 (`.notas/contrato-t404.md`). Só seleção e
 * gravação; a aderência e a comparação com a curva são de `lib/finance/positions.ts`.
 *
 * - Um registro por dia por household (`unique (household_id, as_of)`, D2): `saveSnapshot`
 *   na mesma data EDITA o existente.
 * - Registrar posição NÃO muda o plano (D4); `copySnapshotToPlan` é o passo explícito.
 */

export type SnapshotRow = { id: string; asOf: IsoDate; portfolioCents: Cents; note: string | null };

export type SnapshotInput = { asOf: IsoDate; portfolioCents: Cents; note: string | null };

export class SnapshotNotFoundError extends Error {
  constructor() {
    super('Registro de posição não encontrado.');
    this.name = 'SnapshotNotFoundError';
  }
}

export class SnapshotDateTakenError extends Error {
  constructor(asOf: IsoDate) {
    super(`Já existe um registro de posição em ${asOf}. Edite esse registro.`);
    this.name = 'SnapshotDateTakenError';
  }
}

const SNAPSHOT_DATE_INDEX = 'investment_snapshots_household_id_as_of_unique';

/** 23505 no índice de data, descendo a cadeia `cause` do drizzle. */
function isDateConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint_name === SNAPSHOT_DATE_INDEX) return true;
    current = candidate.cause;
  }
  return false;
}

function safeCents(value: string | number): Cents {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error('Valor monetário fora do intervalo seguro.');
  return cents(numeric);
}

/** Registros do household, do mais antigo ao mais novo. */
export async function listSnapshots(householdId: string): Promise<SnapshotRow[]> {
  const rows = await db
    .select({
      id: investmentSnapshots.id,
      asOf: investmentSnapshots.asOf,
      portfolioCents: investmentSnapshots.portfolioCents,
      note: investmentSnapshots.note,
    })
    .from(investmentSnapshots)
    .where(eq(investmentSnapshots.householdId, householdId))
    .orderBy(asc(investmentSnapshots.asOf));
  return rows.map((row) => ({ ...row, portfolioCents: safeCents(row.portfolioCents) }));
}

/**
 * Grava a posição da data. Se já há registro naquele dia, EDITA (D2: registrar de novo no
 * mesmo dia = editar). Devolve o id e se substituiu um existente.
 */
export async function saveSnapshot(
  householdId: string,
  input: SnapshotInput,
): Promise<{ id: string; replaced: boolean }> {
  const [row] = await db
    .insert(investmentSnapshots)
    .values({ householdId, ...input })
    .onConflictDoUpdate({
      target: [investmentSnapshots.householdId, investmentSnapshots.asOf],
      set: { portfolioCents: input.portfolioCents, note: input.note },
    })
    // `xmax <> 0` só na linha que o ON CONFLICT atualizou (a inserida tem xmax 0).
    .returning({ id: investmentSnapshots.id, replaced: sql<boolean>`xmax <> 0` });
  if (row === undefined) throw new Error('Não foi possível gravar a posição.');
  return { id: row.id, replaced: Boolean(row.replaced) };
}

/** Edita um registro pelo id (inclusive a data). Data já usada por OUTRO registro -> erro. */
export async function updateSnapshot(householdId: string, id: string, input: SnapshotInput): Promise<void> {
  const [taken] = await db
    .select({ id: investmentSnapshots.id })
    .from(investmentSnapshots)
    .where(
      and(
        eq(investmentSnapshots.householdId, householdId),
        eq(investmentSnapshots.asOf, input.asOf),
        ne(investmentSnapshots.id, id),
      ),
    )
    .limit(1);
  if (taken !== undefined) throw new SnapshotDateTakenError(input.asOf);
  try {
    const updated = await db
      .update(investmentSnapshots)
      .set(input)
      .where(and(eq(investmentSnapshots.id, id), eq(investmentSnapshots.householdId, householdId)))
      .returning({ id: investmentSnapshots.id });
    if (updated.length === 0) throw new SnapshotNotFoundError();
  } catch (error) {
    // Corrida com outro registro na mesma data: o índice decide.
    if (isDateConflict(error)) throw new SnapshotDateTakenError(input.asOf);
    throw error;
  }
}

export async function deleteSnapshot(householdId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(investmentSnapshots)
    .where(and(eq(investmentSnapshots.id, id), eq(investmentSnapshots.householdId, householdId)))
    .returning({ id: investmentSnapshots.id });
  if (deleted.length === 0) throw new SnapshotNotFoundError();
}

/** O registro, para o passo D4 (quem chama valida com o motor antes de copiar). */
export async function getSnapshot(householdId: string, id: string): Promise<SnapshotRow> {
  const [row] = await db
    .select({
      id: investmentSnapshots.id,
      asOf: investmentSnapshots.asOf,
      portfolioCents: investmentSnapshots.portfolioCents,
      note: investmentSnapshots.note,
    })
    .from(investmentSnapshots)
    .where(and(eq(investmentSnapshots.id, id), eq(investmentSnapshots.householdId, householdId)))
    .limit(1);
  if (row === undefined) throw new SnapshotNotFoundError();
  return { ...row, portfolioCents: safeCents(row.portfolioCents) };
}

/**
 * D4: o valor do registro passa a ser o `current_portfolio_cents` do plano, e a data dele
 * passa a ser `current_portfolio_as_of` (D7: a curva parte desse patrimônio NESSA data).
 */
export async function copySnapshotToPlan(householdId: string, snapshot: Pick<SnapshotRow, 'asOf' | 'portfolioCents'>): Promise<void> {
  const updated = await db
    .update(investmentPlans)
    .set({ currentPortfolioCents: snapshot.portfolioCents, currentPortfolioAsOf: snapshot.asOf })
    .where(eq(investmentPlans.householdId, householdId))
    .returning({ id: investmentPlans.id });
  if (updated.length === 0) throw new InvestmentPlanNotFoundError();
}

/**
 * Âncora da curva de comparação (D7, que substitui a D3): a competência de
 * `current_portfolio_as_of`, a data a que o patrimônio atual do plano se refere. `null` sem
 * plano. A coluna é `date`, sem fuso.
 */
export async function getPlanStartCompetence(householdId: string): Promise<Competence | null> {
  const [row] = await db
    .select({
      competence: sql<string>`to_char(${investmentPlans.currentPortfolioAsOf}, 'YYYY-MM')`,
    })
    .from(investmentPlans)
    .where(eq(investmentPlans.householdId, householdId))
    .limit(1);
  return row?.competence ?? null;
}

/**
 * Aporte EFETIVO por competência em `[from, to]` (D5): lançamentos `investment_contribution`
 * com status `posted`. Saída de caixa é negativa no banco, então o aporte é `-soma`; um
 * resgate no mesmo mês reduz, mas o mês nunca fica negativo (`max(0, …)`): aporte líquido.
 * Só os meses com algum lançamento; quem monta a janela completa com 0.
 */
export async function getContributionMonths(
  householdId: string,
  from: Competence,
  to: Competence,
): Promise<{ competence: Competence; actualCents: Cents }[]> {
  const rows = await db
    .select({
      competence: transactions.competence,
      total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.kind, 'investment_contribution'),
        eq(transactions.status, 'posted'),
        gte(transactions.competence, from),
        lte(transactions.competence, to),
      ),
    )
    .groupBy(transactions.competence)
    .orderBy(asc(transactions.competence));
  return rows.map((row) => ({ competence: row.competence, actualCents: cents(Math.max(0, -safeCents(row.total))) }));
}
