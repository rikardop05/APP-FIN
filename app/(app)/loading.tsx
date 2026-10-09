/**
 * Estado de carregamento de toda rota de `app/(app)`: aparece enquanto o servidor monta a página,
 * DENTRO do layout (a navegação continua). No mundo do carnê, são canhotos ainda presos (tracejados).
 * `role="status"` + `aria-busy` + texto para leitor de tela; a animação respeita `prefers-reduced-motion`.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando…</span>
      <div aria-hidden="true" className="h-8 w-48 bg-secondary motion-safe:animate-pulse" />
      <div aria-hidden="true" className="picote" />
      <div aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="grid h-14 grid-cols-[4.25rem_auto_1fr] border border-dashed border-input bg-card motion-safe:animate-pulse"
          >
            <div className="m-3 bg-secondary" />
            <div className="picote-v" />
            <div className="m-3 bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
