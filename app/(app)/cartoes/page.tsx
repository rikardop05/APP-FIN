import { todayInSaoPaulo } from '@/app/_lib/today';
import { CartoesScreen } from '@/components/cards/cartoes-screen';
import { CARDS_COMMITMENT_MONTHS } from '@/components/cards/commitment/window';
import { requireSession } from '@/lib/auth/session';
import { toCompetence } from '@/lib/date';
import { listCommitmentTransactions } from '@/lib/db/queries/dashboard';

export const dynamic = 'force-dynamic';

/**
 * `/cartoes`: cadastro de contas e cartões e faturas por mês (T-109), e o
 * comprometimento futuro em 24 meses com uso de limite (T-113).
 *
 * As linhas do comprometimento vêm do servidor, por `listCommitmentTransactions`:
 * o MESMO recorte do painel (por competência, sem previsão de despesa fixa). Antes
 * esta tela montava o recorte no cliente a partir de `/api/transactions`, filtrado
 * pela data da compra, e por isso podia discordar do painel.
 */
export default async function CartoesPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  const commitmentTransactions = await listCommitmentTransactions(
    householdId,
    toCompetence(today),
    CARDS_COMMITMENT_MONTHS,
  );
  return <CartoesScreen today={today} commitmentTransactions={commitmentTransactions} />;
}
