import { LineChart } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-207 (projeção de 12 meses e simulador "e se").
 */
export default function FluxoPage() {
  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description='Projeção do saldo para os próximos 12 meses e simulador "e se", sem gravar nada.'
      />
      <EmptyState
        icon={LineChart}
        title="Projeção ainda não disponível"
        description="A projeção depende de despesas recorrentes, receitas e faturas cadastradas."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
