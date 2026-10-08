import { describe, expect, it } from 'vitest';

import { revertedMessage } from './import-history-text';

describe('mensagem depois de desfazer uma importação', () => {
  it('diz quantos lançamentos saíram e que as telas já estão atualizadas (nada de "recarregue")', () => {
    expect(revertedMessage(47)).toBe('Lote desfeito: 47 lançamentos removidos. Os números das outras telas já estão atualizados.');
    expect(revertedMessage(1)).toBe('Lote desfeito: 1 lançamento removido. Os números das outras telas já estão atualizados.');
    expect(revertedMessage(1).toLowerCase()).not.toContain('recarregue');
  });
});
