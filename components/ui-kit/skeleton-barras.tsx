import { cn } from '@/lib/utils';

type SkeletonBarrasProps = {
  /** Quantas barras desenhar (as larguras alternam: cheia, 2/3, 1/2). */
  count?: number;
  /** Texto por extenso para leitor de tela (ex.: "Carregando configurações…"). */
  srText?: string;
  className?: string;
};

const WIDTHS = ['w-full', 'w-2/3', 'w-1/2'] as const;

/**
 * Esqueleto de barras: para blocos que carregam FORMULÁRIO (Config, origens do Importar e
 * similares), onde o esqueleto de canhotos prometeria uma lista que não vem. Mesmo mundo: tokens
 * (`bg-secondary`, régua), sem raio e sem animação para quem pede menos movimento.
 * `role="status"` + `aria-busy` mantêm o texto acessível (sr-only).
 */
export function SkeletonBarras({ count = 3, srText = 'Carregando…', className }: SkeletonBarrasProps) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-3', className)}>
      <span className="sr-only">{srText}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: count }, (_, bar) => (
          <div key={bar} className={cn('h-3 bg-secondary motion-safe:animate-pulse', WIDTHS[bar % WIDTHS.length])} />
        ))}
      </div>
    </div>
  );
}
