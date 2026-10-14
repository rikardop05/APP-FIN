import type { ReactNode } from 'react';

type ShortcutLegendProps = {
  /** Os atalhos desta tela: tecla(s) + o que fazem, por extenso. */
  atalhos: { keys: ReactNode; label: string }[];
};

/**
 * "Atalhos" discreto (impeccable clarify): disclosure em que teclado roda o que o J/K fazem —
 * texto por extenso, não só os gestos. Os teclas seguem o estilo `<kbd>` da barra de seleção e
 * FICAM no conteúdo acessível (o leitor precisa ouvir a tecla, não só o efeito).
 */
export function ShortcutLegend({ atalhos }: ShortcutLegendProps) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="sem-marcador inline-flex min-h-11 cursor-pointer list-none items-center hover:text-foreground sm:min-h-0">
        Atalhos
      </summary>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {atalhos.map((atalho) => (
          <li key={atalho.label} className="inline-flex items-center gap-1.5">
            <span className="inline-flex gap-1">{atalho.keys}</span>
            <span className="text-foreground">{atalho.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
