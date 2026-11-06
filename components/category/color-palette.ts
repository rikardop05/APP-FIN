/** Paleta curada de cores de categoria. Fonte unica: formulario, lista e testes. */
export type PaletteColor = { name: string; hex: string };

export const CATEGORY_COLORS: readonly PaletteColor[] = [
  { name: 'Vermelho', hex: '#e5484d' },
  { name: 'Laranja', hex: '#d2601a' },
  { name: 'Mostarda', hex: '#b98300' },
  { name: 'Verde', hex: '#2f9e5b' },
  { name: 'Verde-água', hex: '#1f9d8f' },
  { name: 'Ciano', hex: '#1b8fb5' },
  { name: 'Azul', hex: '#3b7de0' },
  { name: 'Índigo', hex: '#6f6fe3' },
  { name: 'Violeta', hex: '#a35bd6' },
  { name: 'Rosa', hex: '#d6409f' },
  { name: 'Marrom', hex: '#9a6b4a' },
  { name: 'Cinza', hex: '#7d8a8c' },
];

/** Fundos do app (globals.css) usados na checagem de contraste. */
export const APP_BACKGROUNDS = { dark: '#0b1313', light: '#f1f5f3' } as const;

export function normalizeHex(value: string): string {
  return value.trim().toLowerCase();
}

export function findPaletteColor(value: string): PaletteColor | undefined {
  const hex = normalizeHex(value);
  return CATEGORY_COLORS.find((color) => color.hex === hex);
}

export type SwatchOption = { value: string; label: string; isCurrent: boolean };

/**
 * Opcoes do grupo: a paleta e, se a cor atual estiver fora dela, uma amostra
 * extra "Cor atual" — assim salvar sem mexer nao perde o valor. ("Sem cor" e
 * tratada a parte pelo seletor, com valor '').
 */
export function buildSwatchOptions(current: string): SwatchOption[] {
  const options: SwatchOption[] = CATEGORY_COLORS.map((c) => ({
    value: c.hex,
    label: c.name,
    isCurrent: false,
  }));
  const hex = normalizeHex(current);
  if (hex !== '' && findPaletteColor(hex) === undefined) {
    options.push({ value: hex, label: `Cor atual (${hex})`, isCurrent: true });
  }
  return options;
}

/** Proximo valor ao navegar por setas no radiogroup (circular). */
export function nextColorValue(values: readonly string[], current: string, step: 1 | -1): string {
  const index = values.indexOf(current);
  const base = index === -1 ? 0 : index;
  return values[(base + step + values.length) % values.length] ?? '';
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
