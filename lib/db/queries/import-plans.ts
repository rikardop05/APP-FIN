import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { installmentPlans, transactions } from '@/lib/db/schema';
import type { ExistingInstallmentPlan } from '@/lib/import/pipeline';
import { cents } from '@/lib/money';

/**
 * Parcelamentos ja gravados de um cartao, na forma que `finalizeImport` e
 * `buildImportPreview` consomem (`existingPlans`, CONTRACTS §16).
 *
 * Sem isto, a fatura SEGUINTE de uma compra parcelada criava um plano novo e
 * reprojetava as parcelas futuras com o mesmo `dedupe_hash` das `planned` do
 * lote anterior: o indice unico `(household_id, dedupe_hash)` derrubava o
 * commit, e a parcela real ficava ao lado da prevista sem conciliar.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

export type { ExistingInstallmentPlan };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export async function listExistingInstallmentPlans(
  householdId: string,
  creditCardId: string,
  executor: Executor = db,
): Promise<ExistingInstallmentPlan[]> {
  const plans = await executor
    .select({
      id: installmentPlans.id,
      description: installmentPlans.description,
      installmentsCount: installmentPlans.installmentsCount,
      totalCents: installmentPlans.totalCents,
      firstCompetence: installmentPlans.firstCompetence,
    })
    .from(installmentPlans)
    .where(
      and(
        eq(installmentPlans.householdId, householdId),
        eq(installmentPlans.creditCardId, creditCardId),
      ),
    )
    .orderBy(asc(installmentPlans.createdAt), asc(installmentPlans.id));
  if (plans.length === 0) return [];

  const children = await executor
    .select({
      id: transactions.id,
      installmentPlanId: transactions.installmentPlanId,
      installmentNumber: transactions.installmentNumber,
      status: transactions.status,
      rawDescription: transactions.rawDescription,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(
          transactions.installmentPlanId,
          plans.map((plan) => plan.id),
        ),
        inArray(transactions.status, ['planned', 'posted']),
      ),
    )
    .orderBy(asc(transactions.installmentNumber));

  return plans.map((plan) => {
    const mine = children.filter((child) => child.installmentPlanId === plan.id && child.installmentNumber !== null);
    return {
      ...plan,
      totalCents: cents(plan.totalCents),
      openPlanned: mine
        .filter((child) => child.status === 'planned')
        .map((child) => ({ installmentNumber: child.installmentNumber ?? 0, transactionId: child.id })),
      postedNumbers: mine.filter((child) => child.status === 'posted').map((child) => child.installmentNumber ?? 0),
      rawDescriptions: [
        ...new Set(
          mine.filter((child) => child.status === 'posted' && child.rawDescription !== '').map((child) => child.rawDescription),
        ),
      ],
    };
  });
}
