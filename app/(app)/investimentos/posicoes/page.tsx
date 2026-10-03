import { todayInSaoPaulo } from '@/app/_lib/today';
import { loadPositionsResponse } from '@/app/api/investment/positions/load';
import { PositionsScreen } from '@/components/investment/positions/positions-screen';
import { requireSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Posição real de investimentos (T-404): aporte efetivo × planejado e o total investido
 * comparado à curva de cada cenário. Lê no servidor (a mesma função da API) e entrega à tela;
 * a tela só desenha o que o motor devolveu (`lib/finance/positions`), nunca calcula.
 */
export default async function PosicoesPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  const initial = await loadPositionsResponse(householdId, today);
  return <PositionsScreen initial={initial} today={today} />;
}
