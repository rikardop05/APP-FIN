/**
 * Teste de fronteira de `GET /api/transactions` (Lote 2, itens 5 e 7): as duas pontas.
 *
 * - IDA: a query que a tela monta (`competence`, `direction`, `origin`) contra o schema REAL da rota.
 * - VOLTA: `summary` e `uncategorizedCount`, tipados com o retorno REAL das queries do servidor,
 *   passam pelo schema que a tela usa no `.parse`.
 */

import { describe, expect, it } from 'vitest';

import { transactionResponseSchema } from '@/components/transactions/schemas';
import type { countUncategorized, getMonthSummary } from '@/lib/db/queries/transactions';
import { cents } from '@/lib/money';

import { transactionFiltersSchema } from './schemas';

describe('GET /api/transactions: a query que a tela monta', () => {
  it('aceita competence, direction e origin', () => {
    const result = transactionFiltersSchema.safeParse({
      competence: '2026-11',
      direction: 'expense',
      origin: 'card',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ competence: '2026-11', direction: 'expense', origin: 'card' });
    }
  });

  it('sem nenhum dos três é "todos os meses, sem recorte"', () => {
    const result = transactionFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.competence).toBeUndefined();
      expect(result.data.direction).toBeUndefined();
      expect(result.data.origin).toBeUndefined();
    }
  });

  it('recusa mês inexistente, formato errado, direção e origem desconhecidas', () => {
    for (const bad of [
      { competence: '2026-13' },
      { competence: '2026-00' },
      { competence: '2026-1' },
      { competence: 'todos' },
      { direction: 'transfer' },
      { origin: 'cash' },
    ]) {
      expect(transactionFiltersSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('a resposta que a tela faz .parse', () => {
  const summary: Awaited<ReturnType<typeof getMonthSummary>> = {
    competence: '2026-11',
    incomeCents: cents(800000),
    expenseCents: cents(300000),
    surplusCents: cents(500000),
  };
  const uncategorizedCount: Awaited<ReturnType<typeof countUncategorized>> = 6;
  const base = { transactions: [], options: { categories: [], accounts: [], cards: [], members: [] }, settlement: [] };

  it('com mês escolhido: summary e uncategorizedCount passam', () => {
    const parsed = transactionResponseSchema.parse({ ...base, summary, uncategorizedCount });
    expect(parsed.summary).toEqual(summary);
    expect(parsed.uncategorizedCount).toBe(6);
  });

  it('em "todos os meses": summary é null', () => {
    const parsed = transactionResponseSchema.parse({ ...base, summary: null, uncategorizedCount: 0 });
    expect(parsed.summary).toBeNull();
  });

  it('se a rota esquecer summary ou uncategorizedCount, o parse lança', () => {
    expect(() => transactionResponseSchema.parse({ ...base, uncategorizedCount })).toThrow();
    expect(() => transactionResponseSchema.parse({ ...base, summary })).toThrow();
  });
});
