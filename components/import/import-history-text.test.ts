import { describe, expect, it } from 'vitest';

import { batchRowsText, batchStatusLabel, batchTitle, revertedMessage } from './import-history-text';

describe('mensagem depois de desfazer uma importação', () => {
  it('diz quantos lançamentos saíram e que as telas já estão atualizadas (nada de "recarregue")', () => {
    expect(revertedMessage(47)).toBe('Lote desfeito: 47 lançamentos removidos. Os números das outras telas já estão atualizados.');
    expect(revertedMessage(1)).toBe('Lote desfeito: 1 lançamento removido. Os números das outras telas já estão atualizados.');
    expect(revertedMessage(1).toLowerCase()).not.toContain('recarregue');
  });
});

describe('linha do histórico', () => {
  it('lote desfeito não diz que ainda tem lançamentos', () => {
    expect(batchRowsText('reverted', 47)).toBe('Desfeito: 47 lançamentos removidos');
    expect(batchRowsText('reverted', 1)).toBe('Desfeito: 1 lançamento removido');
    expect(batchRowsText('reverted', 0)).toBe('Desfeito, sem lançamentos');
    expect(batchRowsText('committed', 47)).toBe('47 lançamentos');
  });

  it('pendente e falho dizem que nada foi gravado', () => {
    expect(batchRowsText('pending', 0)).toMatch(/nada gravado/);
    expect(batchRowsText('failed', 0)).toMatch(/Não gravou/);
  });

  it('o estado do lote vai no masculino', () => {
    expect(batchStatusLabel('committed')).toBe('Confirmado');
    expect(batchStatusLabel('reverted')).toBe('Desfeito');
  });

  it('o título usa banco e competência por extenso, sem montar 10/2026 à mão', () => {
    expect(batchTitle({ fileName: 'a.pdf', bankKey: 'nubank_card', competence: '2026-10' })).toBe('Nubank · outubro de 2026');
    expect(batchTitle({ fileName: 'a.pdf', bankKey: null, competence: '2026-10' })).toBe('outubro de 2026');
    expect(batchTitle({ fileName: 'a.pdf' })).toBe('a.pdf');
  });
});
