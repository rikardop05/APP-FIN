import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { competenceRange } from '@/lib/date';
import { cents } from '@/lib/money';
import { projectCashflow } from '@/lib/finance/cashflow';

import { adjustmentTotals, expandAdjustments, type WhatIfItem } from './adjustments';

const window = competenceRange('2026-10', 4); // 2026-10 .. 2027-01

function item(partial: Partial<WhatIfItem>): WhatIfItem {
  return {
    id: 'a',
    label: 'x',
    fromCompetence: '2026-11',
    direction: 'out',
    amountCents: cents(50_000),
    repeat: false,
    ...partial,
  };
}

describe('expandAdjustments', () => {
  it('saída vira negativa e vale só no mês escolhido', () => {
    expect(expandAdjustments([item({})], window)).toEqual([
      { competence: '2026-11', amountCents: -50_000, label: 'x' },
    ]);
  });

  it('entrada fica positiva', () => {
    const [only] = expandAdjustments([item({ direction: 'in' })], window);
    expect(only?.amountCents).toBe(50_000);
  });

  it('repeat espalha do mês inicial até o fim da janela, sem tocar os anteriores', () => {
    const months = expandAdjustments([item({ repeat: true })], window).map((a) => a.competence);
    expect(months).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('mês fora da janela não gera ajuste', () => {
    expect(expandAdjustments([item({ fromCompetence: '2030-01' })], window)).toEqual([]);
  });

  it('adjustmentTotals soma ajustes na mesma competência', () => {
    const totals = adjustmentTotals(
      expandAdjustments(
        [item({ id: 'a' }), item({ id: 'b', direction: 'in', amountCents: cents(20_000) })],
        window,
      ),
    );
    // −50.000 + 20.000 = −30.000
    expect(totals['2026-11']).toBe(-30_000);
  });
});

describe('o "e se" mexe na curva sem alterar a base', () => {
  it('cortar R$ 500/mês melhora o fechamento de dez em R$ 1.000 (2 meses × R$ 500)', () => {
    const base = {
      openingBalanceCents: cents(0),
      fromCompetence: '2026-10',
      months: 4,
      incomes: [],
      recurringExpenses: [],
      installments: [],
      statementsDue: [],
      plannedContributions: [],
    };
    const before = projectCashflow(base);
    // Corte = ENTRADA de 500/mês (economia) de nov em diante.
    const after = projectCashflow({
      ...base,
      adjustments: expandAdjustments(
        [item({ direction: 'in', repeat: true, fromCompetence: '2026-11' })],
        window,
      ),
    });
    // dez: nov (+500) + dez (+500) = +1.000 de diferença no fechamento.
    expect(after.months[2]?.closingCents).toBe(100_000);
    expect(before.months[2]?.closingCents).toBe(0);
    // A base não foi mutada.
    expect(base).not.toHaveProperty('adjustments');
  });
});

describe('o simulador NÃO persiste (invariante, não só intenção)', () => {
  it('nenhum arquivo de components/cashflow fala com rede, rota ou storage', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter(
      (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    const forbidden = [/\bfetch\s*\(/, /localStorage/, /sessionStorage/, /indexedDB/, /@\/app\/api/, /\/api\//, /XMLHttpRequest/, /navigator\.sendBeacon/];
    for (const name of sources) {
      const text = readFileSync(join(dir, name), 'utf8')
        // Comentários podem mencionar o proibido; só o código conta.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of forbidden) {
        expect(text, `${name} casou ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });
});
