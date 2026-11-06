/** Ponto da cor da categoria; nada se nao ha cor. Decorativo (o nome ja esta ao lado). */
export function ColorDot({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: color }}
    />
  );
}
