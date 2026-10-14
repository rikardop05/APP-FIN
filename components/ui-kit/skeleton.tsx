import { cn } from '@/lib/utils';

type SkeletonCanhotosProps = {
  /** Quantos canhotos tracejados desenhar (o vocabulário de canhotos presos). */
  count?: number;
  /** Texto por extenso para leitor de tela (ex.: "Carregando metas…"). */
  srText?: string;
  className?: string;
};

/**
 * Esqueleto de canhotos: o mesmo vocabulário de canhotos presos do
 * `app/(app)/loading.tsx`, usado POR BLOCO no lugar do texto cinza "Carregando…".
 * `role="status"` + `aria-busy` mantêm o texto acessível (sr-only); a animação
 * respeita `prefers-reduced-motion` e o conteúdo é ignorado por leitor de tela.
 */
export function SkeletonCanhotos({ count = 4, srText = 'Carregando…', className }: SkeletonCanhotosProps) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-2', className)}>
      <span className="sr-only">{srText}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: count }, (_, row) => (
          <div
            key={row}
            className="grid h-14 grid-cols-[4.25rem_auto_1fr] border border-dashed border-input bg-card motion-safe:animate-pulse"
          >
            <div className="m-3 bg-secondary" />
            <div className="picote-v" />
            <div className="m-3 bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
