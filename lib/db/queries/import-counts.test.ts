import { describe, expect, it } from 'vitest';

import { importedRowsCount } from './import-counts';

describe('rowsImported do lote', () => {
  it('subtrai TODO o skipped: desmarcada, duplicata e informativa', () => {
    const skipped = [
      { reason: 'excluded_by_user' },
      { reason: 'duplicate' },
      { reason: 'informational' },
    ];
    // 5 linhas confirmadas, 3 de fora: 2 importadas.
    expect(importedRowsCount(5, skipped)).toBe(2);
  });

  it('só a informativa de fora (antes subtraía só duplicatas e dava 1 a mais)', () => {
    expect(importedRowsCount(3, [{ reason: 'informational' }])).toBe(2);
  });

  it('nada pulado: todas as linhas; tudo pulado: zero', () => {
    expect(importedRowsCount(4, [])).toBe(4);
    expect(importedRowsCount(1, [{ reason: 'duplicate' }])).toBe(0);
  });
});
