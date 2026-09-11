import { Target } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-305 (metas com progresso e reserva de emergência).
 */
export default function MetasPage() {
  return (
    <>
      <PageHeader
        title="Metas"
        description="Metas com valor-alvo e data-alvo, e reserva de emergência sugerida."
      />
      <EmptyState
        icon={Target}
        title="Nenhuma meta cadastrada"
        description="Crie uma meta para acompanhar o aporte mensal necessário e o progresso."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
