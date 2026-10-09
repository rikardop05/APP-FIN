/**
 * Assinatura do mundo: ao confirmar o lote, o picote se abre e os canhotos assentam (CSS `.destacando`
 * em app/globals.css). Este é o tempo que a tela espera antes de trocar de estado.
 */
export const DESTACAR_MS = 800;

/** Espera a animação terminar; com `prefers-reduced-motion` não espera nada. */
export function esperarDestacar(): Promise<void> {
  const reduce =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, DESTACAR_MS);
  });
}
