import type { ReactNode } from 'react';

type HelpNoteProps = {
  /** Pergunta da chamada; o padrão é a discreta "O que é isto?". */
  question?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Ajuda discreta do mundo (impeccable clarify): disclosure "O que é isto?" que explica em uma
 * frase o vocabulário que o app cria — Sobra, Comprometido, Ainda presos, Placar — no lugar
 * onde ele aparece, fora do caminho de quem já sabe. O texto fica na tinta, no tamanho do corpo.
 */
export function HelpNote({ question = 'O que é isto?', children, className }: HelpNoteProps) {
  return (
    <details className={className}>
      <summary className="sem-marcador inline-flex min-h-11 cursor-pointer list-none items-center text-xs text-muted-foreground hover:text-foreground sm:min-h-0">
        {question}
      </summary>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">{children}</p>
    </details>
  );
}
