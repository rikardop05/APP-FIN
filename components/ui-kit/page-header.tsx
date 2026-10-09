import type { ReactNode } from 'react';
import { Picote } from './picote';

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

/** Cabeçalho padrão de tela: título, descrição opcional e ações à direita, fechado por um picote. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <Picote />
    </header>
  );
}
