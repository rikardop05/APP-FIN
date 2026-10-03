import type { GoalInput } from '@/lib/db/queries/goals';
import { cents } from '@/lib/money';

import { loadGoalsResponse } from './load';
import type { GoalBody } from './schemas';

/**
 * Corpo -> gravação. Na reserva de emergência o alvo gravado é um RETRATO do cálculo de
 * agora (ou 0 sem histórico); a leitura recalcula sempre, então o gravado nunca é exibido.
 */
export async function toGoalInput(
  body: GoalBody,
  householdId: string,
  today: string,
): Promise<GoalInput> {
  let targetCents = body.targetCents ?? cents(0);
  if (body.isEmergencyFund) {
    const loaded = await loadGoalsResponse(householdId, today);
    targetCents = loaded.emergency.targetCents ?? cents(0);
  }
  return {
    name: body.name,
    targetCents,
    targetDate: body.targetDate,
    currentCents: body.currentCents,
    accountId: body.accountId,
    priority: body.priority,
    status: body.status,
    isEmergencyFund: body.isEmergencyFund,
  };
}
