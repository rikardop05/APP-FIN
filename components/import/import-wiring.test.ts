import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const confirmation = read('components/import/import-confirmation.tsx');
const screen = read('components/import/import-screen.tsx');

describe('revisão da fatura: ligações da tela', () => {
  it('tem UMA região aria-live para o lote, não uma por linha', () => {
    expect(confirmation.match(/aria-live=/g)).toHaveLength(1);
  });

  it('cada linha é um article com nome e rótulos com o contexto da linha', () => {
    expect(confirmation).toContain('as="article"');
    expect(confirmation).toContain('ariaLabel={`Linha ${rowNumber}');
    expect(confirmation).toContain("rowFieldLabel('Categoria'");
    expect(confirmation).toContain("rowFieldLabel('Responsável'");
  });

  it('usa o vocabulário do carnê: capa, canhotos, Ainda presos e Placar fixo', () => {
    expect(confirmation).toContain('<BatchCover');
    expect(confirmation).toContain('<Canhoto');
    expect(confirmation).toContain('<StillHeldColumn');
    expect(confirmation).toMatch(/<Placar\s+position="sticky"/);
    expect(confirmation).toContain('Total da fatura');
    expect(confirmation).toContain('Diferença');
  });

  it('o Confirmar bloqueado explica o motivo e leva à primeira linha inválida', () => {
    expect(confirmation).toContain('aria-disabled={blockReason !== null}');
    expect(confirmation).toContain('firstInvalidIndex');
    expect(confirmation).toContain('confirmBlockReason');
  });

  it('J e K, filtro de atenção e edição em lote existem', () => {
    expect(confirmation).toContain('stepFlagged');
    expect(confirmation).toContain('Só o que precisa de atenção');
    expect(confirmation).toContain('Aplicar às selecionadas');
  });

  it('a assinatura espera a animação antes de trocar de estado e respeita movimento reduzido', () => {
    expect(confirmation).toContain('esperarDestacar()');
    expect(read('components/import/destacar.ts')).toContain('prefers-reduced-motion');
    expect(read('app/globals.css')).toMatch(/prefers-reduced-motion[\s\S]*\.destacando/);
  });

  it('a entrada tem área de soltar em pt-BR, sem o input nativo à mostra', () => {
    expect(screen).toContain('<DropZone');
    expect(read('components/import/drop-zone.tsx')).toContain('Arraste a fatura ou escolha o PDF');
  });

  it('a competência sai por extenso, nunca montada a mão com slice', () => {
    expect(read('components/import/competence-warning-banner.tsx')).not.toMatch(/slice\(5\)/);
    expect(confirmation).not.toMatch(/slice\(5\)\}\/\$\{/);
  });
});
