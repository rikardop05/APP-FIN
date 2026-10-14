import { cn } from '@/lib/utils';

type SkeletonBarrasProps = {
  /** Quantas barras desenhar (as larguras alternam: cheia, 2/3, 1/2). */
  count?: number;
  className?: string;
};

const WIDTHS = ['w-full', 'w-2/3', 'w-1/2'] as const;

/**
 * Esqueleto VISUAL de barras: para blocos que carregam FORMULÁRIO (Config, origens do Importar e
 * similares), onde o esqueleto de canhotos prometeria uma lista que não vem. Mesmo mundo: tokens
 * (`bg-secondary`, régua), sem raio e sem animação para quem pede menos movimento. Puro desenho:
 * quem anuncia e decide é o `LoadingBlock`, que o envolve.
 */
export function SkeletonBarras({ count = 3, className }: SkeletonBarrasProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: count }, (_, bar) => (
        <div key={bar} className={cn('h-3 bg-secondary motion-safe:animate-pulse', WIDTHS[bar % WIDTHS.length])} />
      ))}
    </div>
  );
}
