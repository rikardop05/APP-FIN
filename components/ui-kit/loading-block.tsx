'use client';

import { useEffect, useState } from 'react';

import { Button } from './button';
import { SkeletonBarras } from './skeleton-barras';
import { SkeletonCanhotos } from './skeleton';
import { cn } from '@/lib/utils';

type LoadingBlockProps = {
  /** Linha VISÍVEL curta enquanto carrega (ex.: "Carregando metas…"). */
  label: string;
  /**
   * Anúncio do FIM da carga para leitor de tela. A região `aria-live` fica montada: a troca de
   * texto (de "Carregando…" para o fim) anuncia. `null` = a carga terminou em falha e a TELA
   * anuncia no alerta dela (o bloco fica mudo, nunca finge que carregou).
   */
  endText: string | null;
  loading: boolean;
  /**
   * Carga falhou com a tela ainda sem dado: linha de erro à vista, com 'Tentar de novo' se houver
   * `retry`. Sem isso o erro é tela que grita uma vez e trava, sem caminho de saída.
   */
  failed?: boolean;
  failedText?: string;
  retry?: () => void;
  variant?: 'canhotos' | 'barras';
  count?: number;
  /** Milissegundos para acusar demora (o texto muda e aparece o 'Tentar de novo'). */
  slowAfterMs?: number;
  className?: string;
};

const SLOW_TEXT = 'Ainda carregando…';
const DEFAULT_FAILED_TEXT = 'Não deu para carregar.';

/**
 * Bloco de carregamento do cliente: estende o esqueleto por bloco do `app/(app)/loading.tsx`
 * com linha visível curta, acusação de demora com 'Tentar de novo' (a carga nunca fica presa em
 * silêncio) e anúncio do fim ao leitor de tela (a região vive, o texto troca).
 */
export function LoadingBlock({
  label,
  endText,
  loading,
  failed = false,
  failedText = DEFAULT_FAILED_TEXT,
  retry,
  variant = 'canhotos',
  count = 4,
  slowAfterMs = 8_000,
  className,
}: LoadingBlockProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [loading, slowAfterMs]);

  const canRetry = retry !== undefined && ((loading && slow) || (!loading && failed));
  const message = loading
    ? slow
      ? SLOW_TEXT
      : label
    : failed
      ? failedText
      : (endText ?? '');

  return (
    <div className={cn('flex flex-col items-start gap-2', className)} aria-busy={loading || undefined}>
      <p
        role="status"
        className={cn(
          'text-xs',
          loading && (slow ? 'text-warning' : 'text-muted-foreground'),
          !loading && failed && 'text-destructive',
          !loading && !failed && 'sr-only',
        )}
      >
        {message}
      </p>
      {canRetry && retry !== undefined ? (
        <Button variant="outline" size="sm" onClick={retry}>
          Tentar de novo
        </Button>
      ) : null}
      {loading ? (
        variant === 'barras' ? (
          <SkeletonBarras count={count} />
        ) : (
          <SkeletonCanhotos count={count} />
        )
      ) : null}
    </div>
  );
}
