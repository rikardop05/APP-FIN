import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { householdSettings } from '@/lib/db/schema';
import { basisPoints, type BasisPoints } from '@/lib/money';

/**
 * Queries de premissas globais — T-114.
 *
 * `household_settings` e **1:1 com `households`**: `household_id` e a propria
 * chave, uma linha por familia, criada pelo seed. Nao ha create nem delete —
 * so leitura e atualizacao. Se a linha nao existir, e bug do seed: a query
 * **lanca**, nao cria em silencio.
 *
 * `budget_warn_bp` e **basis points**, nao percentual (CONVENTIONS §3): 8000 bp
 * = 80,00 %. A conversao para o percentual exibido acontece na borda da tela;
 * aqui o valor e `BasisPoints`.
 */

export type HouseholdSettings = {
  /** Meses de despesa essencial que a reserva cobre. */
  emergencyFundMonths: number;
  /** Semaforo amarelo do orcamento, em basis points. 8000 bp = 80,00 %. */
  budgetWarnBp: BasisPoints;
  /** Horizonte da projecao de fluxo de caixa, em meses. */
  projectionMonths: number;
  /** Horizonte do comprometimento futuro, em meses. */
  commitmentMonths: number;
};

export type SettingsPatch = HouseholdSettings;

/** A linha 1:1 de settings nao existe para este household (bug do seed). */
export class SettingsMissingError extends Error {
  constructor() {
    super('Configurações da família não encontradas. Rode o seed.');
    this.name = 'SettingsMissingError';
  }
}

export async function getSettings(householdId: string): Promise<HouseholdSettings> {
  const [row] = await db
    .select({
      emergencyFundMonths: householdSettings.emergencyFundMonths,
      budgetWarnBp: householdSettings.budgetWarnBp,
      projectionMonths: householdSettings.projectionMonths,
      commitmentMonths: householdSettings.commitmentMonths,
    })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId))
    .limit(1);

  if (!row) throw new SettingsMissingError();

  return {
    emergencyFundMonths: row.emergencyFundMonths,
    budgetWarnBp: basisPoints(row.budgetWarnBp),
    projectionMonths: row.projectionMonths,
    commitmentMonths: row.commitmentMonths,
  };
}

export async function updateSettings(
  householdId: string,
  patch: SettingsPatch,
): Promise<void> {
  const updated = await db
    .update(householdSettings)
    .set(patch)
    .where(eq(householdSettings.householdId, householdId))
    .returning({ householdId: householdSettings.householdId });

  // Update que nao afeta linha nenhuma seria um PATCH silencioso num household
  // sem settings: melhor falhar alto que gravar nada e devolver 200.
  if (updated.length === 0) throw new SettingsMissingError();
}
