'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui-kit';

/**
 * Fronteira de erro de toda rota de `app/(app)`: quando a página falha ao carregar, a pessoa vê o
 * que houve em português e pode tentar de novo sem recarregar o app. Fica DENTRO do layout, então a
 * navegação continua à mão. A mensagem técnica NÃO vai para a tela (vai para o console, com o
 * `digest` que o servidor associa ao log). Perigo = vermelho de carimbo, na régua.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[rota] erro ao carregar a tela:', error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-3 border border-destructive bg-card p-4 sm:p-6">
      <h1 className="text-lg font-semibold">Não foi possível carregar esta tela</h1>
      <p className="text-sm text-muted-foreground">
        Algo deu errado ao buscar os dados. Nada foi alterado. Tente de novo; se continuar, volte em alguns instantes.
      </p>
      <Button onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
