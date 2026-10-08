/**
 * Estado de carregamento de toda rota de `app/(app)` (impeccable harden): aparece enquanto o servidor
 * monta a página, DENTRO do layout (a navegação continua). Esqueleto simples: um título e blocos.
 * `role="status"` + `aria-busy` + texto para leitor de tela; a animação respeita `prefers-reduced-motion`.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando…</span>
      <div aria-hidden="true" className="h-8 w-48 rounded-md bg-secondary motion-safe:animate-pulse" />
      <div aria-hidden="true" className="h-4 w-full max-w-md rounded-md bg-secondary motion-safe:animate-pulse" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-lg bg-secondary motion-safe:animate-pulse" />
        <div className="h-28 rounded-lg bg-secondary motion-safe:animate-pulse" />
      </div>
      <div aria-hidden="true" className="h-48 rounded-lg bg-secondary motion-safe:animate-pulse" />
    </div>
  );
}
