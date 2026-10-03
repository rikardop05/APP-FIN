import { todayInSaoPaulo } from '@/app/_lib/today';
import { loadInvestmentResponse } from '@/app/api/investment/load';
import { InvestmentScreen } from '@/components/investment/investment-screen';
import { requireSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Planejador de renda passiva (T-303). Lê o plano no servidor (a mesma função da API) e
 * entrega à tela; a tela só desenha o que o motor devolveu (`lib/finance/investment`),
 * nunca calcula.
 */
export default async function InvestimentosPage() {
  const { householdId } = await requireSession();
  const initial = await loadInvestmentResponse(householdId, todayInSaoPaulo());
  return <InvestmentScreen initial={initial} />;
}
