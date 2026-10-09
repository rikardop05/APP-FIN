import { cn } from '@/lib/utils';
import { parcelaLabel } from './carne';

type ParcelaProps = {
  atual: number;
  total: number;
  className?: string;
};

/** Numeração de canhoto (03/10) em numerais condensados tabulares. */
export function Parcela({ atual, total, className }: ParcelaProps) {
  return (
    <span className={cn('num', className)} aria-label={`Parcela ${atual} de ${total}`}>
      {parcelaLabel(atual, total)}
    </span>
  );
}
