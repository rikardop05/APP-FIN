import { GoalsScreen } from '@/components/goals/goals-screen';

export const dynamic = 'force-dynamic';

/**
 * Metas e reserva de emergência (T-305). A página só entrega a tela, que lê `/api/goals`;
 * progresso, aporte mensal necessário e alvo da reserva vêm do motor (`lib/finance/goals`),
 * nunca daqui.
 */
export default function MetasPage() {
  return <GoalsScreen />;
}
