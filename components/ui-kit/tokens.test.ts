import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`bloco não encontrado: ${marker}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('bloco sem fechamento');
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[match[1] ?? ''] = (match[2] ?? '').trim();
  return out;
}

// ESCURO é o padrão (`:root`); o claro só por escolha da pessoa (`data-theme="light"`).
const dark = tokens(blockAfter(':root {'));
const light = tokens(blockAfter(':root[data-theme="light"] {'));

function hsl(triple: string): [number, number, number] {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%/.exec(triple);
  if (!m) throw new Error(`não é um triplo HSL: ${triple}`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(triple: string): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hsl(triple);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'destructive-soft'],
  ['success', 'success-soft'],
  ['success-foreground', 'success'],
  ['warning', 'warning-soft'],
  ['warning-foreground', 'warning'],
  ['primary', 'background'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-muted', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
];

describe('tokens do carnê (globals.css)', () => {
  it('o modo escuro define exatamente os mesmos tokens de cor do claro', () => {
    const colorKeys = (t: Record<string, string>) =>
      Object.keys(t).filter((k) => !['radius', 'bottom-nav-h'].includes(k)).sort();
    expect(colorKeys(dark)).toEqual(colorKeys(light));
  });

  it.each([
    ['claro', light],
    ['escuro', dark],
  ] as const)('texto tem contraste >= 4,5:1 no modo %s', (_name, theme) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      // Sem token de dark para sidebar-accent no tema claro, o par só vale onde existe.
      const a = theme[fg];
      const b = theme[bg];
      if (!a || !b) continue;
      expect(contrast(a, b), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['claro', light],
    ['escuro', dark],
  ] as const)('a borda de campo tem >= 3:1 sobre o papel no modo %s', (_name, theme) => {
    expect(contrast(theme.input ?? '', theme.background ?? '')).toBeGreaterThanOrEqual(3);
  });

  it('cantos retos e altura da barra inferior em variável', () => {
    expect(dark.radius).toBe('0px');
    expect(dark['bottom-nav-h']).toContain('env(safe-area-inset-bottom)');
  });
});
