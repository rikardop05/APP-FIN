import { FileUp } from 'lucide-react';

import { EmptyState } from '@/components/ui-kit';

/**
 * Estado vazio do histórico de importações (T-111, FASE 3).
 * "Estado vazio com ação primária, nunca tabela vazia sem explicação" —
 * a ação aqui é uma instrução textual (não um link, porque o upload vive
 * acima do histórico na mesma página); a EmptyState aceita onClick.
 */
export function ImportHistoryEmptyState() {
  return (
    <EmptyState
      title="Nenhuma importação registrada"
      description="Quando você confirmar um lote, ele aparece aqui. Cada item pode ser desfeito com um clique."
      icon={FileUp}
      action={{
        label: 'Use o card acima para enviar um PDF',
        onClick: () => {
          const input = document.querySelector<HTMLInputElement>('input[type="file"]');
          input?.focus();
        },
      }}
    />
  );
}
