import { Settings } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-114 (categorias, regras, membros e premissas globais).
 */
export default function ConfigPage() {
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Categorias, regras de categorização, contas, membros e premissas globais."
      />
      <EmptyState
        icon={Settings}
        title="Nada configurado ainda"
        description="Categorias e regras aparecem aqui para edição depois do seed inicial."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
