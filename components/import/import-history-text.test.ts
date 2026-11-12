import { describe, expect, it } from 'vitest';

import {
  batchRowsText,
  batchStatusLabel,
  batchTitle,
  hiddenBatchesLabel,
  saoPauloDay,
  revertedMessage,
  splitBatches,
} from './import-history-text';

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

describe('lote desfeito sem fatura', () => {
  it('usa banco e data da importação quando não há competência, e o arquivo quando não há banco', () => {
    expect(
      batchTitle({ fileName: 'a.pdf', bankKey: 'nubank_card', competence: null, createdAt: '2026-09-12T15:00:00.000Z' }),
    ).toBe('Nubank · importação de 12/09/2026');
    expect(batchTitle({ fileName: 'a.pdf', bankKey: null, competence: null, createdAt: '2026-09-12T15:00:00.000Z' })).toBe('a.pdf');
  });

  it('separa só o desfeito sem lançamentos, mantendo a ordem', () => {
    const batches = [
      { id: 'a', status: 'committed' as const, rowsImported: 10 },
      { id: 'b', status: 'reverted' as const, rowsImported: 0 },
      { id: 'c', status: 'reverted' as const, rowsImported: 3 },
      { id: 'd', status: 'failed' as const, rowsImported: 0 },
      { id: 'e', status: 'reverted' as const, rowsImported: 0 },
    ];
    const { main, hidden } = splitBatches(batches);
    expect(main.map((b) => b.id)).toEqual(['a', 'c', 'd']);
    expect(hidden.map((b) => b.id)).toEqual(['b', 'e']);
  });

  it('a data do lote é a de São Paulo, não a de UTC', () => {
    expect(saoPauloDay('2026-09-13T01:30:00.000Z')).toBe('2026-09-12');
    expect(
      batchTitle({ fileName: 'a.pdf', bankKey: 'nubank_card', competence: null, createdAt: '2026-09-13T01:30:00.000Z' }),
    ).toBe('Nubank · importação de 12/09/2026');
  });

  it('o rótulo do bloco recolhido concorda em número', () => {
    expect(hiddenBatchesLabel(1)).toBe('Ver 1 importação desfeita');
    expect(hiddenBatchesLabel(4)).toBe('Ver 4 importações desfeitas');
  });
});
