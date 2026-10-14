import { ESTADO_LETRA, seloLetter } from './carne';

type LegendEntry = { letter: string; label: string };

type SeloLegendProps = {
  /** Os estados que aparecem NESTA tela, na ordem da lista. */
  estados: readonly string[];
};

/**
 * Legenda dos selos (impeccable clarify): a LETRA do quadradinho nunca fica sozinha — a legenda
 * sempre junta letra e texto por extenso. Disclosure discreto; cabe no rodapé da lista onde os
 * selos aparecem. Estado fora da tabela única (`ESTADO_LETRA`) cai na inicial do rótulo.
 */
export function SeloLegend({ estados }: SeloLegendProps) {
  const entries: LegendEntry[] = estados.map((label) => ({
    letter: ESTADO_LETRA[label] ?? seloLetter(label),
    label,
  }));
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="sem-marcador inline-flex min-h-11 cursor-pointer list-none items-center hover:text-foreground sm:min-h-0">
        O que significam as letras
      </summary>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {entries.map((entry) => (
          <li key={entry.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center border border-foreground/40 bg-foreground font-semibold text-background"
            >
              {entry.letter}
            </span>
            <span className="text-foreground">{entry.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
