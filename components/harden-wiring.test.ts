import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Endurecimento do app (impeccable harden, 2026-10-08). Mudanças estruturais, de texto, de
 * comportamento e de acessibilidade que sobrevivem ao redesenho. O vitest roda em Node, sem
 * navegador nem JSX, então as travas leem o código-fonte.
 */
const path = (file: string) => join(process.cwd(), file);
const read = (file: string) => readFileSync(path(file), 'utf8');

describe('loading e error por rota (app/(app))', () => {
  it('loading.tsx existe, anuncia o carregamento e não prende o layout', () => {
    expect(existsSync(path('app/(app)/loading.tsx'))).toBe(true);
    const loading = read('app/(app)/loading.tsx');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Carregando');
  });

  it('error.tsx é componente de cliente, fala português e oferece "Tentar de novo" ligado ao reset', () => {
    expect(existsSync(path('app/(app)/error.tsx'))).toBe(true);
    const error = read('app/(app)/error.tsx');
    expect(error.startsWith("'use client'")).toBe(true);
    expect(error).toContain('Tentar de novo');
    expect(error).toContain('onClick={reset}');
    expect(error).toContain('role="alert"');
    // Não despeja a mensagem técnica na tela.
    expect(error).not.toContain('{error.message}');
  });
});

describe('datas e competências em pt-BR, pelos formatadores existentes', () => {
  it('pendências do Painel: data de lançamento passa por formatDateBR, nunca ISO cru', () => {
    const list = read('components/dashboard/pendencias-list.tsx');
    expect(list).not.toContain('{item.occurredOn}');
    expect(list).toContain('formatDateBR(item.occurredOn)');
  });

  it('Cartões: competência da fatura por competenceShort ("jul/2026"), nunca "2026-07"', () => {
    const list = read('components/cards/statement-list.tsx');
    expect(list).not.toContain('{statement.period}');
    expect(list.match(/competenceShort\(statement\.period\)/g)).toHaveLength(2);
  });

  it('Orçamento: título do mês sem a classe capitalize ("Outubro De 2026")', () => {
    const screen = read('components/budget/budget-screen.tsx');
    expect(screen).not.toContain('capitalize');
    expect(screen).toContain('competenceTitle(period)');
  });

  it('Fluxo: placeholder do valor usa vírgula', () => {
    const panel = read('components/cashflow/what-if-panel.tsx');
    expect(panel).toContain('placeholder="500,00"');
    expect(panel).not.toMatch(/placeholder="\d+\.\d+"/);
  });
});

describe('contraste do placeholder: token existente, sem paleta nova', () => {
  const FILES = [
    'components/goals/goal-form.tsx',
    'components/investment/investment-screen.tsx',
    'components/investment/positions/positions-screen.tsx',
  ];
  it.each(FILES)('%s: o campo usa placeholder:text-muted-foreground', (file) => {
    expect(read(file)).toContain('placeholder:text-muted-foreground');
  });

  it('os campos dos cartões usam Input e Select do ui-kit, que já carregam o placeholder legível', () => {
    expect(read('components/ui-kit/input.tsx')).toContain('placeholder:text-muted-foreground');
    for (const file of ['account-form', 'card-form', 'card-holders']) {
      const source = read(`components/cards/${file}.tsx`);
      expect(source).toContain('<Input');
      expect(source).not.toMatch(/<input/);
      expect(source).not.toContain('h-9');
    }
  });
});

describe('barras animam transform, não width/height', () => {
  const BARS = [
    'components/dashboard/passive-income/passive-income-card.tsx',
    'components/dashboard/spending-by-category.tsx',
    'components/cards/commitment/commitment-section.tsx',
    'components/budget/budget-screen.tsx',
    'components/goals/goals-screen.tsx',
    'components/investment/positions/positions-screen.tsx',
  ];
  it.each(BARS)('%s: sem transition de width/height e sem style de width/height na barra', (file) => {
    const source = read(file);
    expect(source).not.toContain('transition-[width]');
    expect(source).not.toContain('transition-[height]');
    expect(source).not.toMatch(/style=\{\{ *(width|height):/);
    expect(source).toContain('barScaleStyle(');
  });

  it('o gráfico de comprometimento cresce de baixo para cima (origin-bottom) e as barras horizontais da esquerda (origin-left)', () => {
    expect(read('components/cards/commitment/commitment-section.tsx')).toContain('BAR_Y_CLASS');
    expect(read('components/dashboard/bar-scale.ts')).toContain('origin-bottom');
    expect(read('components/dashboard/bar-scale.ts')).toContain('origin-left');
  });

  it('respeita quem pede menos movimento', () => {
    expect(read('components/dashboard/bar-scale.ts')).toContain('motion-reduce:transition-none');
  });
});

describe('Lançamentos: célula truncada ganha o texto completo', () => {
  it('canhoto: descrição e origem truncadas têm title', () => {
    const list = read('components/transactions/transaction-list.tsx');
    expect(list).toContain('<span className="truncate" title={title}>{title}</span>');
    expect(list).toContain('title={sourceLabel(row)}');
  });

  it('prévia de regras e revisão: o trecho truncado tem title', () => {
    expect(read('components/transactions/apply-rules-dialog.tsx')).toContain('title={proposal.description}');
    expect(read('components/transactions/review-screen.tsx')).toContain("title={group.sampleDescriptions.join(' · ')}");
  });
});

describe('nenhuma competência montada à mão (slice) nas telas', () => {
  const DIRS = ['dashboard', 'cards', 'budget', 'cashflow', 'goals', 'investment', 'transactions', 'recurring'];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  it('os formatadores de lib/date e de cashflow/labels são o único caminho: sem `${x.slice(5)}/${x.slice(0, 4)}`', () => {
    const offenders = DIRS.flatMap((dir) => walk(join(process.cwd(), 'components', dir)))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /slice\(5\)\}?\/|\.slice\(5\)\s*\}\s*\/\s*\{/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
