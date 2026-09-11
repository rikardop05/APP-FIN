import { Wallet } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-205 (orçamento por categoria com semáforo). Despesas
 * fixas e receitas ficam em `/orcamento/recorrentes`, do T-204.
 */
export default function OrcamentoPage() {
  return (
    <>
      <PageHeader
        title="Orçamento"
        description="Despesas fixas, receitas e orçamento por categoria, com previsto vs. realizado."
      />
      <EmptyState
        icon={Wallet}
        title="Nenhum orçamento definido"
        description="Cadastre despesas fixas e receitas para acompanhar o orçamento do mês por categoria."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
