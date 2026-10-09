import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost';
  size?: 'sm' | 'md';
};

/**
 * Botão base. Alvo de toque de 44px no celular (`h-11`), compacto a partir de `sm` (36px, ou 32px
 * no tamanho `sm`). Cantos retos e régua de 1px: o mundo do carnê não tem pílulas.
 */
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        size === 'sm'
          ? 'h-11 min-w-11 px-3 text-xs sm:h-8 sm:min-w-0'
          : 'h-11 px-4 text-sm sm:h-9',
        variant === 'primary' &&
          'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'secondary' &&
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        variant === 'outline' &&
          'border-input bg-card text-foreground hover:bg-secondary/60',
        variant === 'destructive' &&
          'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
        variant === 'ghost' &&
          'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}
