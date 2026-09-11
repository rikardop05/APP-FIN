import { ListChecks } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-112 (tabela filtrável, edição inline, categorização em lote).
 */
export default function LancamentosPage() {
  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Receitas e despesas da família, filtráveis por período, categoria, cartão ou conta, responsável e texto."
      />
      <EmptyState
        icon={ListChecks}
        title="Nenhum lançamento ainda"
        description="Os lançamentos aparecem aqui depois da primeira importação de fatura ou extrato, ou de um lançamento manual."
        action={{ label: 'Importar fatura ou extrato', href: '/importar' }}
      />
    </>
  );
}
