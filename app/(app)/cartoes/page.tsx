import { CreditCard } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-109 (cadastro de contas e cartões, faturas por mês) e
 * pelo T-113 (comprometimento futuro em 24 meses, uso de limite).
 */
export default function CartoesPage() {
  return (
    <>
      <PageHeader
        title="Cartões"
        description="Cartões e contas da família, faturas por mês, comprometimento futuro e parcelas em andamento."
      />
      <EmptyState
        icon={CreditCard}
        title="Nenhum cartão cadastrado"
        description="Cadastre um cartão ou conta para começar a ver faturas e comprometimento futuro."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
