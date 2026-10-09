import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Guilhoche } from './guilhoche';
import type { PlacarTone } from './carne';

export type PlacarItem = {
  label: string;
  /** Normalmente `<Money />`. */
  value: ReactNode;
  /** Use `placarTone(diferencaEmCentavos)` na diferença; os demais ficam neutros. */
  tone?: PlacarTone;
};

type PlacarProps = {
  /** Título do bloco de identidade (guilhochê), ex.: "Lote". */
  title?: string;
  items: PlacarItem[];
  /** Ação principal à direita (ex.: botão Confirmar). */
  action?: ReactNode;
  /** `sticky`: rodapé fixo à tela (acima da barra inferior no celular). `static`: bloco comum. */
  position?: 'sticky' | 'static';
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
 * guilhochê; os NÚMEROS ficam em fundo sólido (`bg-card`), nunca sobre o desenho.
 */
export function Placar({ title, items, action, position = 'static', className }: PlacarProps) {
  return (
    <section
      aria-label={title ?? 'Totais'}
      className={cn(
        'flex flex-col border-t-2 border-foreground bg-card sm:flex-row',
        position === 'sticky' && 'sticky bottom-[var(--bottom-nav-h)] z-20 md:bottom-0',
        className,
      )}
    >
      {title ? (
        <Guilhoche className="flex items-center px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground sm:w-28">
          <span className="bg-card px-1.5 py-0.5">{title}</span>
        </Guilhoche>
      ) : null}
      <dl className="grid flex-1 auto-cols-fr grid-flow-col divide-x divide-border">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col justify-center px-3 py-2">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className={cn('num text-base font-semibold sm:text-lg', TONE_TEXT[item.tone ?? 'neutral'])}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {action ? (
        <div className="flex items-center justify-end border-t border-border p-2 sm:border-l sm:border-t-0">
          {action}
        </div>
      ) : null}
    </section>
  );
}
