import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertCategoryFitsKinds, CategoryKindMismatchError } from '@/lib/db/queries/category-kind';

import { categoryKindFailure } from './category-kind-failure';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('natureza x tipo vira 400 em português nas rotas', () => {
  it('o erro vira 400 com a mensagem do próprio erro', () => {
    let caught: unknown;
    try {
      assertCategoryFitsKinds('income', ['expense']);
    } catch (error) {
      caught = error;
    }
    expect(categoryKindFailure(caught)).toEqual({ status: 400, error: 'Despesa não pode ir para uma categoria de receita.' });
    expect(categoryKindFailure(new CategoryKindMismatchError('x'))?.status).toBe(400);
  });

  it('qualquer outro erro não é tratado aqui (segue para o 500 da rota)', () => {
    expect(categoryKindFailure(new Error('banco caiu'))).toBeNull();
    expect(categoryKindFailure(null)).toBeNull();
  });

  it('as três rotas de categorização manual (criar, editar e lote) usam o mapeamento', () => {
    for (const route of ['app/api/transactions/route.ts', 'app/api/transactions/[id]/route.ts', 'app/api/transactions/batch/route.ts']) {
      const source = read(route);
      expect(source, route).toContain('categoryKindFailure(error)');
    }
  });
});
