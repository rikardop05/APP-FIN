import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_BACKGROUNDS,
  CATEGORY_COLORS,
  buildSwatchOptions,
  contrastRatio,
  nextColorValue,
} from './color-palette';
import { categoryFormSchema } from '@/app/(app)/config/schemas';
import { categoryCreateSchema } from '@/app/api/categories/schemas';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('paleta de cor da categoria', () => {
  it('tem entre 10 e 12 cores, todas #rrggbb, sem repetir', () => {
    expect(CATEGORY_COLORS.length).toBeGreaterThanOrEqual(10);
    expect(CATEGORY_COLORS.length).toBeLessThanOrEqual(12);
    for (const c of CATEGORY_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(CATEGORY_COLORS.map((c) => c.hex)).size).toBe(CATEGORY_COLORS.length);
  });

  it('cada cor tem contraste >= 3:1 com o fundo escuro e com o claro', () => {
    for (const c of CATEGORY_COLORS) {
      expect(contrastRatio(c.hex, APP_BACKGROUNDS.dark), c.name).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.hex, APP_BACKGROUNDS.light), c.name).toBeGreaterThanOrEqual(3);
    }
  });

  it('toda cor da paleta passa nos schemas do formulario e da API', () => {
    for (const c of CATEGORY_COLORS) {
      expect(categoryFormSchema.safeParse({ name: 'x', nature: '', color: c.hex, sortOrder: '0' }).success).toBe(true);
      expect(categoryCreateSchema.safeParse({ name: 'x', color: c.hex, parentId: null }).success).toBe(true);
    }
  });
});

describe('opcoes e navegacao', () => {
  it('cor dentro da paleta nao cria amostra extra', () => {
    expect(buildSwatchOptions(CATEGORY_COLORS[0]!.hex.toUpperCase())).toHaveLength(CATEGORY_COLORS.length);
    expect(buildSwatchOptions('')).toHaveLength(CATEGORY_COLORS.length);
  });

  it('cor fora da paleta vira amostra extra "Cor atual", preservando o valor', () => {
    const options = buildSwatchOptions('#123ABC');
    const extra = options[options.length - 1]!;
    expect(extra).toEqual({ value: '#123abc', label: 'Cor atual (#123abc)', isCurrent: true });
  });

  it('setas andam em circulo, incluindo "Sem cor"', () => {
    const values = ['', '#a', '#b'];
    expect(nextColorValue(values, '', 1)).toBe('#a');
    expect(nextColorValue(values, '#b', 1)).toBe('');
    expect(nextColorValue(values, '', -1)).toBe('#b');
  });
});

describe('ligacao das telas', () => {
  const form = read('app/(app)/config/category-form.tsx');
  const screen = read('app/(app)/config/config-screen.tsx');
  const picker = read('components/category/color-picker.tsx');

  it('formulario usa o seletor e nao tem campo hex', () => {
    expect(form).toContain('<ColorPicker');
    expect(form).not.toContain('category-color"');
    expect(form).not.toContain('#RRGGBB');
  });

  it('seletor e radiogroup com radios, rotulo e marca visivel', () => {
    expect(picker).toContain('role="radiogroup"');
    expect(picker).toContain('role="radio"');
    expect(picker).toContain('aria-checked');
    expect(picker).toContain('<Check');
    expect(picker).toContain('Sem cor');
  });

  it('a lista de categorias mostra o ponto da cor da raiz', () => {
    expect(screen).toContain('<ColorDot color={root.color}');
  });
});
