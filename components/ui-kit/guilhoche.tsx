import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type GuilhocheProps = HTMLAttributes<HTMLDivElement> & {
  /** `paper`: traço verde sobre o papel. `ink`: traço claro sobre a tinta (lombada). */
  tone?: 'paper' | 'ink';
};

/**
 * Fundo de segurança (guilhochê). SÓ para áreas de IDENTIDADE: capa do lote, bloco do placar, marca
 * da lombada. Nunca atrás de números nem de texto corrido: quem põe valor aqui coloca um fundo sólido
 * (`bg-card`) por cima.
 */
export function Guilhoche({ tone = 'paper', className, ...props }: GuilhocheProps) {
  return <div className={cn(tone === 'ink' ? 'guilhoche-ink' : 'guilhoche', className)} {...props} />;
}
