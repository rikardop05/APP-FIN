import { cn } from '@/lib/utils';

type PicoteProps = {
  /** `horizontal` separa blocos empilhados; `vertical` separa o canhoto do corpo. */
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

/** Picote: o tracejado de 1px que separa canhotos. Decorativo (o conteúdo já tem a sua estrutura). */
export function Picote({ orientation = 'horizontal', className }: PicoteProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(orientation === 'vertical' ? 'picote-v' : 'picote', className)}
    />
  );
}
