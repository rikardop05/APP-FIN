import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { SELO_TONE_CLASS, seloLetter, type SeloTone } from './carne';

type SeloProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  tone?: SeloTone;
  /** Texto do estado, por extenso (ex.: "Conferido"). A letra do quadradinho sai da primeira. */
  label: string;
  /** Letra explícita, quando a inicial do texto não for a boa. */
  letter?: string;
};

/**
 * Selo de estado: quadradinho com a LETRA mais o texto. A cor reforça, nunca é a única pista
 * (daltonismo, impressão em preto e branco). Só o tom `danger` usa o vermelho de carimbo.
 */
export function Selo({ tone = 'neutral', label, letter, className, ...props }: SeloProps) {
  const classes = SELO_TONE_CLASS[tone];
  return (
    <span
      className={cn(
        'inline-flex items-stretch border text-xs font-medium leading-4',
        classes.frame,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('flex w-5 items-center justify-center font-semibold', classes.box)}
      >
        {seloLetter(letter ?? label)}
      </span>
      <span className="px-1.5 py-0.5">{label}</span>
    </span>
  );
}
