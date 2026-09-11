import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

type EmptyStateAction = {
  label: string;
  href: string;
};

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Obrigatória: estado vazio nunca aparece sem uma saída (aceite do T-005: "estado vazio com ação primária, nunca tabela vazia sem explicação"). */
  action: EmptyStateAction;
  className?: string;
};

/** Substitui tabela/lista vazia sem explicação: título, contexto e uma ação primária. */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Link
        href={action.href}
        className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {action.label}
      </Link>
    </div>
  );
}
