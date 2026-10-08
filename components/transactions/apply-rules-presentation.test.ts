import { describe, expect, it } from 'vitest';
import { applyResultMessage, confirmedItems } from './apply-rules-presentation';

describe('applyResultMessage', () => {
  it('nada aplicado e nada pulado', () => {
    expect(applyResultMessage({ applied: 0, skipped: 0, propagated: 0 })).toBe('Nenhum lançamento foi categorizado.');
  });

  it('nada aplicado porque tudo mudou desde a previa', () => {
    expect(applyResultMessage({ applied: 0, skipped: 2, propagated: 0 })).toBe(
      'Nenhum lançamento foi categorizado: 2 itens mudaram desde a prévia.',
    );
  });

  it('singular', () => {
    expect(applyResultMessage({ applied: 1, skipped: 1, propagated: 1 })).toBe(
      '1 lançamento categorizado pelas regras; 1 parcela futura acompanhou o parcelamento; 1 item pulado porque mudou desde a prévia.',
    );
  });

  it('plural, sem as partes zeradas', () => {
    expect(applyResultMessage({ applied: 5, skipped: 0, propagated: 0 })).toBe('5 lançamentos categorizados pelas regras.');
    expect(applyResultMessage({ applied: 3, skipped: 0, propagated: 4 })).toBe(
      '3 lançamentos categorizados pelas regras; 4 parcelas futuras acompanharam o parcelamento.',
    );
  });
});

describe('confirmedItems', () => {
  const proposals = [
    { transactionId: 't1', ruleId: 'r1', description: 'A' },
    { transactionId: 't2', ruleId: 'r1', description: 'B' },
    { transactionId: 't3', ruleId: 'r2', description: 'C' },
  ];

  it('tudo marcado: todos os itens, na ordem da previa, so com os ids', () => {
    expect(confirmedItems(proposals, new Set())).toEqual([
      { transactionId: 't1', ruleId: 'r1' },
      { transactionId: 't2', ruleId: 'r1' },
      { transactionId: 't3', ruleId: 'r2' },
    ]);
  });

  it('desmarcado fica de fora', () => {
    expect(confirmedItems(proposals, new Set(['t2']))).toEqual([
      { transactionId: 't1', ruleId: 'r1' },
      { transactionId: 't3', ruleId: 'r2' },
    ]);
  });
});
