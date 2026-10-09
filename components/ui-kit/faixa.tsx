import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type FaixaProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** `danger` só para erro e divergência (vermelho de carimbo); `attention` para o que pede conferência. */
  tone?: 'info' | 'ok' | 'attention' | 'danger';
  title?: ReactNode;
};

const ICON = { info: Info, ok: CheckCircle2, attention: AlertTriangle, danger: AlertCircle } as const;

const TONE: Record<NonNullable<FaixaProps['tone']>, string> = {
  info: 'border-border bg-secondary',
  ok: 'border-success/60 bg-success-soft',
  attention: 'border-warning/60 bg-warning-soft',
  danger: 'border-destructive/60 bg-destructive-soft',
};

const ICON_TONE: Record<NonNullable<FaixaProps['tone']>, string> = {
  info: 'text-muted-foreground',
  ok: 'text-success',
  attention: 'text-warning',
  danger: 'text-destructive',
};

/**
 * Faixa de aviso: régua de 1px na cor do tom, fundo suave e ícone. O TEXTO fica na tinta
 * (contraste pleno); a cor só reforça. Use `role="alert"` para erro e `role="status"` para resultado.
 */
export function Faixa({ tone = 'info', title, className, children, ...props }: FaixaProps) {
  const Icon = ICON[tone];
  return (
    <div
      className={cn('flex gap-2 border p-3 text-sm text-foreground', TONE[tone], className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_TONE[tone])} aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
