import { todayInSaoPaulo } from '@/app/_lib/today';
import { BudgetScreen } from '@/components/budget/budget-screen';

export const dynamic = 'force-dynamic';

/**
 * Orçamento por categoria (T-205). Despesas fixas e receitas ficam em
 * `/orcamento/recorrentes` (T-204). A página só entrega o "hoje" ao componente
 * cliente, que lê `/api/budgets`; semáforo, uso e sugestão vêm do motor
 * (CONTRACTS §10), nunca daqui.
 */
export default function OrcamentoPage() {
  return <BudgetScreen today={todayInSaoPaulo()} />;
}
