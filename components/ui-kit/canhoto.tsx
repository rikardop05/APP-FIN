import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Picote } from './picote';
import { Selo } from './selo';
import type { SeloTone } from './carne';

type CanhotoProps = {
  /** `li` dentro de lista, `article`/`div` fora dela. */
  as?: 'li' | 'div' | 'article';
  id?: string;
  /** Nome da região (article): "Linha 5, PADARIA X". */
  ariaLabel?: string;
  /** Coluna do canhoto (esquerda): em geral `<Parcela />`, ou a data. */
  stub?: ReactNode;
  /** Estados em selo com letra (um ou mais). */
  marcas?: Array<{ label: string; tone?: SeloTone; letter?: string }>;
  /** Canhoto ainda PRESO (parcela futura): atenuado e com borda tracejada. */
  preso?: boolean;
  /** Valor, alinhado à direita (use `<Money />`). */
  valor?: ReactNode;
  /** Régua na cor do tom: linha que pede atenção (o selo diz o porquê). */
  destaque?: 'attention' | 'danger';
  /** Faixa abaixo do canhoto, na largura toda (ex.: o editor da linha), separada por picote. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Canhoto: a linha de um lançamento ou parcela. Grade [canhoto | picote | corpo | valor]; no celular
 * o valor desce para baixo do corpo e a linha mantém 44px ou mais de altura. O canhoto (`stub`) e o
 * picote levam `data-canhoto-stub`, o gancho da animação de "destacar" ao confirmar o lote.
 */
export function Canhoto({
  as: Tag = 'div',
  id,
  ariaLabel,
  stub,
  marcas,
  preso = false,
  valor,
  destaque,
  footer,
  children,
  className,
}: CanhotoProps) {
  return (
    <Tag
      id={id}
      aria-label={ariaLabel}
      data-canhoto=""
      className={cn(
        'flex flex-col border bg-card',
        preso ? 'border-dashed border-input text-muted-foreground' : 'border-border',
        destaque === 'attention' && 'border-warning',
        destaque === 'danger' && 'border-destructive',
        className,
      )}
    >
      <div className="grid min-h-11 grid-cols-[4.25rem_auto_minmax(0,1fr)] items-stretch sm:grid-cols-[4.25rem_auto_minmax(0,1fr)_auto]">
        <div data-canhoto-stub="" className="num flex items-center justify-center px-2 py-2 text-sm">
          {stub}
        </div>
        <Picote orientation="vertical" />
        <div className="flex min-w-0 flex-col justify-center gap-1 px-3 py-2">
          {children}
          {marcas && marcas.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {marcas.map((marca) => (
                <Selo key={marca.label} tone={marca.tone} label={marca.label} letter={marca.letter} />
              ))}
            </div>
          ) : null}
        </div>
        {valor !== undefined ? (
          <div className="num col-start-3 px-3 pb-2 text-right text-base sm:col-start-auto sm:flex sm:items-center sm:pb-0">
            {valor}
          </div>
        ) : null}
      </div>
      {footer ? (
        <>
          <Picote />
          <div className="p-3 sm:p-4">{footer}</div>
        </>
      ) : null}
    </Tag>
  );
}
