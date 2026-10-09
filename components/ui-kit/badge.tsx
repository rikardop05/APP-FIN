import type { HTMLAttributes } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: 'neutral' | 'success' | 'warning' | 'danger';
};

const ICON = { success: Check, warning: AlertTriangle, danger: X } as const;

/**
 * Etiqueta curta de estado. Quadrada, com ícone nos estados (sucesso, atenção, perigo): a cor
 * nunca é a única pista. Para o estado com letra e texto (conciliação), use `Selo`.
 */
export function Badge({ className, variant = 'neutral', children, ...props }: BadgeProps) {
  const Icon = variant === 'neutral' ? null : ICON[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-medium',
        variant === 'neutral' && 'border-border bg-secondary text-secondary-foreground',
        variant === 'success' && 'border-success/50 bg-success-soft text-success',
        variant === 'warning' && 'border-warning/50 bg-warning-soft text-warning',
        variant === 'danger' && 'border-destructive/50 bg-destructive-soft text-destructive',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
