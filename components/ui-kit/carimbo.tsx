import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CarimboProps = HTMLAttributes<HTMLSpanElement> & {
  /** `ok`: PAGO / CONFERE (verde). `danger`: DIVERGE (vermelho de carimbo). */
  tone: 'ok' | 'danger';
};

/**
 * Carimbo: moldura dupla, caixa alta, levemente torto. Reservado a PAGO, confere e divergência:
 * é o único lugar do mundo onde o vermelho aparece como tinta de carimbo.
 */
export function Carimbo({ tone, className, children, ...props }: CarimboProps) {
  return (
    <span
      className={cn(
        'inline-block -rotate-3 border-2 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest outline outline-1 outline-offset-2',
        tone === 'ok'
          ? 'border-success text-success outline-success'
          : 'border-destructive text-destructive outline-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
