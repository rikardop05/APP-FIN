import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import type { GoalStatus } from '@/lib/db';
import { getEssentialAverageData, listGoals } from '@/lib/db/queries/goals';
import { getSettings } from '@/lib/db/queries/settings';
import { accounts } from '@/lib/db/schema';
import {
  emergencyFundTarget,
  essentialMonthlyAverage,
  goalProgress,
  sortGoals,
  type GoalProgress,
} from '@/lib/finance/goals';
import type { Cents } from '@/lib/money';

export type GoalView = {
  id: string;
  name: string;
  status: GoalStatus;
  priority: number;
  isEmergencyFund: boolean;
  targetDate: string | null;
  accountId: string | null;
  accountName: string | null;
  /** Saldo da conta quando vinculada; senão o valor informado. */
  currentCents: Cents;
  /** `null` na reserva sem histórico para calcular o alvo. */
  targetCents: Cents | null;
  /** `null` quando não há alvo (reserva sem histórico). */
  progress: GoalProgress | null;
};

export type GoalsResponse = {
  goals: GoalView[];
  accounts: { id: string; name: string }[];
  emergency: {
    /** `household_settings.emergency_fund_months`. */
    months: number;
    /** Média mensal essencial; `null` = sem nenhum mês com lançamento na janela. */
    averageCents: Cents | null;
    monthsWithData: number;
    windowFrom: string;
    windowTo: string;
    /** `months × média`; `null` quando não há média. */
    targetCents: Cents | null;
    /** Já existe uma meta de reserva (a sugestão some). */
    exists: boolean;
  };
};

/**
 * Monta a resposta de `/api/goals`: lê o banco e entrega tudo já calculado pelo motor
 * (`lib/finance/goals`). A tela não faz conta.
 */
export async function loadGoalsResponse(householdId: string, today: string): Promise<GoalsResponse> {
  const [rows, essential, settings, accountRows] = await Promise.all([
    listGoals(householdId, today),
    getEssentialAverageData(householdId, today),
    getSettings(householdId),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.active, true)))
      .orderBy(asc(accounts.name)),
  ]);

  const averageCents = essentialMonthlyAverage(essential.months);
  const emergencyTarget =
    averageCents === null
      ? null
      : emergencyFundTarget({
          monthlyEssentialAverageCents: averageCents,
          months: settings.emergencyFundMonths,
        });

  const goals: GoalView[] = sortGoals(rows).map((row) => {
    const targetCents = row.isEmergencyFund ? emergencyTarget : row.targetCents;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      priority: row.priority,
      isEmergencyFund: row.isEmergencyFund,
      targetDate: row.targetDate,
      accountId: row.accountId,
      accountName: row.accountName,
      currentCents: row.currentCents,
      targetCents,
      progress:
        targetCents === null || targetCents <= 0
          ? null
          : goalProgress({
              targetCents,
              currentCents: row.currentCents,
              targetDate: row.targetDate,
              today,
            }),
    };
  });

  return {
    goals,
    accounts: accountRows,
    emergency: {
      months: settings.emergencyFundMonths,
      averageCents,
      monthsWithData: essential.months.length,
      windowFrom: essential.from,
      windowTo: essential.to,
      targetCents: emergencyTarget,
      exists: rows.some((row) => row.isEmergencyFund),
    },
  };
}
