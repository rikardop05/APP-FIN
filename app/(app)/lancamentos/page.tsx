import { todayInSaoPaulo } from '@/app/_lib/today';
import { LancamentosScreen } from '@/components/transactions/lancamentos-screen';
import { initialView } from '@/components/transactions/month-view';

export const dynamic = 'force-dynamic';

/**
 * `/lancamentos`. A URL decide o que abre (`initialView`): `?mes=2026-11` um mês, `?mes=todos` todos, sem
 * `mes` o mês corrente; `?semCategoria=1` (deep link do Painel) abre em todos os meses já filtrado. Lido no
 * servidor para a primeira consulta da tela já ser a certa.
 */
export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = todayInSaoPaulo();
  return <LancamentosScreen today={today} initial={initialView(await searchParams, today)} />;
}
