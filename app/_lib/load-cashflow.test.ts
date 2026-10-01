import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guarda de coerência painel × fluxo. As duas telas têm de mostrar o MESMO saldo
 * projetado, e a única forma de garantir isso é as duas obterem a projeção pelo
 * mesmo caminho. Este teste falha se uma delas voltar a montar a entrada do motor
 * por conta própria — que é como dois números para a mesma coisa nascem.
 */
const root = join(__dirname, '..');

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('painel e /fluxo compartilham o caminho da projeção', () => {
  const pages = [
    ['painel', '(app)/page.tsx'],
    ['fluxo', '(app)/fluxo/page.tsx'],
  ] as const;

  for (const [name, file] of pages) {
    it(`${name} obtém a projeção por loadProjectedCashflow, de app/_lib`, () => {
      const source = read(file);
      expect(source).toContain("from '@/app/_lib/load-cashflow'");
      expect(source).toContain('loadProjectedCashflow(');
    });

    it(`${name} não monta a entrada do motor por conta própria`, () => {
      const source = read(file);
      expect(source).not.toMatch(/getCashflowData/);
      expect(source).not.toMatch(/toCashflowInput/);
      expect(source).not.toMatch(/projectCashflow\(/);
    });
  }

  it('o loader mora fora das pastas das duas rotas (_lib de uma rota não serve a outra)', () => {
    for (const [, file] of pages) {
      expect(read(file)).not.toMatch(/fluxo\/_lib/);
    }
  });
});
