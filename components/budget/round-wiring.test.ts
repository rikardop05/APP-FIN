import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Fiação da rodada pós-crítica (2026-10-09): Orçamento em Canhoto com Faixa dos não categorizados,
 * Config com âncoras, Painel com a ressalva do veredito e DateField no lugar do `<input type="date">`.
 * O vitest roda em Node, então a checagem é no código-fonte.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Orçamento', () => {
  const screen = read('components/budget/budget-screen.tsx');
  it('linhas em Canhoto com Selo, sem Badge, e percentual sem casas decimais', () => {
    expect(screen).toContain('<Canhoto');
    expect(screen).not.toContain('<Badge');
    expect(screen).not.toContain('formatBasisPoints');
  });
  it('a Faixa avisa dos lançamentos sem categoria e liga à revisão', () => {
    expect(screen).toContain('<Faixa tone="attention"');
    expect(screen).toContain('/lancamentos/revisar');
    expect(screen).toContain('uncategorized=true');
  });
  it('selo e letra só para atenção: a linha dentro do limite não leva selo', () => {
    expect(screen).toContain('rowMarca(row.light)');
  });
  it('a legenda da cor tem medida limitada', () => {
    expect(screen).toContain('max-w-[65ch]');
  });
});

describe('Config', () => {
  const screen = read('app/(app)/config/config-screen.tsx');
  it('cada seção tem âncora e a lixeira só fica vermelha no hover e no foco', () => {
    for (const id of ['categorias', 'regras', 'membros', 'premissas']) expect(screen).toContain(`id="${id}"`);
    expect(read('app/(app)/config/backup-section.tsx')).toContain('id="backup"');
    expect(screen).not.toContain('(s)');
    expect(screen).not.toContain('<Trash2 className="h-4 w-4 text-destructive"');
    expect(screen).toContain('hover:text-destructive focus-visible:text-destructive');
  });
  it('o horizonte do comprometimento diz que vale para o Painel e para Cartões', () => {
    expect(read('app/(app)/config/settings-form.tsx')).toContain('Vale para o Painel e para Cartões');
  });
});

describe('Painel', () => {
  it('o veredito liga ao card Comprometido e o card traz a âncora', () => {
    expect(read('components/dashboard/headline.tsx')).toContain('href="#comprometido"');
    expect(read('components/dashboard/committed-card.tsx')).toContain('id="comprometido"');
  });
  it('atalho para importar fatura no cabeçalho', () => {
    expect(read('components/dashboard/dashboard-screen.tsx')).toContain('href="/importar"');
  });
});

describe('DateField no lugar do date nativo', () => {
  it.each([
    'components/recurring/recurring-screen.tsx',
    'components/cards/account-form.tsx',
    'components/transactions/transaction-filters.tsx',
  ])('%s', (file) => {
    const source = read(file);
    expect(source).toContain('<DateField');
    expect(source).not.toContain('type="date"');
  });
});
