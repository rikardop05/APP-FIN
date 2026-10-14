import { cn } from '@/lib/utils';

type SkeletonCanhotosProps = {
  /** Quantos canhotos tracejados desenhar (o vocabulário de canhotos presos). */
  count?: number;
  className?: string;
};

/**
 * Esqueleto VISUAL de canhotos: o mesmo vocabulário de canhotos presos do
 * `app/(app)/loading.tsx`. Puro desenho, sem texto e sem papel de acessibilidade:
 * quem anuncia e decide é o `LoadingBlock`, que o envolve.
 */
export function SkeletonCanhotos({ count = 4, className }: SkeletonCanhotosProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
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
  );
}
