/**
 * Teste de fronteira de `/api/budgets`: as duas pontas do contrato.
 *
 * - IDA: o corpo do `PUT` é montado por `buildSaveBody`, a MESMA função que a
 *   tela usa, e validado contra o schema REAL da rota.
 * - VOLTA: a resposta é tipada com o retorno REAL do servidor
 *   (`loadBudgetMonthResponse`) e passa pelo schema que a tela usa no `.parse`.
 *
 * Três telas já passaram com `tsc` limpo e centenas de testes verdes e estavam
 * quebradas no navegador, sempre por duas pontas que nenhuma ferramenta compara.
 */

import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  budgetMonthResponseSchema,
  suggestionResponseSchema,
} from '@/components/budget/schemas';
import { buildSaveBody } from '@/components/budget/save-body';
import { basisPoints, cents } from '@/lib/money';

import type { loadBudgetMonthResponse } from './month';
import { budgetsQuerySchema, saveBudgetsBodySchema, suggestionQuerySchema } from './schemas';

const MERCADO = '11111111-1111-4111-8111-111111111111';
const LAZER = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-333333333333';

describe('PUT /api/budgets: o corpo que a tela monta', () => {
  it('aceita o corpo montado por buildSaveBody, inclusive orçamento zero', () => {
    const built = buildSaveBody('2026-10', { [MERCADO]: '1.200,50', [LAZER]: '0' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = saveBudgetsBodySchema.safeParse(built.body);
    expect(result.success).toBe(true);
    expect(built.body.items).toEqual([
      { categoryId: MERCADO, plannedCents: 120050 },
      { categoryId: LAZER, plannedCents: 0 },
    ]);
  });

  it('campo vazio é "sem orçamento": não entra em items (e portanto é apagado do mês)', () => {
    const built = buildSaveBody('2026-10', { [MERCADO]: '500', [LAZER]: '   ' });
    expect(built.ok && built.body.items.map((item) => item.categoryId)).toEqual([MERCADO]);
  });

  it('mês sem nenhum campo preenchido é um corpo válido (limpa o mês)', () => {
    const built = buildSaveBody('2026-10', { [MERCADO]: '' });
    expect(built.ok).toBe(true);
    if (built.ok) expect(saveBudgetsBodySchema.safeParse(built.body).success).toBe(true);
  });

  it('texto que parseBRL não entende e valor negativo são INVÁLIDOS, não descartados em silêncio', () => {
    const built = buildSaveBody('2026-10', { [MERCADO]: 'abc', [LAZER]: '-10,00' });
    expect(built).toEqual({ ok: false, invalidCategoryIds: [MERCADO, LAZER] });
  });

  it('o schema da rota rejeita o que a tela nunca mandaria (defesa em profundidade)', () => {
    const valid = { period: '2026-10', items: [{ categoryId: MERCADO, plannedCents: 100 }] };
    expect(saveBudgetsBodySchema.safeParse(valid).success).toBe(true);
    const bad = (body: unknown) => saveBudgetsBodySchema.safeParse(body).success;
    expect(bad({ ...valid, period: '2026/10' })).toBe(false);
    expect(bad({ ...valid, period: undefined })).toBe(false);
    expect(bad({ ...valid, items: [{ categoryId: 'x', plannedCents: 100 }] })).toBe(false);
    expect(bad({ ...valid, items: [{ categoryId: MERCADO, plannedCents: -1 }] })).toBe(false);
    expect(bad({ ...valid, items: [{ categoryId: MERCADO, plannedCents: 1.5 }] })).toBe(false);
    expect(
      bad({
        ...valid,
        items: [
          { categoryId: MERCADO, plannedCents: 1 },
          { categoryId: MERCADO, plannedCents: 2 },
        ],
      }),
    ).toBe(false);
    expect(
      bad({
        ...valid,
        items: Array.from({ length: 201 }, (_, index) => ({
          categoryId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          plannedCents: 1,
        })),
      }),
    ).toBe(false);
  });
});

describe('GET /api/budgets e /suggestion: a query', () => {
  it('period e mode são obrigatórios e validados', () => {
    expect(budgetsQuerySchema.safeParse({ period: '2026-10' }).success).toBe(true);
    expect(budgetsQuerySchema.safeParse({ period: null }).success).toBe(false);
    expect(budgetsQuerySchema.safeParse({ period: '2026-13' }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ period: '2026-10', mode: 'previous' }).success).toBe(true);
    expect(suggestionQuerySchema.safeParse({ period: '2026-10', mode: 'avg3' }).success).toBe(true);
    expect(suggestionQuerySchema.safeParse({ period: '2026-10', mode: 'avg6' }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ period: '2026-10', mode: null }).success).toBe(false);
  });
});

describe('as respostas que a tela faz .parse', () => {
  const response: Awaited<ReturnType<typeof loadBudgetMonthResponse>> = {
    period: '2026-10',
    warnBp: basisPoints(8000),
    rows: [
      {
        categoryId: MERCADO,
        categoryName: 'Mercado',
        rootName: 'Alimentação',
        plannedCents: cents(100000),
        spentCents: cents(120000),
        upcomingCents: cents(15000),
        expectedCents: cents(135000),
        remainingCents: cents(-35000),
        usageBp: basisPoints(13500),
        light: 'red',
      },
      {
        categoryId: LAZER,
        categoryName: 'Lazer',
        rootName: 'Alimentação',
        plannedCents: cents(0),
        spentCents: cents(0),
        expectedCents: cents(0),
        remainingCents: cents(0),
        usageBp: null,
        light: 'green',
        upcomingCents: cents(0),
      },
    ],
    categories: [
      { id: MERCADO, name: 'Mercado', rootId: ROOT, rootName: 'Alimentação', nature: 'essential' },
      { id: LAZER, name: 'Lazer', rootId: ROOT, rootName: 'Alimentação', nature: 'non_essential' },
    ],
  };

  it('o retorno REAL do servidor passa pelo schema da tela (restante negativo e usageBp nulo incluídos)', () => {
    expect(budgetMonthResponseSchema.safeParse(JSON.parse(JSON.stringify(response))).success).toBe(true);
  });

  it('se a rota esquecer um campo, o parse da tela lança em vez de ler undefined', () => {
    const { upcomingCents: _omit, ...withoutUpcoming } = response.rows[0]!;
    void _omit;
    const broken = { ...response, rows: [withoutUpcoming] };
    expect(budgetMonthResponseSchema.safeParse(broken).success).toBe(false);
  });

  it('a resposta da sugestão passa pelo schema da tela', () => {
    const body = {
      period: '2026-10',
      mode: 'avg3' as const,
      suggestions: [{ categoryId: MERCADO, suggestedCents: 30000 }],
    };
    expect(suggestionResponseSchema.safeParse(body).success).toBe(true);
    expect(suggestionResponseSchema.safeParse({ ...body, suggestions: [{ categoryId: MERCADO }] }).success).toBe(
      false,
    );
  });

  it('o corpo de erro que as rotas devolvem é o que a tela lê', () => {
    expect(apiErrorSchema.safeParse({ error: 'Categoria não encontrada.' }).success).toBe(true);
  });
});
