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

describe('polish da entrada', () => {
  it('a competência usa o seletor pt-BR do ui-kit, não o input month nativo', () => {
    expect(screen).toContain('<MonthPicker');
    expect(screen).not.toContain('type="month"');
  });

  it('não há duas réguas seguidas sob o cabeçalho', () => {
    expect(screen).not.toContain('border-t-2 border-foreground');
  });

  it('o histórico exige banco e competência do servidor (só podem ser null)', () => {
    const schema = read('components/import/import-history-schemas.ts');
    expect(schema).toContain('bankKey: z.string().nullable(),');
    expect(schema).not.toMatch(/bankKey: .*optional/);
  });
});

describe('polish final da seleção pelo canhoto', () => {
  it('a dica usa a palavra do mundo e a ação do ponteiro real', () => {
    expect(confirmation).toContain('Clique');
    expect(confirmation).toContain('Toque');
    expect(confirmation).toContain('no canhoto para selecionar linhas');
    expect(confirmation).not.toMatch(/>[^<{]*talão[^<{]*</);
  });

  it('o talão do canhoto de seleção não tem caixinha: visto reto e simples só quando selecionado (inclinado é só do carimbo de veredito)', () => {
    expect(confirmation).not.toContain('-rotate-6');
    expect(confirmation).toContain('<Check className="h-4 w-4 text-primary" strokeWidth={3}');
    expect(confirmation).not.toContain('flex h-4 w-4 items-center justify-center border');
    expect(confirmation).toContain('hover:bg-primary/10');
    expect(confirmation).toContain('active:bg-primary/25');
  });

  it('linha parcelada mantém a data da compra no corpo', () => {
    expect(confirmation).toContain("{installment ? `${stubDate(draft.occurredOnText)} · ` : ''}");
  });
});

describe('P1b: com o placar divergindo, Confirmar vira contorno e a ação primária é achar o que falta', () => {
  it('Mostrar o que pode faltar é o primário e Confirmar com diferença vira outline', () => {
    expect(confirmation).toContain('Mostrar o que pode faltar');
    expect(confirmation).toContain("variant={diverge ? 'outline' : 'primary'}");
    expect(confirmation).toContain('confirmWithDifferenceLabel');
    expect(confirmation).toContain('showWhatMayBeMissing');
    expect(confirmation).toContain('mayBeMissing');
  });

  it('em CONFERE nada muda: o rótulo continua Confirmar importação', () => {
    expect(confirmation).toContain(": 'Confirmar importação';");
  });
});
