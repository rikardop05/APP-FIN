'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Guilhoche } from './guilhoche';
import type { PlacarTone } from './carne';

export type PlacarItem = {
  label: string;
  /** Normalmente `<Money />`. */
  value: ReactNode;
  /** Use `placarTone(diferencaEmCentavos)` na diferença; os demais ficam neutros. */
  tone?: PlacarTone;
  /** No celular com `collapsible`, é o item que fica à vista com o placar fechado (em geral a Diferença). */
  primary?: boolean;
};

type PlacarProps = {
  /** Título do bloco de identidade (guilhochê), ex.: "Lote". */
  title?: string;
  items: PlacarItem[];
  /** Ação principal à direita (ex.: botão Confirmar). Função: recebe se o placar está expandido (celular). */
  action?: ReactNode | ((expanded: boolean) => ReactNode);
  /** `sticky`: rodapé fixo à tela (acima da barra inferior no celular). `static`: bloco comum. */
  position?: 'sticky' | 'static';
  /**
   * Celular: o placar fecha numa linha só (o item `primary` mais a ação) e abre no toque, mostrando todos
   * os totais. No desktop (a partir de `sm`) é sempre aberto.
   */
  collapsible?: boolean;
  className?: string;
};

/** Cor do valor pelo tom: confere = verde, diverge = vermelho de carimbo, neutro = tinta. */
const TONE_TEXT: Record<PlacarTone, string> = {
  ok: 'text-success',
  danger: 'text-destructive',
  neutral: 'text-foreground',
};

/**
 * Placar: rodapé de totais (Total da fatura, Incluído, Diferença). O bloco de identidade leva o
 * guilhochê; os NÚMEROS ficam em fundo sólido (`bg-card`), nunca sobre o desenho. No celular, com
 * `collapsible`, ocupa uma linha e expande no toque (aria-expanded).
 */
export function Placar({ title, items, action, position = 'static', collapsible = false, className }: PlacarProps) {
  const [expanded, setExpanded] = useState(false);
  const hideOthers = collapsible && !expanded;
  const oneLine = hideOthers;
  return (
    <section
      aria-label={title ?? 'Totais'}
      className={cn(
        'flex border-t-2 border-foreground bg-card sm:flex-row',
        oneLine ? 'flex-row' : 'flex-col',
        position === 'sticky' && 'sticky bottom-[var(--bottom-nav-h)] z-20 md:bottom-0',
        className,
      )}
    >
      {title ? (
        <Guilhoche className="hidden items-center px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground sm:flex sm:w-28">
          <span className="bg-card px-1.5 py-0.5">{title}</span>
        </Guilhoche>
      ) : null}
      <div className="flex min-w-0 flex-1 items-stretch">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Ocultar totais' : 'Ver todos os totais'}
            onClick={() => setExpanded((current) => !current)}
            className="flex min-h-11 w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:hidden"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
          </button>
        ) : null}
        <dl
          className={cn(
            'grid min-w-0 flex-1 auto-cols-fr grid-flow-col divide-x divide-border',
            hideOthers && 'max-sm:[&>div:not([data-primary])]:hidden',
          )}
        >
          {items.map((item) => (
            <div
              key={item.label}
              data-primary={item.primary ? '' : undefined}
              className="flex min-w-0 flex-col justify-center px-3 py-1.5 sm:py-2"
            >
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className={cn('num text-base font-semibold sm:text-lg', TONE_TEXT[item.tone ?? 'neutral'])}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {action ? (
        <div
          className={cn(
            'flex items-center justify-end border-border p-2 sm:w-auto sm:border-l sm:border-t-0',
            oneLine ? 'border-l' : 'w-full border-t',
          )}
        >
          {typeof action === 'function' ? action(expanded) : action}
        </div>
      ) : null}
    </section>
  );
}
