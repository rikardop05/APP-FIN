import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * O botão "Sair" tem de estar ao alcance em TODA página autenticada, no desktop e no celular.
 *
 * Causa do bug (2026-10-07): a barra lateral era um bloco que crescia com a página (`nav` esticado
 * até o fim do conteúdo) e o "Sair" ficava no rodapé dela. Em página curta (Metas) o rodapé cabia
 * na tela; em página longa (Painel, Lançamentos) ele ficava centenas de pixels abaixo da dobra,
 * então "só aparecia em algumas páginas". A correção é a barra ficar presa à altura da janela
 * (`sticky top-0 h-screen`), com o "Sair" no rodapé DELA e rolagem interna se a janela for baixa.
 *
 * Os testes leem o código-fonte porque o vitest roda em Node, sem navegador nem transformação de JSX:
 * eles travam as três peças da correção, e a regra de que toda rota autenticada vive sob o layout
 * que monta a navegação.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('layout das telas autenticadas', () => {
  const layout = read('app/(app)/layout.tsx');

  it('monta a barra lateral (desktop) e a inferior (celular) para TODAS as rotas do grupo', () => {
    expect(layout).toContain('<SidebarNav />');
    expect(layout).toContain('<BottomNav />');
  });

  it('só existe um layout dentro de app/(app): nenhuma subárvore escapa do shell com a navegação', () => {
    const layouts = walk(join(ROOT, 'app', '(app)')).filter((file) => /layout\.(tsx|ts)$/.test(file));
    expect(layouts.map((file) => relative(ROOT, file).split(sep).join('/'))).toEqual(['app/(app)/layout.tsx']);
  });

  it('toda página fora de /api e /login mora sob app/(app) (senão ficaria sem navegação nem Sair)', () => {
    const pages = walk(join(ROOT, 'app'))
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .filter((file) => /\/page\.tsx$/.test(file) && !file.startsWith('app/api/'));
    const outside = pages.filter((file) => !file.startsWith('app/(app)/') && !file.startsWith('app/(auth)/'));
    expect(outside).toEqual([]);
  });
});

describe('Sair na barra lateral (desktop)', () => {
  const sidebar = read('components/nav/sidebar-nav.tsx');

  it('tem o botão Sair', () => {
    expect(sidebar).toContain('<SignOutButton variant="sidebar" />');
  });

  it('a barra fica presa à altura da janela e rola por dentro: o Sair não some em página longa', () => {
    const navTag = /<nav[^>]*className="([^"]*)"/s.exec(sidebar)?.[1] ?? '';
    for (const token of ['md:sticky', 'md:top-0', 'md:h-screen', 'md:overflow-y-auto']) {
      expect(navTag, token).toContain(token);
    }
  });

  it('o Sair fica no rodapé da barra (mt-auto), depois dos itens de navegação', () => {
    const afterItems = sidebar.slice(sidebar.indexOf('NAV_ITEMS.map'));
    expect(afterItems.indexOf('mt-auto')).toBeGreaterThan(-1);
    expect(afterItems.indexOf('mt-auto')).toBeLessThan(afterItems.indexOf('<SignOutButton'));
  });
});

describe('Sair no celular (390 px)', () => {
  const bottom = read('components/nav/bottom-nav.tsx');

  it('tem o botão Sair no painel do menu "Mais"', () => {
    expect(bottom).toContain('<SignOutButton variant="tile" />');
  });

  it('o painel do "Mais" cabe em janela baixa: altura máxima com rolagem interna', () => {
    const panelTag = /<nav\s+id=\{OVERFLOW_PANEL_ID\}[^>]*className="([^"]*)"/s.exec(bottom)?.[1] ?? '';
    expect(panelTag).toContain('max-h-');
    expect(panelTag).toContain('overflow-y-auto');
  });

  it('o botão aparece o tempo todo na barra inferior? não: fica atrás do "Mais", e "Mais" é fixo em toda página', () => {
    // A barra inferior é `fixed` e renderizada pelo layout de todas as páginas; o "Mais" abre o painel.
    expect(bottom).toContain('fixed inset-x-0 bottom-0');
    expect(bottom).toContain('md:hidden');
  });
});
