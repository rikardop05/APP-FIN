import { describe, expect, it } from 'vitest';

import { CONFIG_SECTIONS, subcategoriesText } from './labels';

describe('rótulos da Configuração', () => {
  it('subcategoria no plural certo', () => {
    expect(subcategoriesText(1)).toBe('1 subcategoria');
    expect(subcategoriesText(4)).toBe('4 subcategorias');
    expect(subcategoriesText(4)).not.toContain('(s)');
  });
  it('as cinco seções têm âncora única', () => {
    expect(CONFIG_SECTIONS.map((section) => section.id)).toEqual(['categorias', 'regras', 'membros', 'premissas', 'backup']);
    expect(new Set(CONFIG_SECTIONS.map((section) => section.id)).size).toBe(CONFIG_SECTIONS.length);
  });
});
