import { Upload } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui-kit';

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-111 (upload de PDF com senha, texto colado, tela de
 * confirmação editável linha a linha, histórico de lotes com desfazer).
 */
export default function ImportarPage() {
  return (
    <>
      <PageHeader
        title="Importar"
        description="Envie o PDF da fatura ou cole o texto de um extrato. Nada é gravado antes da sua confirmação."
      />
      <EmptyState
        icon={Upload}
        title="Nenhuma importação ainda"
        description="O envio de PDF e o card de texto colado ainda não estão disponíveis nesta tela."
        action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
      />
    </>
  );
}
