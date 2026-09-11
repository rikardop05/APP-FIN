import { TrendingUp } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-303 (planejador de renda passiva: cenários, curvas,
 * aporte necessário por prazo).
 */
export default function InvestimentosPage() {
  return (
    <>
      <PageHeader
        title="Investimentos"
        description="Planejador de renda passiva: cenários conservador, médio e otimista, curvas de acumulação e aporte necessário."
      />
      <EmptyState
        icon={TrendingUp}
        title="Nenhum plano criado"
        description="Informe a renda passiva desejada, o patrimônio atual e o aporte mensal para ver os cenários."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
