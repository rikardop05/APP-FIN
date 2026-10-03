import { todayInSaoPaulo } from '@/app/_lib/today';
import { LancamentosScreen } from '@/components/transactions/lancamentos-screen';

export const dynamic = 'force-dynamic';

export default function LancamentosPage() {
  return <LancamentosScreen today={todayInSaoPaulo()} />;
}
