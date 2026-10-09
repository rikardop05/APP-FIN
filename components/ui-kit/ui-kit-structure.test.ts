import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/nav/nav-items';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sourcesIn = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));

describe('estrutura do ui-kit e do shell', () => {
  it('Money não pinta despesa de vermelho (vermelho é carimbo)', () => {
    expect(read('components/ui-kit/money.tsx')).not.toMatch(/text-destructive/);
  });

  it('controles de formulário e botão têm alvo de 44px no celular e compactam a partir de sm', () => {
    for (const file of ['button', 'input', 'select']) {
      expect(read(`components/ui-kit/${file}.tsx`), file).toContain('h-11');
      expect(read(`components/ui-kit/${file}.tsx`), file).toMatch(/sm:h-(8|9)/);
    }
  });

  it('ui-kit e nav não usam rótulos abaixo de 12px nem cantos arredondados', () => {
    for (const { file, text } of [...sourcesIn('components/ui-kit'), ...sourcesIn('components/nav')]) {
      expect(text, file).not.toMatch(/text-\[(9|10|11)px\]/);
      expect(text, file).not.toMatch(/\brounded(-[a-z0-9]+)?\b/);
    }
  });

  it('o guilhochê só aparece em componentes de identidade', () => {
    const allowed = new Set([
      'components/ui-kit/guilhoche.tsx',
      'components/ui-kit/index.ts',
      'components/ui-kit/placar.tsx',
      'components/nav/sidebar-nav.tsx',
    ]);
    for (const { file, text } of [...sourcesIn('components/ui-kit'), ...sourcesIn('components/nav')]) {
      if (/guilhoche|Guilhoche/.test(text)) expect(allowed.has(file), file).toBe(true);
    }
  });

  it('o índice exporta o vocabulário do carnê', () => {
    const index = read('components/ui-kit/index.ts');
    for (const name of ['Picote', 'Guilhoche', 'Selo', 'Carimbo', 'Parcela', 'Canhoto', 'Placar']) {
      expect(index, name).toContain(`export { ${name}`);
    }
  });

  it('o layout raiz carrega as fontes do projeto e as cores da barra do navegador', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain("from 'next/font/local'");
    expect(layout).toContain('--font-ui');
    expect(layout).toContain('--font-numeral');
    expect(layout).toContain('prefers-color-scheme: dark');
  });

  it('o Tailwind segue o sistema no escuro e tem cantos retos', () => {
    const config = read('tailwind.config.ts');
    expect(config).toContain("darkMode: 'media'");
    const radius = /borderRadius: {([^}]*)}/.exec(config)?.[1] ?? '';
    expect(radius).not.toBe('');
    expect(radius).not.toMatch(/: '(?!0px)/);
  });

  it('a barra inferior tem 4 destinos diretos, com Fluxo entre eles', () => {
    const primary = NAV_ITEMS.filter((item) => item.mobile === 'primary');
    expect(primary).toHaveLength(4);
    expect(primary.map((item) => item.href)).toContain('/fluxo');
    expect(NAV_ITEMS).toHaveLength(9);
  });
});

describe('Token, Not Palette', () => {
  const dirs = ['components/import', 'components/cashflow', 'components/goals', 'components/investment', 'app/(app)', 'components/ui-kit', 'components/nav'];
  function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
    });
  }

  it('as telas da onda 2 não usam red/amber/emerald/sky crus', () => {
    for (const file of dirs.flatMap(walk)) {
      expect(read(file), file).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke|divide)-(?:red|amber|emerald|sky)-\d+/);
    }
  });

  it('nenhum token malformado (bg-success-soft0, text-warning5...)', () => {
    for (const file of dirs.flatMap(walk)) {
      expect(read(file), file).not.toMatch(/-(?:success|warning|destructive)(?:-soft)?d/);
    }
  });

  it('o guilhochê lê o token (máscara), sem cor fixa no CSS', () => {
    const css = read('app/globals.css');
    expect(css).not.toMatch(/2E8C7A|5FD0BA/i);
    expect(css).toContain('hsl(var(--primary) / 0.22)');
    expect(css).toContain('mask-image');
  });

  it('sem kicker em caixa-alta espaçada acima de título na capa do lote e no veredito', () => {
    for (const file of ['components/import/batch-cover.tsx', 'components/cashflow/verdict.tsx']) {
      expect(read(file), file).not.toMatch(/uppercase tracking-(?:wide|widest)/);
    }
  });

  it('PAGO é verde: o CSS não diz que o vermelho é para PAGO', () => {
    expect(read('app/globals.css')).not.toMatch(/divergência e PAGO/);
    expect(read('tailwind.config.ts')).not.toMatch(/divergência e PAGO/);
  });
});
