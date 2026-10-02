import { todayInSaoPaulo } from '@/app/_lib/today';
import { CartoesScreen } from '@/components/cards/cartoes-screen';
import { requireSession } from '@/lib/auth/session';
import { toCompetence } from '@/lib/date';
import { listCommitmentTransactions } from '@/lib/db/queries/dashboard';
import { getSettings } from '@/lib/db/queries/settings';

export const dynamic = 'force-dynamic';

/**
 * `/cartoes`: cadastro de contas e cartões e faturas por mês (T-109), e o
 * comprometimento futuro com uso de limite (T-113), na janela de
 * `commitment_months`.
 *
 * As linhas do comprometimento vêm do servidor, por `listCommitmentTransactions`:
 * o MESMO recorte do painel (por competência, sem previsão de despesa fixa). Antes
 * esta tela montava o recorte no cliente a partir de `/api/transactions`, filtrado
 * pela data da compra, e por isso podia discordar do painel.
 */
export default async function CartoesPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  // A janela é a MESMA do painel: `household_settings.commitment_months`, editável
  // em /config (SPEC §5.8: nunca um número fixo na tela).
  const { commitmentMonths } = await getSettings(householdId);
  const commitmentTransactions = await listCommitmentTransactions(
    householdId,
    toCompetence(today),
    commitmentMonths,
  );
  return (
    <CartoesScreen
      today={today}
      commitmentMonths={commitmentMonths}
      commitmentTransactions={commitmentTransactions}
    />
  );
}
